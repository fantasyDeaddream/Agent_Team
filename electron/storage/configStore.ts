import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppSettings, OrchestrationRun } from '../types/domain';
import { DEFAULT_ROLES } from './defaults';

export class ConfigStore {
  private readonly baseDir: string;
  private readonly settingsPath: string;
  private readonly runsDir: string;

  constructor(userDataDir: string) {
    this.baseDir = path.join(userDataDir, 'agent-team-data');
    this.settingsPath = path.join(this.baseDir, 'settings.json');
    this.runsDir = path.join(this.baseDir, 'runs');
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
  }

  getDefaultSettings(): AppSettings {
    return {
      roles: DEFAULT_ROLES.map((r) => ({ ...r })),
      routes: {},
      customExecutablePaths: {},
      defaultWorkspaceDir: path.join(os.homedir(), 'Desktop'),
      defaultMaxRounds: 3,
      defaultMaxConcurrency: 4,
      defaultPermissionMode: 'workspace-write',
      defaultRoutingMode: 'reviewer',
      onboardingCompleted: false,
    };
  }

  loadSettings(): AppSettings {
    const defaults = this.getDefaultSettings();
    if (!fs.existsSync(this.settingsPath)) {
      return defaults;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Partial<AppSettings>;
      const roles = Array.isArray(parsed.roles) && parsed.roles.length > 0 ? parsed.roles : defaults.roles;
      // Ensure built-in Leader & Reviewer always exist
      const hasLeader = roles.some((r) => r.kind === 'leader');
      const hasReviewer = roles.some((r) => r.kind === 'reviewer');
      const mergedRoles = [...roles];
      if (!hasLeader) mergedRoles.unshift({ ...DEFAULT_ROLES[0] });
      if (!hasReviewer) mergedRoles.splice(1, 0, { ...DEFAULT_ROLES[1] });
      const routes =
        parsed.routes && typeof parsed.routes === 'object' ? parsed.routes : {};

      return {
        ...defaults,
        ...parsed,
        roles: mergedRoles,
        routes,
        onboardingCompleted:
          typeof parsed.onboardingCompleted === 'boolean'
            ? parsed.onboardingCompleted
            : Object.keys(routes).length > 0,
        customExecutablePaths:
          parsed.customExecutablePaths && typeof parsed.customExecutablePaths === 'object'
            ? parsed.customExecutablePaths
            : {},
      };
    } catch {
      return defaults;
    }
  }

  saveSettings(settings: AppSettings): AppSettings {
    const tmp = this.settingsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, this.settingsPath);
    return settings;
  }

  saveRun(run: OrchestrationRun): void {
    const filePath = path.join(this.runsDir, `${run.id}.json`);
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  loadRun(runId: string): OrchestrationRun | undefined {
    const filePath = path.join(this.runsDir, `${runId}.json`);
    if (!fs.existsSync(filePath)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as OrchestrationRun;
    } catch {
      return undefined;
    }
  }

  listRuns(): OrchestrationRun[] {
    if (!fs.existsSync(this.runsDir)) return [];
    const files = fs.readdirSync(this.runsDir).filter((f) => f.endsWith('.json'));
    const runs: OrchestrationRun[] = [];
    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(this.runsDir, file), 'utf8')
        ) as OrchestrationRun;
        runs.push(data);
      } catch {
        // skip corrupted record
      }
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  deleteRun(runId: string): boolean {
    const filePath = path.join(this.runsDir, `${runId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
}
