import {
  DetectedHarness,
  HarnessId,
  PermissionMode,
  TransportMode,
} from '../types/domain';

export interface AdapterExecuteRequest {
  prompt: string;
  systemPrompt?: string;
  modelId?: string;
  transportMode?: TransportMode;
  workspaceDir: string;
  effort?: string;
  permissionMode: PermissionMode;
  imagePaths?: string[];
  /** Maximum consecutive idle silence (ms) on live stream before timing out (default 300000ms) */
  timeoutMs?: number;
  customExecutablePath?: string;
  signal?: AbortSignal;
  onStream?: (chunk: string, channel: 'text' | 'thought' | 'tool' | 'stderr') => void;
}

export interface AdapterExecuteResult {
  text: string;
  rawLog: string;
  transportUsed: TransportMode;
  modelUsed: string;
  durationMs: number;
  exitCode: number | null;
}

export interface HarnessAdapter {
  readonly id: HarnessId;
  detect(customExecutablePath?: string): Promise<DetectedHarness>;
  execute(request: AdapterExecuteRequest): Promise<AdapterExecuteResult>;
}
