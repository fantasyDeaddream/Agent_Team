import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DetectedHarness, DetectedModel } from '../types/domain';
import { AcpClient, killProcessTree } from './acpClient';
import { createIdleWatchdog, findInPath, runQuickCommand } from './execUtils';
import { AdapterExecuteRequest, AdapterExecuteResult, HarnessAdapter } from './types';

interface DshLaunchSpec {
  command: string;
  baseArgs: string[];
  env: Record<string, string | undefined>;
  displayPath: string;
}

export class DeepSeekAdapter implements HarnessAdapter {
  readonly id = 'deepseek' as const;

  private async resolveLaunchSpec(customPath?: string): Promise<DshLaunchSpec | undefined> {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const desktopRoot = path.join(localAppData, 'Programs', 'DeepSeek Harness');
    const desktopExe = path.join(desktopRoot, 'DeepSeek Harness.exe');
    const desktopAsar = path.join(desktopRoot, 'resources', 'app.asar');
    const desktopCliJs = path.join(
      desktopAsar,
      'dsh',
      'node_modules',
      '@deepseek-ai',
      'dsh-desktop-host',
      'lib',
      'cli.js'
    );

    if (customPath && fs.existsSync(customPath)) {
      // If user picked dsh.cmd inside DeepSeek Harness install dir, resolve to direct binary
      if (
        customPath.toLowerCase().endsWith('dsh.cmd') &&
        fs.existsSync(desktopExe) &&
        fs.existsSync(desktopAsar)
      ) {
        return {
          command: desktopExe,
          baseArgs: ['--expose-internals', desktopCliJs],
          env: { ELECTRON_RUN_AS_NODE: '1' },
          displayPath: customPath,
        };
      }
      return {
        command: customPath,
        baseArgs: [],
        env: {},
        displayPath: customPath,
      };
    }

    if (fs.existsSync(desktopExe) && fs.existsSync(desktopAsar)) {
      return {
        command: desktopExe,
        baseArgs: ['--expose-internals', desktopCliJs],
        env: { ELECTRON_RUN_AS_NODE: '1' },
        displayPath: path.join(desktopRoot, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      };
    }

    const inPath = await findInPath('dsh');
    if (inPath) {
      return {
        command: inPath,
        baseArgs: [],
        env: {},
        displayPath: inPath,
      };
    }

    return undefined;
  }

  async detect(customExecutablePath?: string): Promise<DetectedHarness> {
    const detectedAt = new Date().toISOString();
    const spec = await this.resolveLaunchSpec(customExecutablePath);

    if (!spec) {
      return {
        id: this.id,
        name: 'DeepSeek Harness',
        vendor: 'DeepSeek',
        description: 'DeepSeek Harness 原生工位（轻量高性价比任务、高速推理与多 Provider 路由）',
        status: 'not_installed',
        statusMessage: '未检测到 DeepSeek Harness，请安装桌面版或 dsh CLI 后重试',
        supportedTransports: ['acp', 'headless'],
        defaultTransport: 'acp',
        models: [],
        detectedAt,
      };
    }

    const verRes = await runQuickCommand(
      spec.command,
      [...spec.baseArgs, '--version'],
      8000,
      spec.env
    );
    const version = (verRes.stdout || verRes.stderr).trim().split(/\r?\n/)[0] || 'unknown';

    // Probe live configured & authenticated models directly through ACP session/new
    const models = await this.probeAcpModels(spec);

    return {
      id: this.id,
      name: 'DeepSeek Harness',
      vendor: 'DeepSeek',
      description: 'DeepSeek Harness 原生工位（轻量高性价比任务、高速推理与多 Provider 路由）',
      status: 'ready',
      statusMessage: `已就绪 · 通过原生 ACP 探测到 ${models.length} 个实时可用模型`,
      executablePath: spec.displayPath,
      version,
      supportedTransports: ['acp', 'headless'],
      defaultTransport: 'acp',
      models,
      detectedAt,
    };
  }

  private async probeAcpModels(spec: DshLaunchSpec): Promise<DetectedModel[]> {
    const client = new AcpClient({
      command: spec.command,
      args: [...spec.baseArgs, '--profile', 'acp'],
      env: spec.env,
      cwd: process.cwd(),
    });

    try {
      await client.start(15000);
      const session = await client.newSession(process.cwd(), 15000);
      const models: DetectedModel[] = [];

      const modelOpt = session.configOptions?.find(
        (c) => c.id === 'model' || c.category === 'model'
      );
      const effortOpt = session.configOptions?.find(
        (c) => c.id === 'reasoning_effort' || c.category === 'thought_level'
      );
      const effortOptions =
        effortOpt?.options
          ?.map((o) => o.value)
          .filter((v): v is string => Boolean(v)) ?? ['off', 'low', 'medium', 'high'];

      if (modelOpt?.options) {
        for (const groupOrItem of modelOpt.options) {
          if (Array.isArray(groupOrItem.options)) {
            const groupLabel = groupOrItem.name || groupOrItem.group || 'DeepSeek';
            for (const item of groupOrItem.options) {
              models.push({
                id: item.value,
                name: `${groupLabel} · ${item.name || item.value}`,
                provider: groupLabel,
                description: item.description,
                supportsImage: false,
                effortOptions,
              });
            }
          } else if (groupOrItem.value) {
            models.push({
              id: groupOrItem.value,
              name: groupOrItem.name || groupOrItem.value,
              provider: 'DeepSeek Harness',
              description: groupOrItem.description,
              supportsImage: false,
              effortOptions,
            });
          }
        }
      }

      if (models.length > 0) return models;
    } catch {
      // Fallback below
    } finally {
      client.close();
    }

    return [
      {
        id: '["deepseek-official","deepseek-flash"]',
        name: 'DeepSeek · DeepSeek-V4.1-Flash',
        provider: 'DeepSeek',
        effortOptions: ['off', 'low', 'medium', 'high'],
      },
      {
        id: '["deepseek-official","deepseek-v4-pro"]',
        name: 'DeepSeek · DeepSeek-V4-Pro',
        provider: 'DeepSeek',
        effortOptions: ['off', 'low', 'medium', 'high'],
      },
    ];
  }

  async execute(request: AdapterExecuteRequest): Promise<AdapterExecuteResult> {
    const start = Date.now();
    const spec = await this.resolveLaunchSpec(request.customExecutablePath);
    if (!spec) {
      throw new Error('未找到 DeepSeek Harness (dsh)，请在「本机 Agent」页面配置路径');
    }

    const transport = request.transportMode ?? 'acp';
    const fullPrompt = request.systemPrompt
      ? `[角色系统指令]\n${request.systemPrompt}\n\n[当前任务]\n${request.prompt}`
      : request.prompt;

    if (transport === 'acp') {
      const client = new AcpClient({
        command: spec.command,
        args: [...spec.baseArgs, '--profile', 'acp'],
        env: spec.env,
        cwd: request.workspaceDir,
      });
      const res = await client.runPrompt({
        prompt: fullPrompt,
        modelId: request.modelId,
        effort: request.effort,
        permissionMode: request.permissionMode,
        timeoutMs: request.timeoutMs ?? 300000,
        signal: request.signal,
        onStream: request.onStream,
      });
      return {
        text: res.text,
        rawLog: res.rawLog,
        transportUsed: 'acp',
        modelUsed: request.modelId || 'default',
        durationMs: Date.now() - start,
        exitCode: 0,
      };
    }

    return this.executeHeadless(spec, fullPrompt, request, start);
  }

  private executeHeadless(
    spec: DshLaunchSpec,
    fullPrompt: string,
    request: AdapterExecuteRequest,
    start: number
  ): Promise<AdapterExecuteResult> {
    let tmpPatchPath: string | undefined;

    // If modelId is an ACP JSON tuple ["provider","model"], generate a temporary Cordis patch overlay
    if (request.modelId && request.modelId.startsWith('[')) {
      try {
        const pair = JSON.parse(request.modelId) as [string, string];
        if (Array.isArray(pair) && pair.length === 2) {
          tmpPatchPath = path.join(
            os.tmpdir(),
            `agent-team-dsh-patch-${crypto.randomBytes(6).toString('hex')}.yml`
          );
          const yaml = `- id: agent-default-model\n  config:\n    provider: ${JSON.stringify(pair[0])}\n    model: ${JSON.stringify(pair[1])}\n`;
          fs.writeFileSync(tmpPatchPath, yaml, 'utf8');
        }
      } catch {
        // ignore
      }
    }

    const args: string[] = [...spec.baseArgs, '--profile', 'headless'];
    if (tmpPatchPath) {
      args.push('--patch', tmpPatchPath);
    }
    args.push('--json', '--approval-policy', 'never');

    if (request.permissionMode === 'safe') {
      args.push('--permission-mode', 'read-only');
    } else {
      args.push('--permission-mode', 'workspace-write');
    }
    args.push('-');

    return new Promise<AdapterExecuteResult>((resolve, reject) => {
      const proc = spawn(spec.command, args, {
        cwd: request.workspaceDir,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let buf = '';
      let rawLog = '';
      let collectedText = '';
      let finalMessage = '';
      let stderrText = '';
      let settled = false;

      const cleanup = () => {
        if (tmpPatchPath) {
          try {
            if (fs.existsSync(tmpPatchPath)) fs.unlinkSync(tmpPatchPath);
          } catch {
            // ignore
          }
        }
      };

      const finish = (err?: Error, code: number | null = 0) => {
        if (settled) return;
        settled = true;
        watchdog.stop();
        request.signal?.removeEventListener('abort', onAbort);
        cleanup();
        if (err) {
          reject(err);
        } else {
          resolve({
            text: (finalMessage || collectedText || rawLog).trim(),
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
        finish(new Error('DeepSeek Harness 任务已被取消'));
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      const idleMs = request.timeoutMs ?? 300000;
      const watchdog = createIdleWatchdog(idleMs, () => {
        killProcessTree(proc);
        finish(new Error(`DeepSeek Harness 实时输出流闲置超过 ${idleMs}ms 且未汇报任务完成`));
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
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            const txt =
              typeof obj.text === 'string'
                ? obj.text
                : typeof obj.delta === 'string'
                  ? obj.delta
                  : typeof obj.message === 'string'
                    ? obj.message
                    : '';
            if (obj.type === 'final' || obj.type === 'result' || obj.type === 'completed') {
              if (typeof obj.output === 'string') finalMessage = obj.output;
              else if (txt) finalMessage = txt;
            } else if (txt) {
              collectedText += txt;
              rawLog += txt;
              request.onStream?.(txt, 'text');
            }
          } catch {
            collectedText += line + '\n';
            rawLog += line + '\n';
            request.onStream?.(line + '\n', 'text');
          }
        }
      });

      proc.stderr.on('data', (chunk: string) => {
        watchdog.touch();
        stderrText += chunk;
        request.onStream?.(chunk, 'stderr');
      });

      proc.on('error', (err) => finish(err));
      proc.on('close', (code) => {
        if (code !== 0 && !finalMessage && !collectedText) {
          finish(
            new Error(`DeepSeek Harness 退出异常 (code=${code}): ${stderrText.slice(-500)}`),
            code
          );
        } else {
          finish(undefined, code);
        }
      });

      proc.stdin.write(fullPrompt);
      proc.stdin.end();
    });
  }
}
