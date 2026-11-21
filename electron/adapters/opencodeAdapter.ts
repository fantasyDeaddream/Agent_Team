import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DetectedHarness, DetectedModel } from '../types/domain';
import { AcpClient, killProcessTree } from './acpClient';
import {
  createIdleWatchdog,
  findInPath,
  firstExistingPath,
  resolveSystemNode,
  runQuickCommand,
} from './execUtils';
import { AdapterExecuteRequest, AdapterExecuteResult, HarnessAdapter } from './types';

interface OpenCodeLaunchSpec {
  command: string;
  baseArgs: string[];
  displayPath: string;
}

export class OpenCodeAdapter implements HarnessAdapter {
  readonly id = 'opencode' as const;

  private async resolveLaunchSpec(customPath?: string): Promise<OpenCodeLaunchSpec | undefined> {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

    const inPath = await findInPath('opencode');
    const candidate = firstExistingPath([
      customPath,
      inPath,
      path.join(home, '.opencode', 'bin', 'opencode.exe'),
      path.join(home, '.local', 'bin', 'opencode.exe'),
      path.join(localAppData, 'Programs', 'OpenCode', 'resources', 'opencode-cli.exe'),
      path.join(localAppData, 'Programs', 'OpenCode', 'opencode.exe'),
      path.join(appData, 'npm', 'opencode.cmd'),
    ]);

    if (!candidate) return undefined;

    const lower = candidate.toLowerCase();
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
      const nodeExe = await resolveSystemNode();
      return { command: nodeExe, baseArgs: [candidate], displayPath: candidate };
    }

    if (lower.endsWith('.cmd')) {
      // Try resolving npm global opencode JS entrypoint cleanly to avoid cmd quoting issues
      const siblingDir = path.dirname(candidate);
      const jsCandidates = [
        path.join(siblingDir, 'node_modules', 'opencode-ai', 'bin', 'opencode'),
        path.join(siblingDir, 'node_modules', 'opencode', 'bin', 'opencode.js'),
      ];
      for (const jsPath of jsCandidates) {
        if (fs.existsSync(jsPath)) {
          const nodeExe = await resolveSystemNode();
          return { command: nodeExe, baseArgs: [jsPath], displayPath: candidate };
        }
      }
      return {
        command: 'cmd.exe',
        baseArgs: ['/d', '/s', '/c', candidate],
        displayPath: candidate,
      };
    }

