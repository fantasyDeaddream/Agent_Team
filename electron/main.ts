import { app, BrowserWindow } from 'electron';
import path from 'path';
import { HarnessRegistry } from './adapters/registry';
import { registerIpcHandlers } from './ipc/handlers';
import { OrchestrationEngine } from './orchestrator/engine';
import { ConfigStore } from './storage/configStore';
import { resolveSharedUserDataDir } from './storage/paths';
import { RunEventPayload } from './types/domain';

let mainWindow: BrowserWindow | null = null;
let engine: OrchestrationEngine | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#090b10',
    title: 'Agent_Team — 跨原生工位多 AI 协作编排台',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const store = new ConfigStore(resolveSharedUserDataDir());
  const registry = new HarnessRegistry();
  engine = new OrchestrationEngine(registry, store, (payload: RunEventPayload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('runs:event', payload);
    }
  });

  registerIpcHandlers({
    getWindow: () => mainWindow,
    registry,
    store,
    engine,
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  engine?.cancelActiveRun();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
