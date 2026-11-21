import React, { useState } from 'react';
import {
  Edit3,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  DetectedHarness,
  HarnessId,
  RoleRouteConfig,
  TaskRole,
  TransportMode,
} from '@shared/domain';
import { HARNESS_META } from '../utils/format';

interface RolesRoutingViewProps {
  settings: AppSettings;
  harnesses: DetectedHarness[];
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onResetRoles: () => Promise<void>;
  onAutoFillRoutes: () => Promise<void>;
}

const COLOR_SWATCHES = [
  '#38bdf8',
  '#a78bfa',
  '#22d3ee',
  '#f472b6',
  '#34d399',
  '#fb923c',
  '#fbbf24',
  '#e879f9',
  '#60a5fa',
  '#4ade80',
];

export const RolesRoutingView: React.FC<RolesRoutingViewProps> = ({
  settings,
  harnesses,
  onSaveSettings,
  onResetRoles,
  onAutoFillRoutes,
}) => {
  const [editingRole, setEditingRole] = useState<TaskRole | null>(null);
  const [isNewRole, setIsNewRole] = useState(false);
  const [saving, setSaving] = useState(false);

  const usableHarnesses = harnesses;
  const harnessById = new Map(harnesses.map((h) => [h.id, h]));

  const coreRoles = settings.roles.filter((r) => r.kind === 'leader' || r.kind === 'reviewer');
  const workerRoles = settings.roles.filter((r) => r.kind === 'worker');

  const clearRoute = async (roleId: string) => {
    const nextRoutes = { ...settings.routes };
    delete nextRoutes[roleId];
    await onSaveSettings({ ...settings, routes: nextRoutes });
  };

  const updateRoute = async (roleId: string, patch: Partial<RoleRouteConfig>) => {
    const existing = settings.routes[roleId];

    if (!existing && !patch.harnessId) return;

    const targetHarnessId = (patch.harnessId ?? existing?.harnessId) as HarnessId;
    const targetHarness = harnessById.get(targetHarnessId);

    const nextRoute: RoleRouteConfig = existing
      ? { ...existing, ...patch }
      : {
          roleId,
          harnessId: targetHarnessId,
          modelId: patch.modelId ?? targetHarness?.models[0]?.id ?? 'default',
          transportMode: patch.transportMode ?? targetHarness?.defaultTransport ?? 'headless',
          effort: patch.effort,
          timeoutSec: 300,
        };

    // When switching harness, automatically pick valid transport & first available model
    if (patch.harnessId && existing && patch.harnessId !== existing.harnessId && targetHarness) {
      nextRoute.transportMode = targetHarness.defaultTransport;
      nextRoute.modelId = targetHarness.models[0]?.id || 'default';
    }

    const nextSettings: AppSettings = {
      ...settings,
      routes: {
        ...settings.routes,
        [roleId]: nextRoute,
      },
    };
    await onSaveSettings(nextSettings);
  };

  const openCreateRole = () => {
    setIsNewRole(true);
    setEditingRole({
      id: `custom-${Date.now().toString(36)}`,
      name: '',
      zhLabel: '',
      kind: 'worker',
      builtIn: false,
      description: '',
      classificationHints: '',
      systemPrompt: '',
      color: COLOR_SWATCHES[settings.roles.length % COLOR_SWATCHES.length],
      needsVisualInput: false,
      producesVisualArtifact: false,
    });
  };

  const openEditRole = (role: TaskRole) => {
    setIsNewRole(false);
    setEditingRole({ ...role });
  };

  const handleSaveRoleModal = async () => {
    if (!editingRole || !editingRole.name.trim()) return;
    setSaving(true);
    try {
      const normalizedId = isNewRole
        ? editingRole.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
            .replace(/^-|-$/g, '') || editingRole.id
        : editingRole.id;

      const finalRole: TaskRole = {
        ...editingRole,
        id: normalizedId,
        name: editingRole.name.trim(),
        zhLabel: editingRole.zhLabel.trim() || editingRole.name.trim(),
      };

      const nextRoles = isNewRole
        ? [...settings.roles, finalRole]
        : settings.roles.map((r) => (r.id === finalRole.id ? finalRole : r));

      await onSaveSettings({ ...settings, roles: nextRoles });
      setEditingRole(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (role: TaskRole) => {
    if (role.kind === 'leader' || role.kind === 'reviewer') return;
    const nextRoles = settings.roles.filter((r) => r.id !== role.id);
    const nextRoutes = { ...settings.routes };
    delete nextRoutes[role.id];
    await onSaveSettings({ ...settings, roles: nextRoles, routes: nextRoutes });
  };

  const renderRoleRow = (role: TaskRole) => {
    const route = settings.routes[role.id];
    const selectedHarness = route ? harnessById.get(route.harnessId) : undefined;
    const models = selectedHarness?.models || [];
    const selectedModelObj = models.find((m) => m.id === route?.modelId);
    const effortOptions = selectedModelObj?.effortOptions || ['low', 'medium', 'high'];

    const isConfigured = Boolean(route?.harnessId && route?.modelId);

    return (
      <div
        key={role.id}
        className={`rounded-xl p-3.5 transition space-y-3 border ${
          isConfigured
            ? 'glass-card hover:border-slate-700/90'
            : 'bg-surface-900/80 border-amber-500/30 hover:border-amber-400/50'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: role.color }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-100">{role.name}</span>
                <span className="text-xs text-slate-400">{role.zhLabel}</span>
                {!isConfigured && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/35">
                    未配置模型
                  </span>
                )}
                {role.kind === 'leader' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    总控核心
                  </span>
                )}
                {role.kind === 'reviewer' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
                    事前判类裁判
                  </span>
                )}
                {role.needsVisualInput && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">
                    视觉输入
                  </span>
                )}
                {!role.builtIn && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    自定义
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{role.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isConfigured && (
              <button
                onClick={() => clearRoute(role.id)}
                title="清空该角色的模型绑定"
                className="px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-amber-300 hover:bg-surface-800 transition"
              >
                清空
              </button>
            )}
            <button
              onClick={() => openEditRole(role)}
              title="编辑角色提示词与分类依据"
              className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-surface-800 transition"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            {role.kind === 'worker' && (
              <button
                onClick={() => handleDeleteRole(role)}
                title="删除此任务类型"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-surface-800 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Routing Controls */}
        <div className="grid grid-cols-12 gap-2.5 pt-2 border-t border-slate-800/80 text-xs">
          {/* Harness Selector */}
          <div className="col-span-3">
            <label className="block text-[10px] text-slate-500 mb-1">原生工位 (Harness)</label>
            <select
              value={route?.harnessId || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) {
                  void clearRoute(role.id);
                } else {
                  void updateRoute(role.id, { harnessId: val as HarnessId });
                }
              }}
              className="w-full bg-surface-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs focus:border-cyan-500 focus:outline-none"
            >
              <option value="">-- 未选择工位 --</option>
              {usableHarnesses.map((h) => (
                <option key={h.id} value={h.id}>
                  {HARNESS_META[h.id].label} {h.status === 'ready' ? '●' : '(未就绪)'}
                </option>
              ))}
            </select>
          </div>

          {/* Model Selector */}
          <div className="col-span-5">
            <label className="block text-[10px] text-slate-500 mb-1">
              绑定模型 ({route ? `${models.length} 个已探测` : '请先选择工位'})
            </label>
            <select
              value={route?.modelId || ''}
              disabled={!route}
              onChange={(e) => updateRoute(role.id, { modelId: e.target.value })}
              className="w-full bg-surface-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs font-mono focus:border-cyan-500 focus:outline-none disabled:opacity-45"
            >
              {!route ? (
                <option value="">-- 请先选择工位 --</option>
              ) : models.length === 0 ? (
                <option value="default">default (工位默认)</option>
              ) : (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Transport Selector */}
          <div className="col-span-2">
            <label className="block text-[10px] text-slate-500 mb-1">通信协议</label>
            <select
              value={route?.transportMode || selectedHarness?.defaultTransport || ''}
              disabled={!route}
              onChange={(e) =>
                updateRoute(role.id, { transportMode: e.target.value as TransportMode })
              }
              className="w-full bg-surface-950 border border-slate-700/80 rounded-lg px-2 py-1.5 text-slate-100 text-xs uppercase focus:border-cyan-500 focus:outline-none disabled:opacity-45"
            >
              {!route ? (
                <option value="">-</option>
              ) : (
                (selectedHarness?.supportedTransports || ['headless']).map((tr) => (
                  <option key={tr} value={tr}>
                    {tr === 'acp' ? 'ACP (JSON-RPC)' : 'Headless JSON'}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Reasoning Effort */}
          <div className="col-span-2">
            <label className="block text-[10px] text-slate-500 mb-1">思考强度</label>
            <select
              value={route?.effort || ''}
              disabled={!route}
              onChange={(e) =>
                updateRoute(role.id, { effort: e.target.value || undefined })
              }
              className="w-full bg-surface-950 border border-slate-700/80 rounded-lg px-2 py-1.5 text-slate-100 text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-45"
            >
              <option value="">跟随默认</option>
              {effortOptions.map((ef) => (
                <option key={ef} value={ef}>
                  {ef}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 bg-surface-900/90 flex items-center justify-between gap-3 shrink-0">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            任务类型划分与模型路由矩阵
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            自定义任务角色及其 Reviewer 分类依据，并将每个类型精确路由到对应原生 Agent 工位与模型（修改即时生效保存）。
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onAutoFillRoutes}
            title="按本机已探测到的就绪 Agent 自动填充尚未配置的角色"
            className="px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 border border-cyan-500/35 text-xs text-cyan-300 flex items-center gap-1.5 transition"
          >
            <Wand2 className="w-3.5 h-3.5" />
            智能填充空项
          </button>
          <button
            onClick={onResetRoles}
            className="px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 border border-slate-700 text-xs text-slate-300 flex items-center gap-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重置 9 角色
          </button>
          <button
            onClick={openCreateRole}
            className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            新增任务类型
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-400">
            中枢编排角色（Leader 拆解审阅 / Reviewer 事前判类）
          </h3>
          <div className="space-y-2.5">{coreRoles.map(renderRoleRow)}</div>
        </section>

        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            专业执行岗位（Reviewer 分类路由目标 · 共 {workerRoles.length} 类）
          </h3>
          <div className="space-y-2.5">{workerRoles.map(renderRoleRow)}</div>
        </section>
      </div>

      {/* Role Editor Modal */}
      {editingRole && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-xl bg-surface-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                {isNewRole ? '新增自定义任务类型' : `编辑角色：${editingRole.name}`}
              </h3>
              <button
                onClick={() => setEditingRole(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">角色英文/标识名 *</label>
                  <input
                    value={editingRole.name}
                    onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                    placeholder="如 Security-Auditor / Data-Analyst"
                    className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">中文岗位名称</label>
                  <input
                    value={editingRole.zhLabel}
                    onChange={(e) => setEditingRole({ ...editingRole, zhLabel: e.target.value })}
                    placeholder="如 安全审计专家"
                    className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">标签颜色</label>
                <div className="flex items-center gap-2">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setEditingRole({ ...editingRole, color: c })}
                      className={`w-6 h-6 rounded-full border-2 transition ${
                        editingRole.color === c ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">岗位职责描述（提供给 Leader 参考）</label>
                <textarea
                  rows={2}
                  value={editingRole.description}
                  onChange={(e) => setEditingRole({ ...editingRole, description: e.target.value })}
                  className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>

              {editingRole.kind === 'worker' && (
                <div>
                  <label className="block text-slate-400 mb-1">
                    Reviewer 分类判据（告诉 Reviewer 什么特征的子任务应路由到此角色）
                  </label>
                  <textarea
                    rows={2}
                    value={editingRole.classificationHints}
                    onChange={(e) =>
                      setEditingRole({ ...editingRole, classificationHints: e.target.value })
                    }
                    className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">角色系统提示词（System Prompt）</label>
                <textarea
                  rows={3}
                  value={editingRole.systemPrompt}
                  onChange={(e) =>
                    setEditingRole({ ...editingRole, systemPrompt: e.target.value })
                  }
                  className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>

              {editingRole.kind === 'worker' && (
                <div className="flex items-center gap-5 pt-1">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!editingRole.needsVisualInput}
                      onChange={(e) =>
                        setEditingRole({ ...editingRole, needsVisualInput: e.target.checked })
                      }
                      className="rounded border-slate-600"
                    />
                    需要自动附带产物目录中的图片供视觉审阅（如 Artist）
                  </label>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2 bg-surface-950/60">
              <button
                onClick={() => setEditingRole(null)}
                className="px-3.5 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-xs text-slate-300"
              >
                取消
              </button>
              <button
                onClick={handleSaveRoleModal}
                disabled={saving || !editingRole.name.trim()}
                className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                保存角色
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
