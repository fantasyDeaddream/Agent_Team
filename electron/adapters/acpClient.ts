import { spawn, ChildProcess, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PermissionMode } from '../types/domain';

export interface AcpSpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  cwd: string;
}

export interface AcpPromptOptions {
  prompt: string;
  modelId?: string;
  effort?: string;
  permissionMode: PermissionMode;
  imagePaths?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onStream?: (chunk: string, channel: 'text' | 'thought' | 'tool' | 'stderr') => void;
}

export interface AcpSessionInfo {
  sessionId: string;
  models?: {
    availableModels?: Array<{ modelId: string; name?: string; description?: string }>;
    currentModelId?: string;
  };
  configOptions?: Array<{
    id: string;
    name?: string;
    category?: string;
    type?: string;
    currentValue?: string;
    options?: Array<{
      value?: string;
      name?: string;
      description?: string;
      group?: string;
      options?: Array<{ value: string; name?: string; description?: string }>;
    }>;
  }>;
  agentInfo?: { name?: string; version?: string };
  promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  idleTimeoutMs?: number;
  method: string;
}

/**
 * Kills a process tree cleanly on Windows (using taskkill /T /F) or POSIX.
 */
export function killProcessTree(proc: ChildProcess | null): void {
  if (!proc || proc.killed || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }
}

/**
 * Lightweight, standards-compliant Agent Client Protocol (ACP v1) client
 * speaking JSON-RPC 2.0 over stdio to native agent harnesses (e.g. `agy acp`, `dsh --profile acp`).
 */
