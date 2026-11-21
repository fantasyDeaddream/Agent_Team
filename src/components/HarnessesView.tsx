import React, { useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  FolderSearch,
  Loader2,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type {
  AppSettings,
  DetectedHarness,
  HarnessId,
  PingResult,
  TransportMode,
} from '@shared/domain';
import { formatDuration, HARNESS_META } from '../utils/format';

interface HarnessesViewProps {
  harnesses: DetectedHarness[];
  settings: AppSettings | null;
  detecting: boolean;
  onRescan: () => Promise<void>;
  onSaveCustomPath: (harnessId: HarnessId, customPath: string | undefined) => Promise<void>;
}

export const HarnessesView: React.FC<HarnessesViewProps> = ({
  harnesses,
  settings,
  detecting,
  onRescan,
  onSaveCustomPath,
}) => {
  const [pingSelection, setPingSelection] = useState<
    Record<string, { modelId: string; transport: TransportMode }>
  >({});
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [pingResults, setPingResults] = useState<Record<string, PingResult>>({});
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});

  const handlePickExe = async (harnessId: HarnessId) => {
    const picked = await window.agentTeam.pickExecutable();
    if (picked) {
      await onSaveCustomPath(harnessId, picked);
    }
  };

  const handlePing = async (harness: DetectedHarness) => {
    const sel = pingSelection[harness.id] || {
      modelId: harness.models[0]?.id || 'default',
      transport: harness.defaultTransport,
    };
    setPingingId(harness.id);
    try {
      const res = await window.agentTeam.pingHarness({
        harnessId: harness.id,
        modelId: sel.modelId,
        transportMode: sel.transport,
        workspaceDir: settings?.defaultWorkspaceDir,
      });
      setPingResults((prev) => ({ ...prev, [harness.id]: res }));
    } finally {
      setPingingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/80 bg-surface-900/90 flex items-center justify-between gap-3 shrink-0">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            本机原生 Agent 工位探测中心
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            自动识别本机已安装的官方 CLI / ACP 服务与实时可用模型清单；所有调用均直连原生工位，严守零反代原则。
          </p>
        </div>

        <button
          onClick={onRescan}
          disabled={detecting}
          className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 disabled:opacity-60 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${detecting ? 'animate-spin' : ''}`} />
          {detecting ? '正在探测本机环境...' : '重新扫描本机 Agent'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
        {harnesses.map((h) => {
          const meta = HARNESS_META[h.id];
          const sel = pingSelection[h.id] || {
            modelId: h.models[0]?.id || 'default',
            transport: h.defaultTransport,
          };
          const pingRes = pingResults[h.id];
          const isPinging = pingingId === h.id;
          const customPath = settings?.customExecutablePaths?.[h.id];
          const showAllModels = !!expandedModels[h.id];
          const visibleModels = showAllModels ? h.models : h.models.slice(0, 8);

          return (
            <div
              key={h.id}
              className={`rounded-2xl border p-4 space-y-3.5 flex flex-col justify-between ${
                h.reserved
                  ? 'bg-surface-900/40 border-slate-800/70 opacity-75'
                  : 'glass-card border-slate-800'
              }`}
            >
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${meta.color}`}>{h.name}</span>
                      <span className="text-[11px] text-slate-500">{h.vendor}</span>
                      {h.version && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-950 text-slate-400 border border-slate-800">
                          {h.version}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{h.description}</p>
                  </div>

                  <StatusBadge status={h.status} />
                </div>

                {/* Status message */}
                <div className="text-xs px-3 py-2 rounded-lg bg-surface-950/80 border border-slate-800/80 text-slate-300">
                  {h.statusMessage}
                </div>

                {/* Executable Path & Transports */}
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">可执行文件路径</span>
                    {!h.reserved && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePickExe(h.id)}
                          className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                        >
                          <FolderSearch className="w-3 h-3" />
                          手动指定
                        </button>
                        {customPath && (
                          <button
                            onClick={() => onSaveCustomPath(h.id, undefined)}
                            className="text-slate-400 hover:text-slate-200 flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            恢复自动
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-slate-300 bg-surface-950 px-2.5 py-1.5 rounded-lg border border-slate-800/80 truncate">
                    {h.executablePath || '（未检测到）'}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-slate-500">支持通道：</span>
                    {h.supportedTransports.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded bg-surface-850 border border-slate-700/80 text-slate-300 uppercase font-mono text-[10px]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Models */}
                {h.models.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">
                        已自动探测模型 ({h.models.length})
                      </span>
                      {h.models.length > 8 && (
                        <button
                          onClick={() =>
                            setExpandedModels((p) => ({ ...p, [h.id]: !p[h.id] }))
                          }
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          {showAllModels ? '收起' : `展开全部 ${h.models.length} 个`}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {visibleModels.map((m) => (
                        <span
                          key={m.id}
                          title={m.description || m.id}
                          className="text-[11px] px-2 py-0.5 rounded-md bg-surface-950 border border-slate-800 text-slate-300"
                        >
                          {m.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Connectivity Ping Tester */}
              {h.status === 'ready' && (
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={sel.modelId}
                      onChange={(e) =>
                        setPingSelection((p) => ({
                          ...p,
                          [h.id]: { ...sel, modelId: e.target.value },
                        }))
                      }
                      className="flex-1 min-w-0 bg-surface-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 font-mono"
                    >
                      {h.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={sel.transport}
                      onChange={(e) =>
                        setPingSelection((p) => ({
                          ...p,
                          [h.id]: { ...sel, transport: e.target.value as TransportMode },
                        }))
                      }
                      className="bg-surface-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 uppercase"
                    >
                      {h.supportedTransports.map((tr) => (
                        <option key={tr} value={tr}>
                          {tr}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => handlePing(h)}
                      disabled={isPinging}
                      className="px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 border border-cyan-500/40 text-cyan-300 text-xs font-medium flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                    >
                      {isPinging ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Radio className="w-3.5 h-3.5" />
                      )}
                      连通测试
                    </button>
                  </div>

                  {pingRes && (
                    <div
                      className={`text-[11px] px-2.5 py-2 rounded-lg border flex items-start gap-2 ${
                        pingRes.ok
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                      }`}
                    >
                      {pingRes.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium">
                          {pingRes.ok ? '真实调用成功' : '调用失败'} ·{' '}
                          {formatDuration(pingRes.latencyMs)} ({pingRes.transportMode.toUpperCase()})
                        </div>
                        <div className="text-slate-300 break-all mt-0.5">
                          {pingRes.ok ? pingRes.reply : pingRes.error}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: DetectedHarness['status'] }> = ({ status }) => {
  if (status === 'ready') {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 flex items-center gap-1 shrink-0">
        <CheckCircle2 className="w-3 h-3" />
        已就绪
      </span>
    );
  }
  if (status === 'reserved') {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-400 border border-slate-700 shrink-0">
        首期预留
      </span>
    );
  }
  if (status === 'missing_cli') {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/35 flex items-center gap-1 shrink-0">
        <ShieldAlert className="w-3 h-3" />
        需独立 CLI
      </span>
    );
  }
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/35 shrink-0">
      未检测到
    </span>
  );
};
