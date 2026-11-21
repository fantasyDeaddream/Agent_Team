import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  FileCode2,
  FolderOpen,
  GitBranch,
  Hand,
  Loader2,
  MessageSquareText,
  Play,
  Send,
  Sparkles,
  Square,
  Terminal,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  AppSettings,
  CommMessage,
  DetectedHarness,
  ManualRouteAssignment,
  OrchestrationRun,
  PermissionMode,
  RoutingMode,
  SubtaskItem,
  TaskRole,
} from '@shared/domain';
import {
  formatDuration,
  formatModelDisplay,
  formatTime,
  HARNESS_META,
  RUN_STATUS_INFO,
  SUBTASK_STATUS_INFO,
} from '../utils/format';

interface WorkspaceViewProps {
  settings: AppSettings | null;
  harnesses: DetectedHarness[];
  activeRun: OrchestrationRun | null;
  isRunning: boolean;
  onStartRun: (req: {
    goal: string;
    workspaceDir: string;
    maxRounds: number;
    maxConcurrency: number;
    permissionMode: PermissionMode;
    routingMode: RoutingMode;
  }) => Promise<void>;
  onSubmitManualRoutes: (
    runId: string,
    assignments: ManualRouteAssignment[]
  ) => Promise<void>;
  onCancelRun: () => Promise<void>;
  onStartOnboarding: () => void;
  onOpenRolesTab: () => void;
  onUpdateWorkspaceDefault: (dir: string) => void;
  onUpdateRoutingModeDefault: (mode: RoutingMode) => void;
}

function guessInitialRoleId(task: SubtaskItem, workerRoles: TaskRole[]): string {
  const hay = `${task.title} ${task.description}`.toLowerCase();
  const has = (id: string) => workerRoles.some((r) => r.id === id);

  if (/(审美|美观|视觉评审|配色|排版审查|artist|aesthetic)/i.test(hay) && has('artist')) {
    return 'artist';
  }
  if (/(3d|three\.js|webgl|blender|openscad|建模|模型渲染)/i.test(hay) && has('3d-developer')) {
    return '3d-developer';
  }
  if (/(画图|配图|插画|海报|图标|生图|svg|canvas|绘制)/i.test(hay) && has('drawer')) {
    return 'drawer';
  }
  if (/(前端|ui|界面|页面|html|css|react|vue|tailwind|组件|样式)/i.test(hay) && has('front-developer')) {
    return 'front-developer';
  }
  if (/(后端|api|接口|数据库|schema|服务端|express|fastapi|server|鉴权)/i.test(hay) && has('end-developer')) {
    return 'end-developer';
  }
  if (/(文案|标语|文档|readme|手册|宣传|润色|文本|copy)/i.test(hay) && has('copywriter')) {
    return 'copywriter';
  }
  if (has('coder')) return 'coder';
  return workerRoles[0]?.id || 'coder';
}

