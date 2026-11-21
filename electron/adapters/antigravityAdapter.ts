import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { DetectedHarness, DetectedModel } from '../types/domain';
import { AcpClient, killProcessTree } from './acpClient';
import { createIdleWatchdog, findInPath, firstExistingPath, runQuickCommand } from './execUtils';
import { AdapterExecuteRequest, AdapterExecuteResult, HarnessAdapter } from './types';

export class AntigravityAdapter implements HarnessAdapter {
  readonly id = 'antigravity' as const;

  private async resolveExecutable(customPath?: string): Promise<string | undefined> {
    const home = os.homedir();
    const inPath = await findInPath('agy');
    return firstExistingPath([
      customPath,
      inPath,
      path.join(home, '.gemini', 'bin', 'agy.exe'),
      path.join(home, '.local', 'bin', 'agy.exe'),
    ]);
  }

  async detect(customExecutablePath?: string): Promise<DetectedHarness> {
    const detectedAt = new Date().toISOString();
    const exe = await this.resolveExecutable(customExecutablePath);

    if (!exe) {
      return {
        id: this.id,
        name: 'Antigravity',
        vendor: 'Google',
        description: 'Google Antigravity 原生 CLI / ACP 工位（Gemini 4 系列及内置多模态/工具能力）',
        status: 'not_installed',
        statusMessage: '未检测到 agy.exe，请安装 Antigravity CLI 或手动指定路径',
        supportedTransports: ['acp', 'headless'],
        defaultTransport: 'acp',
        models: [],
        detectedAt,
      };
    }

    const [verRes, modelsRes] = await Promise.all([
      runQuickCommand(exe, ['--version'], 6000),
      runQuickCommand(exe, ['models'], 12000),
    ]);

    const version = (verRes.stdout || verRes.stderr).trim().split(/\r?\n/)[0] || 'unknown';
    const models = this.parseModelsOutput(modelsRes.stdout);

    return {
      id: this.id,
      name: 'Antigravity',
      vendor: 'Google',
      description: 'Google Antigravity 原生 CLI / ACP 工位（Gemini 4 系列及内置多模态/工具能力）',
      status: 'ready',
      statusMessage:
        models.length > 0
          ? `已就绪 · 探测到 ${models.length} 个可用模型（支持原生 ACP 与 Headless 流式）`
          : '已检测到 agy.exe，但暂未拉取到模型列表（请检查登录态）',
      executablePath: exe,
      version,
      supportedTransports: ['acp', 'headless'],
      defaultTransport: 'acp',
      models:
        models.length > 0
          ? models
          : [
              { id: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)', supportsImage: true },
              { id: 'gemini-4-neon-xhigh', name: 'Gemini 4 Neon (XHigh)', supportsImage: true },
            ],
      detectedAt,
    };
  }

  private parseModelsOutput(stdout: string): DetectedModel[] {
    const models: DetectedModel[] = [];
    const seen = new Set<string>();
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.toLowerCase().startsWith('fetching ')) continue;
      const parts = line.split(/\t+/);
      const id = parts[0]?.trim();
      const name = parts[1]?.trim() || id;
      if (!id || seen.has(id) || id.includes(' ')) continue;
      seen.add(id);
      models.push({
        id,
        name,
        provider: 'Antigravity',
        supportsImage: true,
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      });
    }
    return models;
  }

  async execute(request: AdapterExecuteRequest): Promise<AdapterExecuteResult> {
    const start = Date.now();
    const exe = await this.resolveExecutable(request.customExecutablePath);
    if (!exe) {
      throw new Error('未找到 Antigravity CLI (agy.exe)，请在「本机 Agent」页面配置路径');
    }

    const transport = request.transportMode ?? 'acp';
    const fullPrompt = request.systemPrompt
      ? `[角色系统指令]\n${request.systemPrompt}\n\n[当前任务]\n${request.prompt}`
      : request.prompt;

    if (transport === 'acp') {
      const client = new AcpClient({
        command: exe,
        args: ['acp'],
        cwd: request.workspaceDir,
      });
      const res = await client.runPrompt({
        prompt: fullPrompt,
        modelId: request.modelId,
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

    return this.executeHeadless(exe, fullPrompt, request, start);
  }

  private executeHeadless(
    exe: string,
    fullPrompt: string,
    request: AdapterExecuteRequest,
    start: number
  ): Promise<AdapterExecuteResult> {
    return new Promise((resolve, reject) => {
      const args: string[] = ['--output-format', 'stream-json'];
      if (request.modelId && request.modelId !== 'default') {
        args.push('--model', request.modelId);
      }
      if (request.effort) {
        args.push('--effort', request.effort);
      }
      if (request.permissionMode === 'full-auto') {
        args.push('--dangerously-skip-permissions');
      } else if (request.permissionMode === 'workspace-write') {
        args.push('--mode', 'accept-edits');
      } else {
        args.push('--mode', 'plan');
      }
      args.push('-p', fullPrompt);

      const proc = spawn(exe, args, {
        cwd: request.workspaceDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let buf = '';
      let rawLog = '';
      let accumulatedText = '';
      let finalResultText = '';
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
            text: (finalResultText || accumulatedText || rawLog).trim(),
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
        finish(new Error('Antigravity 任务已被取消'));
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      const idleMs = request.timeoutMs ?? 300000;
      const watchdog = createIdleWatchdog(idleMs, () => {
        killProcessTree(proc);
        finish(new Error(`Antigravity Headless 实时输出流闲置超过 ${idleMs}ms 且未汇报任务完成`));
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
          const parsed = this.extractStreamLine(line);
          if (parsed.finalResult) {
            finalResultText = parsed.finalResult;
          }
          if (parsed.text) {
            accumulatedText += parsed.text;
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
          const parsed = this.extractStreamLine(buf.trim());
          if (parsed.finalResult) finalResultText = parsed.finalResult;
          if (parsed.text) {
            accumulatedText += parsed.text;
            rawLog += parsed.text;
          }
        }
        if (code !== 0 && !finalResultText && !accumulatedText) {
          finish(new Error(`Antigravity 退出异常 (code=${code}): ${stderrText.slice(-500)}`), code);
        } else {
          finish(undefined, code);
        }
      });
    });
  }

  private extractStreamLine(line: string): {
    text: string;
    finalResult?: string;
    channel: 'text' | 'thought' | 'tool';
  } {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      // Official agy --output-format stream-json schema
      if (obj.event === 'result' && obj.result && typeof obj.result === 'object') {
        const resObj = obj.result as { response?: string };
        if (typeof resObj.response === 'string') {
          return { text: '', finalResult: resObj.response, channel: 'text' };
        }
      }
      if (obj.event === 'step_update' && obj.step_update && typeof obj.step_update === 'object') {
        const su = obj.step_update as {
          step_type?: string;
          text_delta?: string;
          thinking_delta?: string;
          tool_name?: string;
          state?: string;
        };
        if (typeof su.text_delta === 'string' && su.text_delta) {
          return { text: su.text_delta, channel: 'text' };
        }
        if (typeof su.thinking_delta === 'string' && su.thinking_delta) {
          return { text: su.thinking_delta, channel: 'thought' };
        }
        if (su.tool_name && su.state === 'ACTIVE') {
          return { text: `\n[工具] ${su.tool_name}\n`, channel: 'tool' };
        }
        return { text: '', channel: 'text' };
      }
      if (obj.event === 'init') {
        return { text: '', channel: 'text' };
      }
      if (obj.type === 'result' && typeof obj.result === 'string') {
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
