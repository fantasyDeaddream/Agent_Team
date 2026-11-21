import os from 'os';
import path from 'path';

/**
 * Unified userData directory shared by both the Electron GUI (`Agent_Team.exe`)
 * and the standalone CLI (`agent-team` / `agent-team-cli.exe`), so roles, routes,
 * custom executable paths, and run history stay 100% in sync.
 */
export function resolveSharedUserDataDir(): string {
  if (process.env.AGENT_TEAM_HOME && process.env.AGENT_TEAM_HOME.trim()) {
    return path.resolve(process.env.AGENT_TEAM_HOME.trim());
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'agent-team');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'agent-team');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'agent-team');
}
