import { spawn } from 'child_process';
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

interface ZCodeLaunchSpec {
  command: string;
  baseArgs: string[];
  env: Record<string, string | undefined>;
  displayPath: string;
}

export class ZCodeAdapter implements HarnessAdapter {
  readonly id = 'zcode' as const;

  private async resolveLaunchSpec(customPath?: string): Promise<ZCodeLaunchSpec | undefined> {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

    const inPath = await findInPath('zcode');
    const candidate = firstExistingPath([
      customPath,
      inPath,
      path.join(home, '.local', 'bin', 'zcode.exe'),
      path.join(home, '.zcode', 'cli', 'zcode.exe'),
      path.join(home, '.zcode', 'cli', 'zcode.cjs'),
      path.join(appData, 'npm', 'zcode.cmd'),
      path.join(localAppData, 'Programs', 'ZCode', 'resources', 'zcode.cjs'),
      path.join(localAppData, 'Programs', 'ZCode', 'ZCode.exe'),
    ]);

    if (!candidate) return undefined;

    const lower = candidate.toLowerCase();
    if (lower.endsWith('.cjs') || lower.endsWith('.js') || lower.endsWith('.mjs')) {
      const nodeExe = await resolveSystemNode();
      return { command: nodeExe, baseArgs: [candidate], env: {}, displayPath: candidate };
    }

    if (lower.endsWith('zcode.exe')) {
      // Check if bundled Electron app ships resources/zcode.cjs
      const bundledCjs = path.join(path.dirname(candidate), 'resources', 'zcode.cjs');
      if (fs.existsSync(bundledCjs)) {
        return {
          command: candidate,
          baseArgs: [bundledCjs],
          env: { ELECTRON_RUN_AS_NODE: '1' },
          displayPath: candidate,
        };
      }
      return { command: candidate, baseArgs: [], env: {}, displayPath: candidate };
    }

    if (lower.endsWith('.cmd')) {
      return {
        command: 'cmd.exe',
        baseArgs: ['/d', '/s', '/c', candidate],
        env: {},
        displayPath: candidate,
      };
    }

    return { command: candidate, baseArgs: [], env: {}, displayPath: candidate };
  }

