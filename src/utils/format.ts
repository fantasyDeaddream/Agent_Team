import type { HarnessId, RunStatus, SubtaskStatus } from '@shared/domain';

export const HARNESS_META: Record<
  HarnessId,
  { label: string; short: string; color: string; bg: string }
> = {
  antigravity: {
    label: 'Antigravity',
    short: 'AGY',
    color: 'text-sky-300',
    bg: 'bg-sky-500/15 border-sky-500/30',
  },
  claude: {
    label: 'Claude Code',
    short: 'CLAUDE',
    color: 'text-amber-300',
    bg: 'bg-amber-500/15 border-amber-500/30',
  },
  codex: {
    label: 'Codex CLI',
    short: 'CODEX',
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/15 border-emerald-500/30',
  },
  deepseek: {
    label: 'DeepSeek Harness',
    short: 'DSH',
    color: 'text-indigo-300',
    bg: 'bg-indigo-500/15 border-indigo-500/30',
  },
  opencode: {
    label: 'OpenCode',
    short: 'OPENCODE',
    color: 'text-teal-300',
    bg: 'bg-teal-500/15 border-teal-500/30',
  },
  zcode: {
    label: 'ZCode',
    short: 'ZCODE',
    color: 'text-fuchsia-300',
    bg: 'bg-fuchsia-500/15 border-fuchsia-500/30',
  },
};

export function formatTime(iso?: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

export function formatModelDisplay(modelId?: string): string {
  if (!modelId) return '未指定';
  if (modelId.startsWith('[')) {
    try {
      const pair = JSON.parse(modelId) as string[];
      if (Array.isArray(pair) && pair.length === 2) {
        return `${pair[0]} / ${pair[1]}`;
      }
    } catch {
      // ignore
    }
  }
  return modelId;
}

export const RUN_STATUS_INFO: Record<RunStatus, { label: string; cls: string }> = {
  idle: { label: '空闲', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  planning: { label: 'Leader 拆解中', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  classifying: {
    label: 'Reviewer 判类中',
    cls: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  },
  awaiting_manual_routing: {
    label: '等待手动路由',
    cls: 'bg-amber-500/20 text-amber-200 border-amber-400/50 animate-pulse',
  },
  executing: { label: '多工位并行执行', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' },
  reviewing: { label: 'Leader 审阅汇总', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  completed: {
    label: '已完成交付',
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  },
  failed: { label: '执行异常', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  cancelled: { label: '已中止', cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
};

export const SUBTASK_STATUS_INFO: Record<SubtaskStatus, { label: string; cls: string }> = {
  planned: { label: '待判类', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  classifying: {
    label: 'Reviewer 审阅中',
    cls: 'bg-violet-500/15 text-violet-300 border-violet-500/40 animate-pulse',
  },
  awaiting_route: {
    label: '待手动指派角色',
    cls: 'bg-amber-500/20 text-amber-200 border-amber-400/50 animate-pulse',
  },
  queued: { label: '等待路由执行', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  running: {
    label: '原生工位运行中',
    cls: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/50 animate-pulse',
  },
  completed: {
    label: '已完成',
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  failed: { label: '失败', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  skipped: { label: '已跳过', cls: 'bg-slate-600/20 text-slate-400 border-slate-600/30' },
};