export class AcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuf = '';
  private stderrLog = '';
  private closed = false;
  private onNotification?: (method: string, params: Record<string, unknown>) => void;
  private permissionMode: PermissionMode = 'workspace-write';

  constructor(private readonly spec: AcpSpawnSpec) {}

  async start(timeoutMs = 20000): Promise<{
    agentInfo?: { name?: string; version?: string };
    promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
  }> {
    this.proc = spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd,
      env: { ...process.env, ...this.spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');

    this.proc.stdout.on('data', (chunk: string) => {
      this.touchIdleRequests();
      this.stdoutBuf += chunk;
      const lines = this.stdoutBuf.split(/\r?\n/);
      this.stdoutBuf = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        this.handleLine(line);
      }
    });

    this.proc.stderr.on('data', (chunk: string) => {
      this.touchIdleRequests();
      this.stderrLog += chunk;
    });

    this.proc.on('exit', (code) => {
      this.closed = true;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(
          new Error(
            `ACP subprocess exited (code=${code}). ${this.stderrLog.slice(-500)}`
          )
        );
      }
      this.pending.clear();
    });

    this.proc.on('error', (err) => {
      this.closed = true;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    });

    const initResult = (await this.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: 'Agent_Team',
          version: '1.0.0',
        },
      },
      timeoutMs
    )) as {
      agentInfo?: { name?: string; version?: string };
      agentCapabilities?: { promptCapabilities?: { image?: boolean; embeddedContext?: boolean } };
    };

    return {
      agentInfo: initResult?.agentInfo,
      promptCapabilities: initResult?.agentCapabilities?.promptCapabilities,
    };
  }

  async newSession(cwd: string, timeoutMs = 20000): Promise<AcpSessionInfo> {
    const res = (await this.request(
      'session/new',
      { cwd, mcpServers: [] },
      timeoutMs
    )) as AcpSessionInfo;
    return res;
  }

  async runPrompt(opts: AcpPromptOptions): Promise<{ text: string; rawLog: string }> {
    this.permissionMode = opts.permissionMode;
    const init = await this.start(Math.min(opts.timeoutMs ?? 180000, 25000));

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      this.close();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const session = await this.newSession(this.spec.cwd, 25000);
      if (aborted) throw new Error('任务已被用户取消');

      // Select model via configOptions (e.g. DeepSeek Harness) or session/set_model (e.g. Antigravity)
      if (opts.modelId) {
        const modelConfig = session.configOptions?.find(
          (c) => c.id === 'model' || c.category === 'model'
        );
        if (modelConfig) {
          try {
            await this.request(
              'session/set_config_option',
              {
                sessionId: session.sessionId,
                configId: modelConfig.id,
                value: opts.modelId,
              },
              15000
            );
          } catch (err) {
            opts.onStream?.(
              `[ACP] set_config_option(model) warning: ${String(err)}\n`,
              'stderr'
            );
          }
        } else {
          try {
            await this.request(
              'session/set_model',
              {
                sessionId: session.sessionId,
                modelId: opts.modelId,
              },
              15000
            );
          } catch (err) {
            opts.onStream?.(
              `[ACP] set_model warning: ${String(err)}\n`,
              'stderr'
            );
          }
        }
      }

      if (opts.effort) {
        const effortConfig = session.configOptions?.find(
          (c) => c.id === 'reasoning_effort' || c.category === 'thought_level'
        );
        if (effortConfig) {
          try {
            await this.request(
              'session/set_config_option',
              {
                sessionId: session.sessionId,
                configId: effortConfig.id,
                value: opts.effort,
              },
              10000
            );
          } catch {
            // Optional effort override
          }
        }
      }

      let assistantText = '';
      let rawLog = '';

      this.onNotification = (method, params) => {
        if (method !== 'session/update') return;
        const update = (params?.update ?? params) as Record<string, unknown>;
        const kind = String(update?.sessionUpdate ?? update?.type ?? '');

        if (kind === 'agent_message_chunk') {
          const content = update.content as { type?: string; text?: string } | undefined;
          const text = content?.text ?? (typeof update.text === 'string' ? update.text : '');
          if (text) {
            assistantText += text;
            rawLog += text;
            opts.onStream?.(text, 'text');
          }
        } else if (kind === 'agent_thought_chunk') {
          const content = update.content as { type?: string; text?: string } | undefined;
          const text = content?.text ?? '';
          if (text) {
            rawLog += text;
            opts.onStream?.(text, 'thought');
          }
        } else if (kind === 'tool_call' || kind === 'tool_call_update') {
          const title = String(update.title ?? update.toolCallId ?? 'tool');
          const status = String(update.status ?? '');
          const line = `\n[工具] ${title}${status ? ` (${status})` : ''}\n`;
          rawLog += line;
          opts.onStream?.(line, 'tool');
        }
      };

      const promptBlocks: Array<Record<string, unknown>> = [
        { type: 'text', text: opts.prompt },
      ];

      if (opts.imagePaths?.length && init.promptCapabilities?.image) {
        for (const imgPath of opts.imagePaths) {
          if (fs.existsSync(imgPath)) {
            const ext = path.extname(imgPath).toLowerCase();
            const mimeType =
              ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : ext === '.webp'
                  ? 'image/webp'
                  : 'image/png';
            const data = fs.readFileSync(imgPath).toString('base64');
            promptBlocks.push({ type: 'image', data, mimeType });
          }
        }
      }

      await this.request(
        'session/prompt',
        {
          sessionId: session.sessionId,
          prompt: promptBlocks,
        },
        opts.timeoutMs ?? 300000,
        true
      );

      // Politely attempt session/close before shutting down process
      try {
        await this.request('session/close', { sessionId: session.sessionId }, 3000);
      } catch {
        // Not all ACP servers require explicit close
      }

      return { text: assistantText.trim(), rawLog };
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
      this.close();
    }
  }

  private handleLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    // Response to our outbound request
    if (typeof msg.id === 'number' && !msg.method) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        const errObj = msg.error as { message?: string; code?: number };
        entry.reject(
          new Error(`ACP Error ${errObj.code ?? ''}: ${errObj.message ?? JSON.stringify(msg.error)}`)
        );
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    // Server -> Client RPC request (e.g. session/request_permission)
    if (typeof msg.method === 'string' && msg.id !== undefined) {
      this.handleServerRequest(msg.id as number | string, msg.method, (msg.params ?? {}) as Record<string, unknown>);
      return;
    }

    // Server -> Client notification
    if (typeof msg.method === 'string') {
      this.onNotification?.(msg.method, (msg.params ?? {}) as Record<string, unknown>);
    }
  }

  private handleServerRequest(
    id: number | string,
    method: string,
    params: Record<string, unknown>
  ): void {
    if (method === 'session/request_permission') {
      const options = (params.options ?? []) as Array<{ optionId: string; kind?: string }>;
      const preferAllow = this.permissionMode !== 'safe';
      let chosen = preferAllow
        ? options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always')
        : options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always');
      if (!chosen && options.length > 0) {
        chosen = preferAllow ? options[0] : options[options.length - 1];
      }
      this.sendRaw({
        jsonrpc: '2.0',
        id,
        result: chosen
          ? { outcome: { outcome: 'selected', optionId: chosen.optionId } }
          : { outcome: { outcome: 'cancelled' } },
      });
      return;
    }

    // Unsupported client capability request -> clean JSON-RPC error
    this.sendRaw({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not implemented by Agent_Team client: ${method}` },
    });
  }

  private touchIdleRequests(): void {
    for (const [id, entry] of this.pending) {
      if (!entry.idleTimeoutMs) continue;
      clearTimeout(entry.timer);
      const idleMs = entry.idleTimeoutMs;
      entry.timer = setTimeout(() => {
        this.pending.delete(id);
        entry.reject(
          new Error(
            `ACP "${entry.method}" 实时输出流闲置超过 ${idleMs}ms 且未汇报任务完成`
          )
        );
      }, idleMs);
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    useIdleTimeout = false
  ): Promise<unknown> {
    if (this.closed || !this.proc) {
      return Promise.reject(new Error('ACP client is not running'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            useIdleTimeout
              ? `ACP "${method}" 实时输出流闲置超过 ${timeoutMs}ms 且未汇报任务完成`
              : `ACP request "${method}" timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        idleTimeoutMs: useIdleTimeout ? timeoutMs : undefined,
        method,
      });
      this.sendRaw({ jsonrpc: '2.0', id, method, params });
    });
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (!this.proc || this.closed) return;
    try {
      this.proc.stdin.write(JSON.stringify(payload) + '\n');
    } catch {
      // ignore closed pipe
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('ACP client closed'));
    }
    this.pending.clear();
    killProcessTree(this.proc);
    this.proc = null;
  }
}
