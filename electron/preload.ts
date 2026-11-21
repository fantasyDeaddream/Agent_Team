import { contextBridge, ipcRenderer } from 'electron';
import {
  AppSettings,
  DetectedHarness,
  HarnessId,
  OrchestrationRun,
  PingResult,
  RunEventPayload,
  StartRunRequest,
  SubmitManualRoutesRequest,
  TransportMode,
} from './types/domain';

const api = {
  detectHarnesses: (): Promise<{ harnesses: DetectedHarness[]; settings: AppSettings }> =>
    ipcRenderer.invoke('harnesses:detect'),
  pingHarness: (args: {
    harnessId: HarnessId;
    modelId: string;
    transportMode: TransportMode;
    workspaceDir?: string;
  }): Promise<PingResult> => ipcRenderer.invoke('harnesses:ping', args),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', settings),
  resetRoles: (): Promise<AppSettings> => ipcRenderer.invoke('settings:resetRoles'),
  autoFillRoutes: (): Promise<AppSettings> => ipcRenderer.invoke('settings:autoFillRoutes'),
  startRun: (req: StartRunRequest): Promise<OrchestrationRun> =>
    ipcRenderer.invoke('runs:start', req),
  submitManualRoutes: (req: SubmitManualRoutesRequest): Promise<boolean> =>
    ipcRenderer.invoke('runs:submitManualRoutes', req),
  cancelRun: (): Promise<boolean> => ipcRenderer.invoke('runs:cancel'),
  listRuns: (): Promise<OrchestrationRun[]> => ipcRenderer.invoke('runs:list'),
  getRun: (runId: string): Promise<OrchestrationRun | undefined> =>
    ipcRenderer.invoke('runs:get', runId),
  deleteRun: (runId: string): Promise<boolean> => ipcRenderer.invoke('runs:delete', runId),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickExecutable'),
  openPath: (targetPath: string): Promise<string> =>
    ipcRenderer.invoke('shell:openPath', targetPath),
  onRunEvent: (listener: (payload: RunEventPayload) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: RunEventPayload) =>
      listener(payload);
    ipcRenderer.on('runs:event', wrapped);
    return () => ipcRenderer.removeListener('runs:event', wrapped);
  },
};

contextBridge.exposeInMainWorld('agentTeam', api);

export type AgentTeamApi = typeof api;