const QUICK_TEMPLATES = [
  {
    label: '全栈工具 + 审美验收',
    goal: '在当前工作区设计并实现一个美观的深色风格本地番茄钟 Web 应用（前端独立页面 + 后端 Node API 持久化历史记录），并撰写简要使用说明，完成后对前端页面进行一次视觉审美评审。',
  },
  {
    label: '算法脚本 + 产品文案',
    goal: '编写一个 Python 批量文件整理工具脚本（支持按扩展名与修改日期分类并带 dry-run 预览），同时撰写一份面向普通用户的清晰中文使用手册与宣传介绍文案。',
  },
  {
    label: '跨工位快速协作测试',
    goal: '请把任务拆成两个简单子任务：1）写一段不超过 15 行的 Python 斐波那契生成器代码；2）写一段 80 字以内的优雅中文产品标语。完成后汇总呈现。',
  },
];

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  settings,
  harnesses,
  activeRun,
  isRunning,
  onStartRun,
  onSubmitManualRoutes,
  onCancelRun,
  onStartOnboarding,
  onOpenRolesTab,
  onUpdateWorkspaceDefault,
  onUpdateRoutingModeDefault,
}) => {
  const [goal, setGoal] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState(settings?.defaultWorkspaceDir || '');
  const [maxRounds, setMaxRounds] = useState(settings?.defaultMaxRounds || 3);
  const [maxConcurrency, setMaxConcurrency] = useState(settings?.defaultMaxConcurrency || 4);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    settings?.defaultPermissionMode || 'workspace-write'
  );
  const [routingMode, setRoutingMode] = useState<RoutingMode>(
    settings?.defaultRoutingMode || 'reviewer'
  );
  const [manualRolePicks, setManualRolePicks] = useState<Record<string, string>>({});
  const [submittingRoutes, setSubmittingRoutes] = useState(false);
  const [manualRouteError, setManualRouteError] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const commEndRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!workspaceDir && settings?.defaultWorkspaceDir) {
      setWorkspaceDir(settings.defaultWorkspaceDir);
    }
  }, [settings?.defaultWorkspaceDir, workspaceDir]);

  React.useEffect(() => {
    if (settings?.defaultRoutingMode) {
      setRoutingMode(settings.defaultRoutingMode);
    }
  }, [settings?.defaultRoutingMode]);

  const workerRoles = useMemo(
    () => (settings?.roles || []).filter((r) => r.kind === 'worker'),
    [settings?.roles]
  );

  const awaitingSubtasks = useMemo(
    () => (activeRun?.subtasks || []).filter((t) => t.status === 'awaiting_route'),
    [activeRun?.subtasks]
  );

  React.useEffect(() => {
    if (activeRun?.status !== 'awaiting_manual_routing' || awaitingSubtasks.length === 0) return;
    setManualRolePicks((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const task of awaitingSubtasks) {
        if (!next[task.id] || !workerRoles.some((r) => r.id === next[task.id])) {
          next[task.id] = guessInitialRoleId(task, workerRoles);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setManualRouteError(null);
  }, [activeRun?.id, activeRun?.status, awaitingSubtasks, workerRoles]);

  const readyHarnessesCount = harnesses.filter((h) => h.status === 'ready').length;

  const roleColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of settings?.roles || []) {
      map.set(r.id, r.color);
    }
    return map;
  }, [settings?.roles]);

  const handlePickFolder = async () => {
    const picked = await window.agentTeam.pickFolder();
    if (picked) {
      setWorkspaceDir(picked);
      onUpdateWorkspaceDefault(picked);
    }
  };

  const handleLaunch = async () => {
    if (!goal.trim()) return;
    setLaunchError(null);
    try {
      await onStartRun({
        goal: goal.trim(),
        workspaceDir: workspaceDir.trim() || settings?.defaultWorkspaceDir || '',
        maxRounds,
        maxConcurrency,
        permissionMode,
        routingMode,
      });
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConfirmManualRoutes = async () => {
    if (!activeRun || awaitingSubtasks.length === 0) return;
    setSubmittingRoutes(true);
    setManualRouteError(null);
    try {
      const assignments: ManualRouteAssignment[] = awaitingSubtasks.map((task) => ({
        subtaskId: task.id,
        roleId: manualRolePicks[task.id] || workerRoles[0]?.id || 'coder',
      }));
      await onSubmitManualRoutes(activeRun.id, assignments);
    } catch (err) {
      setManualRouteError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingRoutes(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedTaskIds((prev) => ({ ...prev, [id]: !prev[id] }));
    setSelectedTaskId(id);
  };

  const selectedTask: SubtaskItem | undefined = useMemo(() => {
    if (!activeRun) return undefined;
    if (selectedTaskId) {
      const found = activeRun.subtasks.find((t) => t.id === selectedTaskId);
      if (found) return found;
    }
    return (
      activeRun.subtasks.find((t) => t.status === 'running') ||
      activeRun.subtasks[activeRun.subtasks.length - 1]
    );
  }, [activeRun, selectedTaskId]);

  const activeRoutingMode = activeRun?.routingMode ?? routingMode;
  const stages = [
    { key: 'planning', label: '1. Leader 拆解' },
    {
      key: activeRoutingMode === 'manual' ? 'awaiting_manual_routing' : 'classifying',
      label: activeRoutingMode === 'manual' ? '2. 用户手动路由' : '2. Reviewer 判类',
    },
    { key: 'executing', label: '3. Router 路由执行' },
    { key: 'reviewing', label: '4. Leader 审阅迭代' },
    { key: 'completed', label: '5. 最终交付' },
  ];

  const currentStageIndex = activeRun
    ? stages.findIndex((s) => s.key === activeRun.status)
    : -1;

  const handleCopyReport = async () => {
    if (!activeRun?.finalReport) return;
    await navigator.clipboard.writeText(activeRun.finalReport);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 1800);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Mission Composer */}
      <div className="p-4 border-b border-slate-800/80 bg-surface-900/90 space-y-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-slate-100">多 Agent 协同任务发射台</h2>
            {activeRun && (
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                  RUN_STATUS_INFO[activeRun.status].cls
                }`}
              >
                {RUN_STATUS_INFO[activeRun.status].label} · 第 {activeRun.currentRound}/
                {activeRun.maxRounds} 轮
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={onStartOnboarding}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 flex items-center gap-1 font-medium transition"
            >
              <Compass className="w-3.5 h-3.5" />
              启动新手引导
            </button>
            {QUICK_TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                disabled={isRunning}
                onClick={() => setGoal(tpl.goal)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-slate-300 border border-slate-700/70 transition disabled:opacity-40"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        {settings &&
          (!settings.routes['leader']?.harnessId ||
            (routingMode === 'reviewer' && !settings.routes['reviewer']?.harnessId)) && (
            <div className="flex items-center justify-between gap-3 text-xs px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/35 text-amber-200">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                {!settings.routes['leader']?.harnessId
                  ? '尚未配置 Leader 模型（首次启动默认留空），请先完成新手引导或手动指定角色模型。'
                  : '当前处于 Reviewer 自动路由模式，但尚未配置 Reviewer 模型（或可切换为「用户手动路由」）。'}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={onStartOnboarding}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-100 text-[11px] font-medium"
                >
                  新手引导
                </button>
                <button
                  type="button"
                  onClick={onOpenRolesTab}
                  className="px-2.5 py-1 rounded-lg bg-surface-850 hover:bg-surface-800 border border-slate-700 text-slate-200 text-[11px]"
                >
                  去配置路由
                </button>
              </div>
            </div>
          )}

        <div className="flex gap-3">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={isRunning}
            rows={2}
            placeholder="输入你想交给 Agent 团队完成的目标（Leader 会自动拆解任务 → Reviewer 事前定性分类 → 路由到各家原生工位执行 → Leader 审阅汇总与迭代）..."
            className="flex-1 bg-surface-950 border border-slate-700/80 focus:border-cyan-500/70 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-none"
          />
          <div className="flex flex-col justify-between gap-2 shrink-0">
            {!isRunning ? (
              <button
                onClick={handleLaunch}
                disabled={!goal.trim() || readyHarnessesCount === 0}
                className="h-full min-w-[128px] px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 disabled:from-slate-700 disabled:to-slate-700 text-slate-950 disabled:text-slate-400 font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/15 transition"
              >
                <Play className="w-4 h-4 fill-current" />
                启动协作
              </button>
            ) : (
              <button
                onClick={onCancelRun}
                className="h-full min-w-[128px] px-4 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/50 font-semibold text-sm flex items-center justify-center gap-2 transition"
              >
                <Square className="w-4 h-4 fill-current" />
                中止任务
              </button>
            )}
          </div>
        </div>

        {/* Workspace & Execution Options */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 flex-1 min-w-[260px] bg-surface-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
            <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              value={workspaceDir}
              onChange={(e) => setWorkspaceDir(e.target.value)}
              disabled={isRunning}
              placeholder="选择项目工作区目录..."
              className="flex-1 bg-transparent text-slate-200 font-mono text-[11px] focus:outline-none"
            />
            <button
              onClick={handlePickFolder}
              disabled={isRunning}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 shrink-0 px-1.5"
            >
              浏览
            </button>
          </div>

          <div className="flex items-center gap-1 bg-surface-950 border border-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => {
                setRoutingMode('reviewer');
                onUpdateRoutingModeDefault('reviewer');
              }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition disabled:opacity-60 ${
                routingMode === 'reviewer'
                  ? 'bg-violet-500/25 text-violet-200 border border-violet-500/40'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              Reviewer 自动路由
            </button>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => {
                setRoutingMode('manual');
                onUpdateRoutingModeDefault('manual');
              }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition flex items-center gap-1 disabled:opacity-60 ${
                routingMode === 'manual'
                  ? 'bg-amber-500/25 text-amber-200 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Hand className="w-3 h-3" />
              用户手动路由
            </button>
          </div>

          <label className="flex items-center gap-1.5 text-slate-400">
            <span>最大迭代轮次</span>
            <select
              value={maxRounds}
              disabled={isRunning}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
              className="bg-surface-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 text-xs"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} 轮
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-400">
            <span>并发上限</span>
            <select
              value={maxConcurrency}
              disabled={isRunning}
              onChange={(e) => setMaxConcurrency(Number(e.target.value))}
              className="bg-surface-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 text-xs"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} 并行
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-400">
            <span>执行权限</span>
            <select
              value={permissionMode}
              disabled={isRunning}
              onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              className="bg-surface-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 text-xs"
            >
              <option value="workspace-write">工作区写入 (推荐)</option>
              <option value="safe">安全只读 / 规划</option>
              <option value="full-auto">全自动免审批</option>
            </select>
          </label>
        </div>

        {launchError && (
          <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            启动失败：{launchError}
          </div>
        )}
      </div>

      {/* Stage Stepper */}
      {activeRun && (
        <div className="px-4 py-2 bg-surface-950/90 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto shrink-0">
          {stages.map((st, idx) => {
            const isCurrent = activeRun.status === st.key;
            const isDone =
              activeRun.status === 'completed' ||
              (currentStageIndex >= 0 && idx < currentStageIndex);
            return (
              <React.Fragment key={st.key}>
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap border ${
                    isCurrent
                      ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200'
                      : isDone
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-surface-900 border-slate-800 text-slate-500'
                  }`}
                >
                  {isCurrent && activeRun.status !== 'completed' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : isDone ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  )}
                  {st.label}
                </div>
                {idx < stages.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-slate-700 shrink-0" />
                )}
              </React.Fragment>
            );
          })}

          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              onClick={() => window.agentTeam.openPath(activeRun.artifactDir)}
              className="text-[11px] text-slate-400 hover:text-cyan-300 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-800"
            >
              <FolderOpen className="w-3 h-3" />
              共享产物目录
            </button>
          </div>
        </div>
      )}

      {/* Main Split Content */}
      {!activeRun ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30 flex items-center justify-center">
              <GitBranch className="w-7 h-7 text-cyan-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-100">
              让每个 AI 留在自己的最强原生工位协作
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              在上方输入任务目标后，系统将自动由 <span className="text-sky-300">Leader</span>{' '}
              拆解子块，交由 <span className="text-violet-300">Reviewer</span>{' '}
              逐一定性分类，再由路由引擎无反代分发至对应的本机原生工位（Antigravity / Claude Code
              / Codex / DeepSeek Harness），执行结果回收至 Leader 审阅迭代并最终交付。
            </p>
            <div className="grid grid-cols-3 gap-2.5 pt-2 text-left text-xs">
              <div className="glass-card rounded-xl p-3">
                <div className="text-sky-300 font-semibold">1. Leader 拆解与审阅</div>
                <p className="text-slate-400 mt-1">
                  拆分子任务依赖、审阅结果，并在需要视觉验收时自动拆分审美子任务给 Artist。
                </p>
              </div>
              <div className="glass-card rounded-xl p-3">
                <div className="text-violet-300 font-semibold">2. Reviewer 事前定性</div>
                <p className="text-slate-400 mt-1">
                  专注判断每个子块归属的角色类型，输出分类依据与置信度。
                </p>
              </div>
              <div className="glass-card rounded-xl p-3">
                <div className="text-emerald-300 font-semibold">3. 原生工位执行</div>
                <p className="text-slate-400 mt-1">
                  走 ACP / Headless 官方通道，完整保留各家工具链、登录态与沙箱能力。
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-slate-800/80 overflow-hidden">
          {/* Left 7 cols: Subtask Cards + Leader Reviews + Final Report */}
          <div className="col-span-7 overflow-y-auto p-4 space-y-4">
            {/* Plan Summary */}
            {activeRun.planSummary && (
              <div className="glass-card rounded-xl p-3.5 space-y-2">
                <div className="text-xs font-semibold text-sky-300">Leader 拆解方案</div>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {activeRun.planSummary}
                </p>
                {activeRun.parallelPlanSummary && (
                  <div className="text-[11px] text-cyan-200/90 bg-cyan-500/10 border border-cyan-500/25 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <span>并发调度判定：{activeRun.parallelPlanSummary}</span>
                  </div>
                )}
              </div>
            )}

            {/* Interactive Manual Routing Panel */}
            {activeRun.status === 'awaiting_manual_routing' && awaitingSubtasks.length > 0 && (
              <div className="rounded-2xl border border-amber-500/45 bg-gradient-to-b from-amber-500/10 to-surface-900/95 p-4 space-y-3.5 shadow-lg shadow-amber-500/5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                      <Hand className="w-4 h-4 text-amber-400" />
                      第 {activeRun.currentRound} 轮 · 等待你为拆出的子任务指定执行角色
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Leader 已完成任务拆分。请为下方每个子任务选择目标角色（右侧实时显示该角色绑定的原生工位与模型），确认后立即按依赖派发执行。
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {awaitingSubtasks.map((task) => {
                    const chosenRoleId =
                      manualRolePicks[task.id] || workerRoles[0]?.id || 'coder';
                    const chosenRole = workerRoles.find((r) => r.id === chosenRoleId);
                    const targetRoute = settings?.routes[chosenRoleId];
                    const hMeta = targetRoute
                      ? HARNESS_META[targetRoute.harnessId]
                      : undefined;

                    return (
                      <div
                        key={task.id}
                        className="rounded-xl bg-surface-950/90 border border-slate-800 p-3 space-y-2"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                            {task.id}
                          </span>
                          <span className="text-xs font-semibold text-slate-100">
                            {task.title}
                          </span>
                          <span
                            title={task.parallelReason || ''}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              task.canRunInParallel === false
                                ? 'bg-slate-800 border-slate-700 text-slate-400'
                                : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                            }`}
                          >
                            {task.canRunInParallel === false ? '串行独占' : '可同时并行'}
                          </span>
                          {task.dependsOn.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400">
                              依赖: {task.dependsOn.join(', ')}
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed">
                          {task.description}
                        </p>

                        <div className="flex items-center flex-wrap gap-2.5 pt-1">
                          <label className="text-[11px] text-slate-400 shrink-0">
                            路由至角色：
                          </label>
                          <select
                            value={chosenRoleId}
                            onChange={(e) =>
                              setManualRolePicks((prev) => ({
                                ...prev,
                                [task.id]: e.target.value,
                              }))
                            }
                            className="bg-surface-900 border border-amber-500/40 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-medium focus:outline-none min-w-[200px]"
                          >
                            {workerRoles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}（{r.zhLabel}）
                              </option>
                            ))}
                          </select>

                          {chosenRole && hMeta && targetRoute && (
                            <span
                              className={`text-[11px] px-2.5 py-1 rounded-lg border ${hMeta.bg} ${hMeta.color}`}
                            >
                              → {hMeta.label} · {formatModelDisplay(targetRoute.modelId)} (
                              {targetRoute.transportMode.toUpperCase()})
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {manualRouteError && (
                  <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                    提交路由失败：{manualRouteError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={onCancelRun}
                    disabled={submittingRoutes}
                    className="px-3.5 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-slate-300 text-xs border border-slate-700"
                  >
                    中止任务
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmManualRoutes}
                    disabled={submittingRoutes}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-cyan-400 hover:from-amber-300 hover:to-cyan-300 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/15 disabled:opacity-50"
                  >
                    {submittingRoutes ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    确认路由并派发执行 ({awaitingSubtasks.length} 项)
                  </button>
                </div>
              </div>
            )}

            {/* Subtasks List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  子任务路由与执行看板 ({activeRun.subtasks.length})
                </h3>
              </div>

              {activeRun.subtasks.map((task) => {
                const expanded = !!expandedTaskIds[task.id];
                const isSelected = selectedTask?.id === task.id;
                const roleColor = task.assignedRoleId
                  ? roleColorMap.get(task.assignedRoleId) || '#38bdf8'
                  : '#64748b';
                const statusInfo = SUBTASK_STATUS_INFO[task.status];
                const hMeta = task.harnessId ? HARNESS_META[task.harnessId] : undefined;

                return (
                  <div
                    key={task.id}
                    className={`rounded-xl border transition ${
                      isSelected
                        ? 'bg-surface-850 border-cyan-500/45 shadow-md shadow-cyan-500/5'
                        : 'glass-card hover:border-slate-700'
                    }`}
                  >
                    <div
                      onClick={() => toggleExpand(task.id)}
                      className="p-3 cursor-pointer flex items-start gap-2.5"
                    >
                      <span className="mt-0.5 text-slate-500">
                        {expanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </span>

                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                            {task.id}
                          </span>
                          <span className="text-[10px] text-slate-500">R{task.round}</span>
                          <span
                            title={task.parallelReason || ''}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              task.canRunInParallel === false
                                ? 'bg-slate-800 border-slate-700 text-slate-400'
                                : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                            }`}
                          >
                            {task.canRunInParallel === false
                              ? '串行独占'
                              : `可并行${task.parallelGroup ? ` · ${task.parallelGroup}` : ''}`}
                          </span>
                          <span className="text-xs font-semibold text-slate-100 truncate">
                            {task.title}
                          </span>
                          <span
                            className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${statusInfo.cls}`}
                          >
                            {statusInfo.label}
                          </span>
                        </div>

                        {/* Routing & Classification Pills */}
                        <div className="flex items-center flex-wrap gap-1.5 text-[11px]">
                          {task.assignedRoleName ? (
                            <span
                              className="px-2 py-0.5 rounded-md font-medium border"
                              style={{
                                color: roleColor,
                                borderColor: `${roleColor}55`,
                                backgroundColor: `${roleColor}18`,
                              }}
                            >
                              {task.assignedRoleName}
                              {activeRun.routingMode === 'manual'
                                ? ' · 手动指定'
                                : typeof task.reviewerConfidence === 'number'
                                  ? ` · ${Math.round(task.reviewerConfidence * 100)}%`
                                  : ''}
                            </span>
                          ) : (
                            <span className="text-slate-500">
                              {activeRun.routingMode === 'manual'
                                ? '待用户手动指定角色'
                                : '待 Reviewer 分类'}
                            </span>
                          )}

                          {hMeta && (
                            <span className={`px-2 py-0.5 rounded-md border ${hMeta.bg} ${hMeta.color}`}>
                              {hMeta.label} · {formatModelDisplay(task.modelId)}
                              {task.transportMode ? ` (${task.transportMode.toUpperCase()})` : ''}
                            </span>
                          )}

                          {task.durationMs ? (
                            <span className="text-slate-500 font-mono ml-auto">
                              {formatDuration(task.durationMs)}
                            </span>
                          ) : null}
                        </div>

                        {task.reviewerReason && (
                          <p className="text-[11px] text-slate-400 line-clamp-1">
                            <span
                              className={
                                activeRun.routingMode === 'manual'
                                  ? 'text-amber-400'
                                  : 'text-violet-400'
                              }
                            >
                              {activeRun.routingMode === 'manual' ? '手动路由：' : 'Reviewer：'}
                            </span>
                            {task.reviewerReason}
                          </p>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="px-4 pb-3.5 pt-2 border-t border-slate-800/80 space-y-2.5 text-xs">
                        <div>
                          <div className="text-[11px] text-slate-500 mb-1">任务详细要求</div>
                          <p className="text-slate-300 whitespace-pre-wrap bg-surface-950/70 p-2.5 rounded-lg border border-slate-800/80">
                            {task.description}
                          </p>
                        </div>

                        {task.error && (
                          <div className="text-rose-300 bg-rose-500/10 border border-rose-500/30 p-2.5 rounded-lg flex items-start gap-2">
                            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span className="whitespace-pre-wrap">{task.error}</span>
                          </div>
                        )}

                        {task.output && (
                          <div>
                            <div className="text-[11px] text-slate-500 mb-1">原生工位执行结果</div>
                            <pre className="text-[11px] text-slate-200 whitespace-pre-wrap font-sans bg-surface-950 p-3 rounded-lg border border-slate-800 max-h-72 overflow-y-auto leading-relaxed">
                              {task.output}
                            </pre>
                          </div>
                        )}

                        {task.artifactsProduced && task.artifactsProduced.length > 0 && (
                          <div>
                            <div className="text-[11px] text-slate-500 mb-1">新增共享产物</div>
                            <div className="flex flex-wrap gap-1.5">
                              {task.artifactsProduced.map((filePath) => (
                                <button
                                  key={filePath}
                                  onClick={() => window.agentTeam.openPath(filePath)}
                                  className="text-[11px] px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 flex items-center gap-1"
                                >
                                  <FileCode2 className="w-3 h-3" />
                                  {filePath.split(/[/\\]/).pop()}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Leader Review Rounds */}
            {activeRun.leaderReviews.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Leader 审阅与迭代决策
                </h3>
                {activeRun.leaderReviews.map((rev) => (
                  <div
                    key={rev.round}
                    className="glass-card rounded-xl p-3 text-xs space-y-1 border-l-2 border-l-amber-400"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-300">
                        第 {rev.round} 轮审阅 ·{' '}
                        {rev.decision === 'finish' ? '验收通过并汇总交付' : '发起下一轮迭代'}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {formatTime(rev.timestamp)}
                      </span>
                    </div>
                    <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {rev.reviewNotes}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Final Deliverable */}
            {activeRun.finalReport && (
              <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/15 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    Leader 最终汇总交付报告
                  </div>
                  <button
                    onClick={handleCopyReport}
                    className="text-xs px-2.5 py-1 rounded-lg bg-surface-850 hover:bg-surface-800 border border-slate-700 text-slate-200 flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedReport ? '已复制' : '复制报告'}
                  </button>
                </div>
                <pre className="text-xs text-slate-100 whitespace-pre-wrap font-sans leading-relaxed bg-surface-950/80 p-3.5 rounded-lg border border-slate-800/80 max-h-[420px] overflow-y-auto">
                  {activeRun.finalReport}
                </pre>
              </div>
            )}

            {activeRun.error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-3.5 text-xs text-rose-200">
                <div className="font-semibold mb-1">任务终止原因</div>
                <p className="whitespace-pre-wrap">{activeRun.error}</p>
              </div>
            )}
          </div>

          {/* Right 5 cols: Live Comms Bus + Active Worker Stream Terminal */}
          <div className="col-span-5 flex flex-col min-h-0 bg-surface-950/50">
            {/* Upper 58%: Inter-Agent Communication Bus */}
            <div className="flex-1 min-h-0 flex flex-col border-b border-slate-800/80">
              <div className="px-3.5 py-2.5 border-b border-slate-800/80 flex items-center justify-between bg-surface-900/70">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <MessageSquareText className="w-3.5 h-3.5 text-cyan-400" />
                  Agent 间实时通信总线 ({activeRun.messages.length})
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {activeRun.messages.map((msg) => (
                  <CommMessageCard key={msg.id} msg={msg} />
                ))}
                <div ref={commEndRef} />
              </div>
            </div>

            {/* Lower 42%: Live Native Harness Stream Output */}
            <div className="h-[42%] min-h-[180px] flex flex-col bg-surface-950">
              <div className="px-3.5 py-2 border-b border-slate-800/80 flex items-center justify-between bg-surface-900/60">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 truncate">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  原生工位实时输出流
                  {selectedTask && (
                    <span className="font-mono text-[11px] text-cyan-300 truncate">
                      · [{selectedTask.id}] {selectedTask.assignedRoleName || selectedTask.title}
                    </span>
                  )}
                </span>
              </div>
              <pre className="flex-1 overflow-y-auto p-3 text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                {selectedTask?.streamLog ||
                  selectedTask?.output ||
                  '等待原生 Agent 子进程输出流...'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const STAGE_STYLES: Record<CommMessage['stage'], string> = {
  plan: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
  classify: 'text-violet-300 border-violet-500/30 bg-violet-500/10',
  route: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  execute: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  review: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  system: 'text-slate-300 border-slate-600/40 bg-slate-700/20',
  error: 'text-rose-300 border-rose-500/35 bg-rose-500/10',
};

const CommMessageCard: React.FC<{ msg: CommMessage }> = ({ msg }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg bg-surface-900/90 border border-slate-800/90 p-2.5 text-[11px] space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${
            STAGE_STYLES[msg.stage]
          }`}
        >
          {msg.stage.toUpperCase()} · R{msg.round}
        </span>
        <span className="text-[10px] text-slate-500 font-mono">{formatTime(msg.timestamp)}</span>
      </div>
      <div className="flex items-center gap-1 text-slate-400 flex-wrap">
        <span className="text-slate-200 font-medium">{msg.from}</span>
        <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
        <span className="text-cyan-300 font-medium">{msg.to}</span>
      </div>
      <div
        onClick={() => setOpen((v) => !v)}
        className="text-slate-100 font-medium cursor-pointer hover:text-cyan-200"
      >
        {msg.title}
      </div>
      <p
        className={`text-slate-400 whitespace-pre-wrap leading-relaxed ${
          open ? '' : 'line-clamp-3'
        }`}
      >
        {msg.content}
      </p>
    </div>
  );
};
