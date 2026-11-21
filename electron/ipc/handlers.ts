import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { HarnessRegistry } from '../adapters/registry';
import { OrchestrationEngine } from '../orchestrator/engine';
import { ConfigStore } from '../storage/configStore';
import { buildDefaultRoutes, DEFAULT_ROLES } from '../storage/defaults';
import {
  AppSettings,
  HarnessId,
  StartRunRequest,
  SubmitManualRoutesRequest,
  TransportMode,
} from '../types/domain';

export function registerIpcHandlers(params: {
  getWindow: () => BrowserWindow | null;
  registry: HarnessRegistry;
  store: ConfigStore;
  engine: OrchestrationEngine;
}): void {
  const { getWindow, registry, store, engine } = params;

  ipcMain.handle('harnesses:detect', async () => {
    const settings = store.loadSettings();
    const detected = await registry.detectAll(settings.customExecutablePaths);
    // Keep routes untouched (empty on first launch so user explicitly chooses models in onboarding)
    return { harnesses: detected, settings };
  });

  ipcMain.handle(
    'harnesses:ping',
    async (
      _ev,
      args: {
        harnessId: HarnessId;
        modelId: string;
        transportMode: TransportMode;
        workspaceDir?: string;
      }
    ) => {
      const settings = store.loadSettings();
      return registry.ping(
        args.harnessId,
        args.modelId,
        args.transportMode,
        args.workspaceDir || settings.defaultWorkspaceDir || process.cwd(),
        settings.customExecutablePaths[args.harnessId]
      );
    }
  );

  ipcMain.handle('settings:get', async () => {
    return store.loadSettings();
  });

  ipcMain.handle('settings:save', async (_ev, next: AppSettings) => {
    return store.saveSettings(next);
  });

  ipcMain.handle('settings:resetRoles', async () => {
    const settings = store.loadSettings();
    settings.roles = DEFAULT_ROLES.map((r) => ({ ...r }));
    settings.routes = {};
    return store.saveSettings(settings);
  });

  ipcMain.handle('settings:autoFillRoutes', async () => {
    const settings = store.loadSettings();
    const detected = registry.getCachedHarnesses();
    settings.routes = buildDefaultRoutes(settings.roles, detected, settings.routes);
    return store.saveSettings(settings);
  });

  ipcMain.handle('runs:start', async (_ev, req: StartRunRequest) => {
    const settings = store.loadSettings();
    return engine.startRun(req, settings);
  });

  ipcMain.handle('runs:submitManualRoutes', async (_ev, req: SubmitManualRoutesRequest) => {
    return engine.submitManualRoutes(req);
  });

  ipcMain.handle('runs:cancel', async () => {
    return engine.cancelActiveRun();
  });

  ipcMain.handle('runs:list', async () => {
    return store.listRuns();
  });

  ipcMain.handle('runs:get', async (_ev, runId: string) => {
    return store.loadRun(runId);
  });

  ipcMain.handle('runs:delete', async (_ev, runId: string) => {
    return store.deleteRun(runId);
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择项目工作区目录',
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('dialog:pickExecutable', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openFile'],
      title: '选择 Agent 可执行文件',
      filters: [
        { name: '可执行文件 / 脚本', extensions: ['exe', 'cmd', 'bat', 'js'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('shell:openPath', async (_ev, targetPath: string) => {
    return shell.openPath(targetPath);
  });
}
