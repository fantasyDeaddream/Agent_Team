import React from 'react';
import {
  Cpu,
  History,
  Layers,
  Network,
  Radio,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { AppSettings, DetectedHarness } from '@shared/domain';
import { formatModelDisplay, HARNESS_META } from '../utils/format';

export type NavTab = 'workspace' | 'roles' | 'harnesses' | 'history';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  harnesses: DetectedHarness[];
  settings: AppSettings | null;
  detecting: boolean;
  onRescan: () => void;
  isRunning: boolean;
  awaitingManualRouting?: boolean;
  runCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  harnesses,
  settings,
  detecting,
  onRescan,
  isRunning,
  awaitingManualRouting,
  runCount,
}) => {
  const readyCount = harnesses.filter((h) => h.status === 'ready').length;
  const activeHarnessesTotal = harnesses.length || 6;

  const leaderRoute = settings?.routes['leader'];
  const reviewerRoute = settings?.routes['reviewer'];

  const navItems: Array<{
    id: NavTab;
    label: string;
    desc: string;
    icon: React.ReactNode;
    badge?: string;
  }> = [
    {
      id: 'workspace',
      label: '协作工作台',
      desc: '任务拆解、路由与实时总线',
      icon: <Network className="w-4 h-4" />,
      badge: awaitingManualRouting ? '待路由' : isRunning ? '运行中' : undefined,
    },
    {
      id: 'roles',
      label: '任务类型与路由',
      desc: '角色自定义 & 模型绑定',
      icon: <Layers className="w-4 h-4" />,
      badge: settings ? String(settings.roles.length) : undefined,
    },
    {
      id: 'harnesses',
      label: '本机 Agent 探测',
      desc: '原生工位 & 连通性检测',
      icon: <Cpu className="w-4 h-4" />,
      badge: `${readyCount}/${activeHarnessesTotal}`,
    },
    {
      id: 'history',
      label: '运行历史',
      desc: '通信审计与产物回溯',
      icon: <History className="w-4 h-4" />,
      badge: runCount > 0 ? String(runCount) : undefined,
    },
  ];

  return (
    <aside className="w-64 shrink-0 h-full bg-surface-900 border-r border-slate-800/80 flex flex-col select-none">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 via-sky-500 to-violet-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide text-slate-100">Agent_Team</h1>
            <p className="text-[11px] text-slate-400">原生工位跨 AI 协作台</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-2.5 space-y-1 flex-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-start gap-2.5 border ${
                active
                  ? 'bg-cyan-500/12 border-cyan-500/35 text-cyan-200 shadow-sm'
                  : 'border-transparent text-slate-300 hover:bg-surface-800/70 hover:text-slate-100'
              }`}
            >
              <span className={`mt-0.5 ${active ? 'text-cyan-400' : 'text-slate-400'}`}>
                {item.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                        item.badge === '待路由'
                          ? 'bg-amber-500/25 text-amber-200 animate-pulse'
                          : item.badge === '运行中'
                            ? 'bg-cyan-500/25 text-cyan-200 animate-pulse'
                            : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{item.desc}</p>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Active Core Routing Preview */}
      <div className="p-3 border-t border-slate-800/80 space-y-2.5 bg-surface-950/60">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            零反代原生直连
          </span>
          <button
            onClick={onRescan}
            disabled={detecting}
            title="重新探测本机 Agent 与模型"
            className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${detecting ? 'animate-spin' : ''}`} />
            重扫
          </button>
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="p-2 rounded-lg bg-surface-850 border border-slate-800/80">
            <div className="flex items-center justify-between text-slate-400">
              <span>Leader 总控</span>
              <span
                className={
                  leaderRoute ? HARNESS_META[leaderRoute.harnessId]?.color : 'text-slate-500'
                }
              >
                {leaderRoute ? HARNESS_META[leaderRoute.harnessId]?.short : '-'}
              </span>
            </div>
            <div className="text-slate-200 font-mono truncate mt-0.5">
              {leaderRoute ? formatModelDisplay(leaderRoute.modelId) : '未配置'}
            </div>
          </div>

          <div className="p-2 rounded-lg bg-surface-850 border border-slate-800/80">
            <div className="flex items-center justify-between text-slate-400">
              <span>Reviewer 判类</span>
              <span
                className={
                  reviewerRoute
                    ? HARNESS_META[reviewerRoute.harnessId]?.color
                    : 'text-slate-500'
                }
              >
                {reviewerRoute ? HARNESS_META[reviewerRoute.harnessId]?.short : '-'}
              </span>
            </div>
            <div className="text-slate-200 font-mono truncate mt-0.5">
              {reviewerRoute ? formatModelDisplay(reviewerRoute.modelId) : '未配置'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
