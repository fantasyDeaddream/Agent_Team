import React from 'react';
import { Eye, FolderOpen, History, Trash2 } from 'lucide-react';
import type { OrchestrationRun } from '@shared/domain';
import { formatDateTime, RUN_STATUS_INFO } from '../utils/format';

interface HistoryViewProps {
  runs: OrchestrationRun[];
  onInspectRun: (run: OrchestrationRun) => void;
  onDeleteRun: (runId: string) => Promise<void>;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  runs,
  onInspectRun,
  onDeleteRun,
}) => {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/80 bg-surface-900/90 shrink-0">
        <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-400" />
          协作运行历史与通信审计 ({runs.length})
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          每一次多 Agent 编排的拆解方案、Reviewer 判类记录、工位通信流与最终汇总报告均自动持久化保存。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {runs.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-500">
            暂无历史运行记录，请前往「协作工作台」发起一次多 Agent 协作任务。
          </div>
        ) : (
          runs.map((run) => {
            const st = RUN_STATUS_INFO[run.status];
            return (
              <div
                key={run.id}
                className="glass-card rounded-xl p-4 flex items-start justify-between gap-4 hover:border-slate-700 transition"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${st.cls}`}>
                      {st.label}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-700 bg-surface-950 text-slate-300">
                      {run.routingMode === 'manual' ? '手动路由' : 'Reviewer 路由'}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">{run.id}</span>
                    <span className="text-[11px] text-slate-500">
                      {formatDateTime(run.createdAt)}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-slate-100 line-clamp-2">{run.goal}</div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-3 flex-wrap">
                    <span>子任务：{run.subtasks.length}</span>
                    <span>通信消息：{run.messages.length}</span>
                    <span>
                      迭代轮次：{run.currentRound}/{run.maxRounds}
                    </span>
                    <span className="font-mono text-slate-500 truncate max-w-md">
                      {run.workspaceDir}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onInspectRun(run)}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-cyan-300 text-xs flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    查看详情
                  </button>
                  <button
                    onClick={() => window.agentTeam.openPath(run.artifactDir)}
                    title="打开共享产物目录"
                    className="p-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-slate-300"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteRun(run.id)}
                    title="删除历史记录"
                    className="p-1.5 rounded-lg bg-surface-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
