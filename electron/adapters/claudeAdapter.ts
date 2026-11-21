import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DetectedHarness, DetectedModel } from '../types/domain';
import { killProcessTree } from './acpClient';
import { createIdleWatchdog, findInPath, firstExistingPath, runQuickCommand } from './execUtils';
import { AdapterExecuteRequest, AdapterExecuteResult, HarnessAdapter } from './types';

export class ClaudeAdapter implements HarnessAdapter {
  readonly id = 'claude' as const;

  private async resolveExecutable(customPath?: string): Promise<string | undefined> {
    const home = os.homedir();
    const inPath = await findInPath('claude');
    return firstExistingPath([
      customPath,
      inPath,
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
    ]);
  }

  async detect(customExecutablePath?: string): Promise<DetectedHarness> {
    const detectedAt = new Date().toISOString();
    const exe = await this.resolveExecutable(customExecutablePath);

    if (!exe) {
      return {
        id: this.id,
        name: 'Claude Code',
        vendor: 'Anthropic',
        description: 'Anthropic Claude Code 原生终端工位（前端/全栈开发与复杂重构优势）',
        status: 'not_installed',
        statusMessage: '未检测到 claude.exe，请安装 Claude Code CLI 或手动指定路径',
        supportedTransports: ['headless'],
        defaultTransport: 'headless',
        models: [],
        detectedAt,
      };
    }

    const verRes = await runQuickCommand(exe, ['--version'], 6000);
    const version = (verRes.stdout || verRes.stderr).trim().split(/\r?\n/)[0] || 'unknown';
    const models = this.detectModelsFromSettings();

    return {
      id: this.id,
      name: 'Claude Code',
      vendor: 'Anthropic',
      description: 'Anthropic Claude Code 原生终端工位（前端/全栈开发与复杂重构优势）',
      status: 'ready',
      statusMessage: `已就绪 · 识别到 ${models.length} 个可调度模型槽位（原生 Headless Stream-JSON）`,
      executablePath: exe,
      version,
      supportedTransports: ['headless'],
      defaultTransport: 'headless',
      models,
      detectedAt,
    };
  }

  /**
   * Reads ONLY non-secret model alias/name metadata from ~/.claude/settings.json.
   * Explicitly never accesses auth tokens or keys.
   */
  private detectModelsFromSettings(): DetectedModel[] {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const envMeta: Record<string, string> = {};
    let defaultSettingModel = '';

    try {
      if (fs.existsSync(settingsPath)) {
        const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
          model?: string;
          env?: Record<string, string>;
        };
        if (typeof raw.model === 'string') {
          defaultSettingModel = raw.model;
        }
        if (raw.env && typeof raw.env === 'object') {
          const safeKeys = [
            'ANTHROPIC_DEFAULT_OPUS_MODEL',
            'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
            'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
            'ANTHROPIC_DEFAULT_SONNET_MODEL',
            'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
            'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
            'ANTHROPIC_DEFAULT_HAIKU_MODEL',
            'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
            'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
          ];
          for (const key of safeKeys) {
            if (typeof raw.env[key] === 'string' && raw.env[key].trim()) {
              envMeta[key] = raw.env[key].trim();
            }
          }
        }
      }
    } catch {
      // Ignore malformed settings
    }

    const models: DetectedModel[] = [
      {
        id: 'default',
        name: defaultSettingModel
          ? `Claude 默认 (${defaultSettingModel})`
          : 'Claude 当前默认路由模型',
        provider: 'Claude Code',
        description: '跟随 Claude Code 当前生效的模型配置',
        supportsImage: true,
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'opus',
        name: this.formatTierName(
          'Opus',
          envMeta.ANTHROPIC_DEFAULT_OPUS_MODEL,
          envMeta.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME
        ),
        provider: 'Claude Code',
        description: envMeta.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION || 'Claude Opus 旗舰档位',
        supportsImage: true,
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'sonnet',
        name: this.formatTierName(
          'Sonnet',
          envMeta.ANTHROPIC_DEFAULT_SONNET_MODEL,
          envMeta.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME
        ),
        provider: 'Claude Code',
        description: envMeta.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION || 'Claude Sonnet 均衡开发档位',
        supportsImage: true,
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'haiku',
        name: this.formatTierName(
          'Haiku',
          envMeta.ANTHROPIC_DEFAULT_HAIKU_MODEL,
          envMeta.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME
        ),
        provider: 'Claude Code',
        description: envMeta.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION || 'Claude Haiku 轻量高速档位',
        supportsImage: true,
        effortOptions: ['low', 'medium', 'high'],
      },
    ];