  async detect(customExecutablePath?: string): Promise<DetectedHarness> {
    const detectedAt = new Date().toISOString();
    const zcodeHome = path.join(os.homedir(), '.zcode');
    const hasHome = fs.existsSync(zcodeHome);
    const models = this.detectModelsFromConfig(zcodeHome);
    const spec = await this.resolveLaunchSpec(customExecutablePath);

    if (!spec) {
      return {
        id: this.id,
        name: 'ZCode',
        vendor: 'Z.ai',
        description: 'Z.ai 编程 Agent 工位（支持 zcode -p --json 无头模式）',
        status: hasHome ? 'missing_cli' : 'not_installed',
        statusMessage: hasHome
          ? '检测到 ~/.zcode 配置目录，但未在 PATH 中检测到 ZCode CLI 可执行文件（可安装 CLI 或点击「手动指定」zcode.exe / zcode.cjs）'
          : '未检测到 ZCode，请安装 ZCode 或点击「手动指定」可执行路径',
        supportedTransports: ['headless'],
        defaultTransport: 'headless',
        models,
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

    return {
      id: this.id,
      name: 'ZCode',
      vendor: 'Z.ai',
      description: 'Z.ai 编程 Agent 工位（支持 zcode -p --json 无头模式）',
      status: 'ready',
      statusMessage:
        models.length > 0
          ? `已就绪 · 识别到 ${models.length} 个模型配置（原生 zcode -p --json）`
          : '已检测到 ZCode CLI（暂未发现模型列表，运行时将采用当前账号默认模型）',
      executablePath: spec.displayPath,
      version,
      supportedTransports: ['headless'],
      defaultTransport: 'headless',
      models:
        models.length > 0
          ? models
          : [
              {
                id: 'default',
                name: 'ZCode 当前默认模型',
                provider: 'Z.ai',
              },
            ],
      detectedAt,
    };
  }

  /**
   * Reads ONLY non-secret provider/model metadata from ~/.zcode/v2/.
   * Explicitly never reads credentials.json or API keys/tokens.
   */
  private detectModelsFromConfig(zcodeHome: string): DetectedModel[] {
    const models: DetectedModel[] = [];
    const seen = new Set<string>();

    const addModel = (id: string, name?: string, provider?: string) => {
      const cleanId = id.trim();
      if (!cleanId || seen.has(cleanId)) return;
      seen.add(cleanId);
      models.push({
        id: cleanId,
        name: name?.trim() || cleanId,
        provider: provider || 'Z.ai',
      });
    };

    try {
      const providerConfigPath = path.join(zcodeHome, 'v2', 'provider_config.json');
      if (fs.existsSync(providerConfigPath)) {
        const raw = JSON.parse(fs.readFileSync(providerConfigPath, 'utf8')) as {
          config?: {
            modelConfigRules?: {
              providerModelRules?: Array<{ modelId?: string; modelName?: string; providerId?: string }>;
              manualProviderModelRules?: Array<{ modelId?: string; modelName?: string; providerId?: string }>;
            };
          };
        };
        const rules = [
          ...(raw.config?.modelConfigRules?.providerModelRules || []),
          ...(raw.config?.modelConfigRules?.manualProviderModelRules || []),
        ];
        for (const r of rules) {
          if (r.modelId) {
            addModel(r.modelId, r.modelName || r.modelId, r.providerId || 'Z.ai');
          }
        }
      }

      const settingPath = path.join(zcodeHome, 'v2', 'setting.json');
      if (fs.existsSync(settingPath)) {
        const raw = JSON.parse(fs.readFileSync(settingPath, 'utf8')) as {
          enabledBuiltinAgentCliProviders?: string[];
          defaultModel?: string;
        };
        if (typeof raw.defaultModel === 'string' && raw.defaultModel.trim()) {
          addModel(raw.defaultModel, `ZCode 默认 (${raw.defaultModel})`, 'Z.ai');
        }
        if (Array.isArray(raw.enabledBuiltinAgentCliProviders)) {
          for (const prov of raw.enabledBuiltinAgentCliProviders) {
            if (typeof prov === 'string' && prov.trim()) {
              addModel('default', `ZCode 默认 (${prov.toUpperCase()})`, prov.toUpperCase());
            }
          }
        }
      }
    } catch {
      // ignore malformed local config
    }

    return models;
  }

  async execute(request: AdapterExecuteRequest): Promise<AdapterExecuteResult> {
    const start = Date.now();
    const spec = await this.resolveLaunchSpec(request.customExecutablePath);
    if (!spec) {
      throw new Error('未找到 ZCode CLI 可执行文件，请在「本机 Agent 探测」页面配置路径');
    }

    const fullPrompt = request.systemPrompt
      ? `[角色系统指令]\n${request.systemPrompt}\n\n[当前任务]\n${request.prompt}`
      : request.prompt;

    const mode =
      request.permissionMode === 'full-auto'
        ? 'yolo'
        : request.permissionMode === 'workspace-write'
          ? 'build'
          : 'plan';

    const args: string[] = [
      ...spec.baseArgs,
      '--json',
      '--mode',
      mode,
      '--cwd',
      request.workspaceDir,
      '-p',
      fullPrompt,
    ];

    return new Promise<AdapterExecuteResult>((resolve, reject) => {
      const proc = spawn(spec.command, args, {
        cwd: request.workspaceDir,
        env: { ...process.env, ...spec.env },
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
        finish(new Error('ZCode 任务已被取消'));
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      const idleMs = request.timeoutMs ?? 300000;
      const watchdog = createIdleWatchdog(idleMs, () => {
        killProcessTree(proc);
        finish(new Error(`ZCode 实时输出流闲置超过 ${idleMs}ms 且未汇报任务完成`));
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
          finish(new Error(`ZCode 退出异常 (code=${code}): ${stderrText.slice(-500)}`), code);
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
      if (typeof obj.result === 'string') {
        return { text: '', finalResult: obj.result, channel: 'text' };
      }
      if (typeof obj.output === 'string') {
        return { text: '', finalResult: obj.output, channel: 'text' };
      }
      if (typeof obj.text === 'string') {
        return { text: obj.text, channel: 'text' };
      }
      if (typeof obj.delta === 'string') {
        return { text: obj.delta, channel: 'text' };
      }
      if (typeof obj.message === 'string') {
        return { text: obj.message, channel: 'text' };
      }
      return { text: '', channel: 'text' };
    } catch {
      return { text: line + '\n', channel: 'text' };
    }
  }
}
