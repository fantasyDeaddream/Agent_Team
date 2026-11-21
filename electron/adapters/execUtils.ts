import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Finds an executable on PATH using Windows `where` or POSIX `which`.
 */
export async function findInPath(command: string): Promise<string | undefined> {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const res = await runQuickCommand(finder, [command], 4000);
  if (res.exitCode !== 0) return undefined;
  const lines = res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  // Prefer .exe over .cmd/.ps1 when multiple matches exist on Windows
  const exe = lines.find((l) => l.toLowerCase().endsWith('.exe'));
  if (exe && fs.existsSync(exe)) return exe;
  const cmd = lines.find((l) => l.toLowerCase().endsWith('.cmd'));
  if (cmd && fs.existsSync(cmd)) return cmd;
  return fs.existsSync(lines[0]) ? lines[0] : undefined;
}

export function runQuickCommand(
  command: string,
  args: string[],
  timeoutMs = 10000,
  env?: Record<string, string | undefined>,
  cwd?: string
): Promise<CommandOutput> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(command, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {
        // ignore
      }
      resolve({ stdout, stderr: stderr + '\n[timeout]', exitCode: -1 });
    }, timeoutMs);

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d: string) => (stdout += d));
    proc.stderr.on('data', (d: string) => (stderr += d));

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: -1 });
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Resolves a Node executable path (important inside Electron where process.execPath is Electron.exe).
 */
export async function resolveSystemNode(): Promise<string> {
  const fromPath = await findInPath('node');
  if (fromPath) return fromPath;
  const standardWin = 'C:\\Program Files\\nodejs\\node.exe';
  if (fs.existsSync(standardWin)) return standardWin;
  return 'node';
}

export function firstExistingPath(candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return path.normalize(c);
  }
  return undefined;
}

export interface IdleWatchdog {
  /** Resets the idle countdown whenever stream output or progress arrives */
  touch: () => void;
  /** Permanently disarms the watchdog once task finishes or aborts */
  stop: () => void;
}

/**
 * Triggers `onTimeout` ONLY when the stream stays completely silent (no touch() calls)
 * for `idleTimeoutMs` consecutive milliseconds without finishing.
 */
export function createIdleWatchdog(
  idleTimeoutMs: number,
  onTimeout: () => void
): IdleWatchdog {
  const delay = Math.max(1000, idleTimeoutMs || 300000);
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (stopped) return;
      stopped = true;
      timer = null;
      onTimeout();
    }, delay);
  };

  schedule();

  return {
    touch: () => {
      if (!stopped) schedule();
    },
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

