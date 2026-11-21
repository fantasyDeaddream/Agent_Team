import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DetectedHarness, DetectedModel } from '../types/domain';
import { killProcessTree } from './acpClient';
import {
  createIdleWatchdog,
  findInPath,
  firstExistingPath,
  resolveSystemNode,
  runQuickCommand,
} from './execUtils';
import { AdapterExecuteRequest, AdapterExecuteResult, HarnessAdapter } from './types';

interface CodexLaunchSpec {
  command: string;
  baseArgs: string[];
  displayPath: string;
}

export class CodexAdapter implements HarnessAdapter {
  readonly id = 'codex' as const;

  private async resolveLaunchSpec(customPath?: string): Promise<CodexLaunchSpec | undefined> {
    if (customPath && fs.existsSync(customPath)) {
      if (customPath.toLowerCase().endsWith('.js')) {
        const nodeExe = await resolveSystemNode();
        return { command: nodeExe, baseArgs: [customPath], displayPath: customPath };
      }
      return { command: customPath, baseArgs: [], displayPath: customPath };
    }

    // Prefer direct Node + npm global codex.js to avoid Windows .cmd quoting issues
    const npmCodexJs = path.join(
      process.env.APPDATA || '',
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js'
    );
    if (fs.existsSync(npmCodexJs)) {
      const nodeExe = await resolveSystemNode();
      return { command: nodeExe, baseArgs: [npmCodexJs], displayPath: npmCodexJs };
    }

    const inPath = await findInPath('codex');
    const resolved = firstExistingPath([inPath]);
    if (!resolved) return undefined;

    if (resolved.toLowerCase().endsWith('.cmd')) {
      const siblingJs = path.join(
        path.dirname(resolved),
        'node_modules',
        '@openai',
        'codex',
        'bin',
        'codex.js'
      );
      if (fs.existsSync(siblingJs)) {
        const nodeExe = await resolveSystemNode();
        return { command: nodeExe, baseArgs: [siblingJs], displayPath: siblingJs };
      }
    }

    return { command: resolved, baseArgs: [], displayPath: resolved };
  }

  async detect(customExecutablePath?: string): Promise<DetectedHarness> {
    const detectedAt = new Date().toISOString();
    const spec = await this.resolveLaunchSpec(customExecutablePath);
    const codexHome = path.join(os.homedir(), '.codex');
    const models = this.detectModelsFromCache(codexHome);

    if (!spec) {
      const hasDesktopState = fs.existsSync(codexHome);
      return {
        id: this.id,
        name: 'Codex CLI',
        vendor: 'OpenAI',
        description: 'OpenAI Codex 原生终端工位（后端架构、系统工程与自动化验证优势）',
        status: hasDesktopState ? 'missing_cli' : 'not_installed',
        statusMessage: hasDesktopState
          ? '检测到 Codex 桌面配置，但未检测到独立 CLI，请运行 npm i -g @openai/codex'
          : '未检测到 Codex CLI，请安装 @openai/codex 或手动指定路径',
        supportedTransports: ['headless'],
        defaultTransport: 'headless',
        models,
        detectedAt,
      };
    }

    const verRes = await runQuickCommand(spec.command, [...spec.baseArgs, '--version'], 8000);
    const version = (verRes.stdout || verRes.stderr).trim().split(/\r?\n/)[0] || 'unknown';

    return {
      id: this.id,
      name: 'Codex CLI',
      vendor: 'OpenAI',
      description: 'OpenAI Codex 原生终端工位（后端架构、系统工程与自动化验证优势）',
      status: 'ready',
      statusMessage: `已就绪 · 探测到 ${models.length} 个可用模型（原生 codex exec --json，共享 ~/.codex 登录态）`,
      executablePath: spec.displayPath,
      version,
      supportedTransports: ['headless'],
      defaultTransport: 'headless',
      models,
      detectedAt,
    };
  }

  private detectModelsFromCache(codexHome: string): DetectedModel[] {
    const models: DetectedModel[] = [];
    const seen = new Set<string>();

    try {
      if (fs.existsSync(codexHome)) {
        const files = fs
          .readdirSync(codexHome)
          .filter((f) => f.startsWith('models_cache') && f.endsWith('.json'));
        for (const file of files) {
          const raw = JSON.parse(fs.readFileSync(path.join(codexHome, file), 'utf8')) as {
            models?: Array<{
              slug?: string;
              id?: string;
              display_name?: string;
              name?: string;
              description?: string;
              input_modalities?: string[];
              supported_reasoning_levels?: Array<{ effort?: string }>;
            }>;
          };
          const list = Array.isArray(raw.models) ? raw.models : [];
          for (const m of list) {
            const id = m.slug || m.id;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const efforts = Array.isArray(m.supported_reasoning_levels)
              ? m.supported_reasoning_levels
                  .map((r) => r.effort)
                  .filter((e): e is string => Boolean(e))
              : ['low', 'medium', 'high', 'xhigh'];
            models.push({
              id,
              name: m.display_name || m.name || id,
              provider: 'OpenAI Codex',
              description: m.description,
              supportsImage: Array.isArray(m.input_modalities)
                ? m.input_modalities.includes('image')
                : true,
              effortOptions: efforts.length > 0 ? efforts : ['low', 'medium', 'high'],
            });
          }
        }
      }
    } catch {
      // ignore cache parse errors
    }

    if (models.length === 0) {
      models.push({
        id: 'default',
        name: 'Codex 默认模型',
        provider: 'OpenAI Codex',
        supportsImage: true,
        effortOptions: ['low', 'medium', 'high'],
      });
    }
    return models;
  }

