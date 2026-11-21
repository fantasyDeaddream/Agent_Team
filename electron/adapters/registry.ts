import { DetectedHarness, HarnessId, PingResult, TransportMode } from '../types/domain';
import { AntigravityAdapter } from './antigravityAdapter';
import { ClaudeAdapter } from './claudeAdapter';
import { CodexAdapter } from './codexAdapter';
import { DeepSeekAdapter } from './deepseekAdapter';
import { OpenCodeAdapter } from './opencodeAdapter';
import { AdapterExecuteRequest, AdapterExecuteResult, HarnessAdapter } from './types';
import { ZCodeAdapter } from './zcodeAdapter';

export class HarnessRegistry {
  private readonly adapters: Map<HarnessId, HarnessAdapter>;
  private lastDetected: DetectedHarness[] = [];

  constructor() {
    const list: HarnessAdapter[] = [
      new AntigravityAdapter(),
      new ClaudeAdapter(),
      new CodexAdapter(),
      new DeepSeekAdapter(),
      new OpenCodeAdapter(),
      new ZCodeAdapter(),
    ];
    this.adapters = new Map(list.map((a) => [a.id, a]));
  }

  getAdapter(id: HarnessId): HarnessAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`未知的 Agent Harness: ${id}`);
    }
    return adapter;
  }

  async detectAll(
    customPaths: Partial<Record<HarnessId, string>> = {}
  ): Promise<DetectedHarness[]> {
    const orderedIds: HarnessId[] = [
      'antigravity',
      'claude',
      'codex',
      'deepseek',
      'opencode',
      'zcode',
    ];
    const results = await Promise.all(
      orderedIds.map((id) =>
        this.getAdapter(id)
          .detect(customPaths[id])
          .catch(
            (err): DetectedHarness => ({
              id,
              name: id,
              vendor: 'Unknown',
              description: '',
              status: 'error',
              statusMessage: `探测失败: ${String(err)}`,
              supportedTransports: ['headless'],
              defaultTransport: 'headless',
              models: [],
              detectedAt: new Date().toISOString(),
            })
          )
      )
    );
    this.lastDetected = results;
    return results;
  }

  getCachedHarnesses(): DetectedHarness[] {
    return this.lastDetected;
  }

  execute(harnessId: HarnessId, request: AdapterExecuteRequest): Promise<AdapterExecuteResult> {
    return this.getAdapter(harnessId).execute(request);
  }

  async ping(
    harnessId: HarnessId,
    modelId: string,
    transportMode: TransportMode,
    workspaceDir: string,
    customExecutablePath?: string
  ): Promise<PingResult> {
    const start = Date.now();
    try {
      const res = await this.execute(harnessId, {
        prompt: '请仅回复四个字：连通成功（不要调用任何工具，也不要输出多余解释）',
        modelId,
        transportMode,
        workspaceDir,
        permissionMode: 'safe',
        timeoutMs: 90000,
        customExecutablePath,
      });
      return {
        harnessId,
        modelId,
        transportMode,
        ok: Boolean(res.text.trim()),
        latencyMs: Date.now() - start,
        reply: res.text.slice(0, 300),
      };
    } catch (err) {
      return {
        harnessId,
        modelId,
        transportMode,
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
