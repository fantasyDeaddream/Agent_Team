export type HarnessId =
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'deepseek'
  | 'opencode'
  | 'zcode';

export type TransportMode = 'acp' | 'headless';

export type HarnessStatus =
  | 'ready'
  | 'missing_cli'
  | 'not_installed'
  | 'reserved'
  | 'error';

export type PermissionMode = 'safe' | 'workspace-write' | 'full-auto';

export type RoutingMode = 'reviewer' | 'manual';

export interface DetectedModel {
  id: string;
  name: string;
  provider?: string;
  description?: string;
  supportsImage?: boolean;
  effortOptions?: string[];
  /** Extra adapter-specific payload (e.g. DSH ACP config option value) */
  meta?: Record<string, string>;
}

export interface DetectedHarness {
  id: HarnessId;
  name: string;
  vendor: string;
  description: string;
  status: HarnessStatus;
  statusMessage: string;
  executablePath?: string;
  version?: string;
  supportedTransports: TransportMode[];
  defaultTransport: TransportMode;
  models: DetectedModel[];
  detectedAt: string;
  reserved?: boolean;
}

export type RoleKind = 'leader' | 'reviewer' | 'worker';

export interface TaskRole {
  id: string;
  name: string;
  zhLabel: string;
  kind: RoleKind;
  builtIn: boolean;
  description: string;
  classificationHints: string;
  systemPrompt: string;
  color: string;
  needsVisualInput?: boolean;
  producesVisualArtifact?: boolean;
}

export interface RoleRouteConfig {
  roleId: string;
  harnessId: HarnessId;
  modelId: string;
  transportMode: TransportMode;
  effort?: string;
  /** Idle stream timeout in seconds (default 300s of continuous silence without completion) */
  timeoutSec?: number;
}

export interface AppSettings {
  roles: TaskRole[];
  routes: Record<string, RoleRouteConfig>;
  customExecutablePaths: Partial<Record<HarnessId, string>>;
  defaultWorkspaceDir: string;
  defaultMaxRounds: number;
  defaultMaxConcurrency: number;
  defaultPermissionMode: PermissionMode;
  defaultRoutingMode: RoutingMode;
  onboardingCompleted: boolean;
}

export type SubtaskStatus =
  | 'planned'
  | 'classifying'
  | 'awaiting_route'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface SubtaskItem {
  id: string;
  round: number;
  title: string;
  description: string;
  dependsOn: string[];
  expectedArtifacts: string[];
  /** Leader concurrency assessment */
  canRunInParallel?: boolean;
  parallelGroup?: string;
  parallelReason?: string;
  /** Filled exclusively by Reviewer during pre-dispatch classification */
  assignedRoleId?: string;
  assignedRoleName?: string;
  reviewerConfidence?: number;
  reviewerReason?: string;
  /** Filled by Router from user routing table */
  harnessId?: HarnessId;
  modelId?: string;
  transportMode?: TransportMode;
  /** Execution state */
  status: SubtaskStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  output?: string;
  summary?: string;
  artifactsProduced?: string[];
  error?: string;
  streamLog: string;
}

export type CommStage =
  | 'plan'
  | 'classify'
  | 'route'
  | 'execute'
  | 'review'
  | 'system'
  | 'error';

export interface CommMessage {
  id: string;
  timestamp: string;
  round: number;
  from: string;
  to: string;
  stage: CommStage;
  subtaskId?: string;
  harnessId?: HarnessId;
  modelId?: string;
  title: string;
  content: string;
}

export type RunStatus =
  | 'idle'
  | 'planning'
  | 'classifying'
  | 'awaiting_manual_routing'
  | 'executing'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface LeaderReviewRecord {
  round: number;
  decision: 'finish' | 'iterate';
  reviewNotes: string;
  timestamp: string;
}

export interface OrchestrationRun {
  id: string;
  goal: string;
  workspaceDir: string;
  artifactDir: string;
  status: RunStatus;
  routingMode: RoutingMode;
  currentRound: number;
  maxRounds: number;
  maxConcurrency: number;
  permissionMode: PermissionMode;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  planSummary?: string;
  parallelPlanSummary?: string;
  leaderReviews: LeaderReviewRecord[];
  subtasks: SubtaskItem[];
  messages: CommMessage[];
  finalReport?: string;
  error?: string;
}

export interface StartRunRequest {
  goal: string;
  workspaceDir: string;
  maxRounds: number;
  maxConcurrency: number;
  permissionMode: PermissionMode;
  routingMode: RoutingMode;
}

export interface ManualRouteAssignment {
  subtaskId: string;
  roleId: string;
}

export interface SubmitManualRoutesRequest {
  runId: string;
  assignments: ManualRouteAssignment[];
}

export interface PingResult {
  harnessId: HarnessId;
  modelId: string;
  transportMode: TransportMode;
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
}

export interface RunEventPayload {
  type: 'run-updated' | 'comm-message' | 'subtask-stream';
  runId: string;
  run?: OrchestrationRun;
  message?: CommMessage;
  subtaskId?: string;
  chunk?: string;
}