    return models;
  }

  private formatTierName(tier: string, modelId?: string, mappedName?: string): string {
    if (mappedName && modelId) return `${tier} → ${mappedName} (${modelId})`;
    if (modelId) return `${tier} (${modelId})`;
    return `Claude ${tier}`;
  }

  execute(request: AdapterExecuteRequest): Promise<AdapterExecuteResult> {
    const start = Date.now();
    return this.resolveExecutable(request.customExecutablePath).then((exe) => {
      if (!exe) {
        throw new Error('未找到 Claude Code CLI (claude.exe)，请在「本机 Agent」页面配置路径');
      }

      return new Promise<AdapterExecuteResult>((resolve, reject) => {
        const args: string[] = [
          '-p',
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages',
        ];

        if (request.modelId && request.modelId !== 'default') {
          args.push('--model', request.modelId);
        }
        if (request.effort) {
          args.push('--effort', request.effort);
        }
        if (request.systemPrompt) {
          args.push('--append-system-prompt', request.systemPrompt);
        }
        if (request.permissionMode === 'full-auto') {
          args.push('--dangerously-skip-permissions');
        } else if (request.permissionMode === 'workspace-write') {
          args.push('--permission-mode', 'acceptEdits');
        } else {
          args.push('--permission-mode', 'plan');
        }

        const promptWithImages =
          request.imagePaths && request.imagePaths.length > 0
            ? `${request.prompt}\n\n[待审阅视觉文件列表（请用你的文件查看工具直接读取以下路径图片）]\n${request.imagePaths.map((p) => `- ${p}`).join('\n')}`
            : request.prompt;

        const proc = spawn(exe, args, {
          cwd: request.workspaceDir,
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let buf = '';
        let rawLog = '';
        let streamedText = '';
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
              text: (finalResult || streamedText || rawLog).trim(),
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
          finish(new Error('Claude Code 任务已被取消'));
        };
        request.signal?.addEventListener('abort', onAbort, { once: true });

        const idleMs = request.timeoutMs ?? 300000;
        const watchdog = createIdleWatchdog(idleMs, () => {
          killProcessTree(proc);
          finish(new Error(`Claude Code 实时输出流闲置超过 ${idleMs}ms 且未汇报任务完成`));
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
            this.handleJsonLine(
              line,
              (txt, ch) => {
                if (ch === 'text') streamedText += txt;
                rawLog += txt;
                request.onStream?.(txt, ch);
              },
              (res, isErr) => {
                if (isErr) {
                  stderrText += `\n${res}`;
                } else {
                  finalResult = res;
                }
              }
            );
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
            this.handleJsonLine(
              buf.trim(),
              (txt, ch) => {
                if (ch === 'text') streamedText += txt;
                rawLog += txt;
              },
              (res, isErr) => {
                if (isErr) stderrText += `\n${res}`;
                else finalResult = res;
              }
            );
          }
          if (code !== 0 && !finalResult && !streamedText) {
            finish(
              new Error(`Claude Code 退出异常 (code=${code}): ${stderrText.slice(-500)}`),
              code
            );
          } else {
            finish(undefined, code);
          }
        });

        proc.stdin.write(promptWithImages);
        proc.stdin.end();
      });
    });
  }

  private handleJsonLine(
    line: string,
    emit: (text: string, ch: 'text' | 'thought' | 'tool') => void,
    onResult: (result: string, isError: boolean) => void
  ): void {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === 'stream_event' && obj.event && typeof obj.event === 'object') {
        const ev = obj.event as Record<string, unknown>;
        if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta === 'object') {
          const delta = ev.delta as { type?: string; text?: string; thinking?: string };
          if (delta.type === 'text_delta' && delta.text) {
            emit(delta.text, 'text');
          } else if (delta.type === 'thinking_delta' && delta.thinking) {
            emit(delta.thinking, 'thought');
          }
        }
        return;
      }

      if (obj.type === 'assistant' && obj.message && typeof obj.message === 'object') {
        const content = (
          obj.message as { content?: Array<{ type?: string; text?: string; name?: string }> }
        ).content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use' && block.name) {
              emit(`\n[工具] ${block.name}\n`, 'tool');
            }
          }
        }
        return;
      }

      if (obj.type === 'result' && typeof obj.result === 'string') {
        onResult(obj.result, Boolean(obj.is_error));
      }
    } catch {
      emit(line + '\n', 'text');
    }
  }
}