    return { command: candidate, baseArgs: [], displayPath: candidate };
  }

  async detect(customExecutablePath?: string): Promise<DetectedHarness> {
    const detectedAt = new Date().toISOString();
    const spec = await this.resolveLaunchSpec(customExecutablePath);

    if (!spec) {
      const localAppData =
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const desktopDir = path.join(localAppData, 'Programs', '@opencodedesktop');
      const hasLegacyDir = fs.existsSync(desktopDir);
      return {
        id: this.id,
        name: 'OpenCode',
        vendor: 'OpenCode',
        description: '开源终端/桌面多模型编程 Agent（支持 opencode run --format json 与 ACP）',
        status: hasLegacyDir ? 'missing_cli' : 'not_installed',
        statusMessage: hasLegacyDir
          ? '未检测到 opencode CLI（检测到桌面端目录，请安装 OpenCode CLI 或点击「手动指定」可执行文件）'
          : '未检测到 OpenCode CLI，请安装 opencode 或点击「手动指定」路径',
        supportedTransports: ['headless', 'acp'],
        defaultTransport: 'headless',
        models: [],
        detectedAt,
      };
    }

    const [verRes, modelsRes] = await Promise.all([
      runQuickCommand(spec.command, [...spec.baseArgs, '--version'], 8000),
      runQuickCommand(spec.command, [...spec.baseArgs, 'models'], 12000),
    ]);

    const version = (verRes.stdout || verRes.stderr).trim().split(/\r?\n/)[0] || 'unknown';
    const models = this.parseModelsOutput(modelsRes.stdout);

    return {
      id: this.id,
      name: 'OpenCode',
      vendor: 'OpenCode',
      description: '开源终端/桌面多模型编程 Agent（支持 opencode run --format json 与 ACP）',
      status: 'ready',
      statusMessage:
        models.length > 0
          ? `已就绪 · 探测到 ${models.length} 个可用模型（支持 Headless JSON 与 ACP）`
          : '已检测到 OpenCode CLI，但暂未拉取到已配置模型（将使用默认配置或检查 provider 鉴权）',
      executablePath: spec.displayPath,
      version,
      supportedTransports: ['headless', 'acp'],
      defaultTransport: 'headless',
      models:
        models.length > 0
          ? models
          : [
              {
                id: 'default',
                name: 'OpenCode 默认模型',
                provider: 'OpenCode',
              },
            ],
      detectedAt,
    };
  }

  private parseModelsOutput(stdout: string): DetectedModel[] {
    const models: DetectedModel[] = [];
    const seen = new Set<string>();
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('─')) continue;
      // OpenCode models outputs lines like `anthropic/claude-sonnet-4` or `openai/gpt-5`
      const token = line.split(/\s+/)[0];
      if (!token || !token.includes('/') || seen.has(token)) continue;
      seen.add(token);
      const [provider, ...rest] = token.split('/');
      const modelName = rest.join('/');
      models.push({
        id: token,
        name: `${provider} · ${modelName}`,
        provider,
        supportsImage: true,
      });
    }
    return models;
  }

  async execute(request: AdapterExecuteRequest): Promise<AdapterExecuteResult> {
    const start = Date.now();
    const spec = await this.resolveLaunchSpec(request.customExecutablePath);
    if (!spec) {
      throw new Error('未找到 OpenCode CLI (opencode)，请在「本机 Agent 探测」页面配置路径');
    }

    const transport = request.transportMode ?? 'headless';
    const fullPrompt = request.systemPrompt
      ? `[角色系统指令]\n${request.systemPrompt}\n\n[当前任务]\n${request.prompt}`
      : request.prompt;

    if (transport === 'acp') {
      const client = new AcpClient({
        command: spec.command,
        args: [...spec.baseArgs, 'acp'],
        cwd: request.workspaceDir,
      });
      const res = await client.runPrompt({
        prompt: fullPrompt,
        modelId: request.modelId && request.modelId !== 'default' ? request.modelId : undefined,
        effort: request.effort,
        permissionMode: request.permissionMode,
        imagePaths: request.imagePaths,
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
    spec: OpenCodeLaunchSpec,
    fullPrompt: string,
    request: AdapterExecuteRequest,
    start: number
  ): Promise<AdapterExecuteResult> {
    return new Promise((resolve, reject) => {
      const args: string[] = [...spec.baseArgs, 'run', '--format', 'json'];
      if (request.modelId && request.modelId !== 'default') {
        args.push('--model', request.modelId);
      }
      args.push(fullPrompt);

      const proc = spawn(spec.command, args, {
        cwd: request.workspaceDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let buf = '';
      let rawLog = '';
      let collectedText = '';
      let finalResult = '';
      let stderrText = '';
      let settled = false;

      const finish = (err?: Error, code: number | null = 0) => {
        if (settled) return;
        settled = true;
        watchdog.stop();
        request.signal?.removeEventListener('abort', onAbort);
        if (err) {
          reject(err);
        } else {
          resolve({
            text: (finalResult || collectedText || rawLog).trim(),
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
        finish(new Error('OpenCode 任务已被取消'));
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      const idleMs = request.timeoutMs ?? 300000;
      const watchdog = createIdleWatchdog(idleMs, () => {
        killProcessTree(proc);
        finish(new Error(`OpenCode 实时输出流闲置超过 ${idleMs}ms 且未汇报任务完成`));
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
          const parsed = this.parseEventLine(line);
          if (parsed.finalResult) finalResult = parsed.finalResult;
          if (parsed.text) {
            collectedText += parsed.text;
            rawLog += parsed.text;
            request.onStream?.(parsed.text, parsed.channel);
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
        if (buf.trim()) {
          const parsed = this.parseEventLine(buf.trim());
          if (parsed.finalResult) finalResult = parsed.finalResult;
          if (parsed.text) {
            collectedText += parsed.text;
            rawLog += parsed.text;
          }
        }
        if (code !== 0 && !finalResult && !collectedText) {
          finish(new Error(`OpenCode 退出异常 (code=${code}): ${stderrText.slice(-500)}`), code);
        } else {
          finish(undefined, code);
        }
      });
    });
  }

  private parseEventLine(line: string): {
    text: string;
    finalResult?: string;
    channel: 'text' | 'thought' | 'tool';
  } {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === 'text' && obj.part && typeof obj.part === 'object') {
        const text = (obj.part as { text?: string }).text;
        if (text) return { text, channel: 'text' };
      }
      if (obj.type === 'tool_use' && obj.part && typeof obj.part === 'object') {
        const tool = (obj.part as { tool?: string }).tool;
        if (tool) return { text: `\n[工具] ${tool}\n`, channel: 'tool' };
      }
      if (typeof obj.result === 'string') {
        return { text: '', finalResult: obj.result, channel: 'text' };
      }
      if (typeof obj.text === 'string') {
        return { text: obj.text, channel: 'text' };
      }
      return { text: '', channel: 'text' };
    } catch {
      return { text: line + '\n', channel: 'text' };
    }
  }
}