  async execute(request: AdapterExecuteRequest): Promise<AdapterExecuteResult> {
    const start = Date.now();
    const spec = await this.resolveLaunchSpec(request.customExecutablePath);
    if (!spec) {
      throw new Error('未找到独立 Codex CLI，请先运行 npm i -g @openai/codex 或指定路径');
    }

    const tmpOutFile = path.join(
      os.tmpdir(),
      `agent-team-codex-${crypto.randomBytes(6).toString('hex')}.txt`
    );

    const fullPrompt = request.systemPrompt
      ? `[角色系统指令]\n${request.systemPrompt}\n\n[当前任务]\n${request.prompt}`
      : request.prompt;

    const args: string[] = [
      ...spec.baseArgs,
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-C',
      request.workspaceDir,
      '-o',
      tmpOutFile,
    ];

    if (request.modelId && request.modelId !== 'default') {
      args.push('-m', request.modelId);
    }
    if (request.effort) {
      args.push('-c', `model_reasoning_effort="${request.effort}"`);
    }
    if (request.permissionMode === 'full-auto') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (request.permissionMode === 'workspace-write') {
      args.push('-s', 'workspace-write');
    } else {
      args.push('-s', 'read-only');
    }

    if (request.imagePaths?.length) {
      for (const img of request.imagePaths) {
        if (fs.existsSync(img)) {
          args.push('-i', img);
        }
      }
    }

    // Read prompt cleanly from stdin
    args.push('-');

    return new Promise<AdapterExecuteResult>((resolve, reject) => {
      const proc = spawn(spec.command, args, {
        cwd: request.workspaceDir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let buf = '';
      let rawLog = '';
      let collectedText = '';
      let stderrText = '';
      let settled = false;

      const cleanup = () => {
        try {
          if (fs.existsSync(tmpOutFile)) fs.unlinkSync(tmpOutFile);
        } catch {
          // ignore
        }
      };

      const finish = (err?: Error, code: number | null = 0) => {
        if (settled) return;
        settled = true;
        watchdog.stop();
        request.signal?.removeEventListener('abort', onAbort);

        let lastMsg = '';
        try {
          if (fs.existsSync(tmpOutFile)) {
            lastMsg = fs.readFileSync(tmpOutFile, 'utf8').trim();
          }
        } catch {
          // ignore
        }
        cleanup();

        if (err) {
          reject(err);
        } else {
          resolve({
            text: (lastMsg || collectedText || rawLog).trim(),
            rawLog,
            transportUsed: 'headless',
            modelUsed: request.modelId || 'default',
            durationMs: Date.now() - start,
            exitCode: code,
          });
        }
      };

      const onAbort = () => {
        killProcessTree(proc);
        finish(new Error('Codex 任务已被取消'));
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      const idleMs = request.timeoutMs ?? 300000;
      const watchdog = createIdleWatchdog(idleMs, () => {
        killProcessTree(proc);
        finish(new Error(`Codex 实时输出流闲置超过 ${idleMs}ms 且未汇报任务完成`));
      });

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', (chunk: string) => {
        watchdog.touch();
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          this.handleCodexEvent(line, (txt, ch) => {
            if (ch === 'text') collectedText += txt;
            rawLog += txt;
            request.onStream?.(txt, ch);
          });
        }
      });

      proc.stderr.on('data', (chunk: string) => {
        watchdog.touch();
        stderrText += chunk;
        request.onStream?.(chunk, 'stderr');
      });

      proc.on('error', (err) => finish(err));
      proc.on('close', (code) => {
        if (buf.trim()) {
          this.handleCodexEvent(buf.trim(), (txt, ch) => {
            if (ch === 'text') collectedText += txt;
            rawLog += txt;
          });
        }
        let hasFileOut = false;
        try {
          hasFileOut = fs.existsSync(tmpOutFile) && fs.statSync(tmpOutFile).size > 0;
        } catch {
          hasFileOut = false;
        }
        if (code !== 0 && !hasFileOut && !collectedText) {
          finish(new Error(`Codex 退出异常 (code=${code}): ${stderrText.slice(-500)}`), code);
        } else {
          finish(undefined, code);
        }
      });

      proc.stdin.write(fullPrompt);
      proc.stdin.end();
    });
  }

  private handleCodexEvent(
    line: string,
    emit: (text: string, ch: 'text' | 'thought' | 'tool') => void
  ): void {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const type = String(obj.type ?? '');

      if (type === 'item.completed' || type === 'item.updated') {
        const item = obj.item as Record<string, unknown> | undefined;
        if (!item) return;
        const itemType = String(item.type ?? '');
        if (itemType === 'agent_message' && typeof item.text === 'string') {
          emit(item.text + '\n', 'text');
        } else if (itemType === 'reasoning' && typeof item.text === 'string') {
          emit(item.text + '\n', 'thought');
        } else if (itemType === 'command_execution') {
          const cmd = String(item.command ?? '');
          const status = String(item.status ?? '');
          emit(`\n[命令] ${cmd} (${status})\n`, 'tool');
        }
        return;
      }

      if (type === 'agent_message_delta' && typeof obj.delta === 'string') {
        emit(obj.delta, 'text');
        return;
      }
      if (type === 'error' && typeof obj.message === 'string') {
        emit(`\n[Codex Error] ${obj.message}\n`, 'tool');
      }
    } catch {
      // Non-JSON diagnostic line
    }
  }
}
