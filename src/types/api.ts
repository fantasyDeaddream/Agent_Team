import type {
  AppSettings,
  DetectedHarness,
  HarnessId,
  OrchestrationRun,
  PingResult,
  RunEventPayload,
  StartRunRequest,
  SubmitManualRoutesRequest,
  TransportMode,
} from '@shared/domain';

export interface AgentTeamBridge {
  detectHarnesses: () => Promise<{ harnesses: DetectedHarness[]; settings: AppSettings }>;
  pingHarness: (args: {
    harnessId: HarnessId;
    modelId: string;
    transportMode: TransportMode;
    workspaceDir?: string;
  }) => Promise<PingResult>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  resetRoles: () => Promise<AppSettings>;
  autoFillRoutes: () => Promise<AppSettings>;
  startRun: (req: StartRunRequest) => Promise<OrchestrationRun>;
  submitManualRoutes: (req: SubmitManualRoutesRequest) => Promise<boolean>;
  cancelRun: () => Promise<boolean>;
  listRuns: () => Promise<OrchestrationRun[]>;
  getRun: (runId: string) => Promise<OrchestrationRun | undefined>;
  deleteRun: (runId: string) => Promise<boolean>;
  pickFolder: () => Promise<string | null>;
  pickExecutable: () => Promise<string | null>;
  openPath: (targetPath: string) => Promise<string>;
  onRunEvent: (listener: (payload: RunEventPayload) => void) => () => void;
}

declare global {
  interface Window {
    agentTeam: AgentTeamBridge;
  }
}

export {};
