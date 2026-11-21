import React from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Compass, X } from 'lucide-react';
import type { AppSettings, DetectedHarness } from '@shared/domain';

interface OnboardingBannerProps {
  step: 1 | 2;
  harnesses: DetectedHarness[];
  settings: AppSettings | null;
  detecting: boolean;
  onGoStep: (step: 1 | 2) => void;
  onFinish: () => void;
  onSkip: () => void;
}

export const OnboardingBanner: React.FC<OnboardingBannerProps> = ({
  step,
  harnesses,
  settings,
  detecting,
  onGoStep,
  onFinish,
  onSkip,
}) => {
  const readyCount = harnesses.filter((h) => h.status === 'ready').length;
  const totalHarnesses = harnesses.length || 6;

  const totalRoles = settings?.roles.length || 9;
  const configuredRolesCount = settings
    ? settings.roles.filter((r) => Boolean(settings.routes[r.id]?.harnessId && settings.routes[r.id]?.modelId)).length
    : 0;
  const leaderConfigured = Boolean(settings?.routes['leader']?.harnessId && settings?.routes['leader']?.modelId);
  const reviewerConfigured = Boolean(
    settings?.routes['reviewer']?.harnessId && settings?.routes['reviewer']?.modelId
  );

  return (
    <div className="px-5 py-3.5 bg-gradient-to-r from-cyan-950/90 via-surface-900 to-violet-950/85 border-b border-cyan-500/35 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shrink-0 mt-0.5">
            <Compass className="w-4 h-4 text-cyan-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-cyan-200">
                新手引导 · 第 {step} / 2 步：
                {step === 1 ? '检查本机 Agent 探测情况' : '手动配置任务类型与启用模型'}
              </span>

              {step === 1 ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300">
                  {detecting ? '正在探测本机环境...' : `已就绪 ${readyCount} / ${totalHarnesses} 个工位`}
                </span>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/35 text-cyan-200">
                    已配置 {configuredRolesCount} / {totalRoles} 个角色
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full border ${
                      leaderConfigured
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                        : 'bg-amber-500/15 border-amber-500/35 text-amber-300'
                    }`}
                  >
                    Leader {leaderConfigured ? '已配' : '待配置'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full border ${
                      reviewerConfigured
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    Reviewer {reviewerConfigured ? '已配' : '未配（手动路由可不配）'}
                  </span>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {step === 1
                ? '请核对下方自动探测到的各家 Agent（含 Antigravity、Claude Code、Codex、DeepSeek Harness、OpenCode、ZCode）及模型清单；如需修改路径可点击卡片上的「手动指定」，确认无误后进入下一步。'
                : '首次启动默认留空，请你按需为下方各任务类型手动选择原生工位和启用的模型（至少配置 Leader 及常用专业岗位），完成后即可开始协作。'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onSkip}
            className="px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-800 flex items-center gap-1 transition"
          >
            <X className="w-3.5 h-3.5" />
            跳过引导
          </button>

          {step === 1 ? (
            <button
              onClick={() => onGoStep(2)}
              className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-cyan-500/20 transition"
            >
              下一步：配置任务类型与路由
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <button
                onClick={() => onGoStep(1)}
                className="px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 border border-slate-700 text-slate-200 text-xs flex items-center gap-1 transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                上一步
              </button>
              <button
                onClick={onFinish}
                className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                完成引导并进入工作台
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
