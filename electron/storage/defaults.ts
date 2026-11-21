import { DetectedHarness, HarnessId, RoleRouteConfig, TaskRole } from '../types/domain';

export const DEFAULT_ROLES: TaskRole[] = [
  {
    id: 'leader',
    name: 'Leader',
    zhLabel: '总控统筹者',
    kind: 'leader',
    builtIn: true,
    description:
      '负责理解用户的总体目标、将复杂任务拆分成清晰可执行的子块（含依赖关系）、审阅各子块的执行结果、汇总整合最终交付物，并在必要时发起新一轮迭代（包括在涉及视觉/UI/图片/3D时主动拆分审美评审子任务）。',
    classificationHints: '总控角色，不参与 Reviewer 的子任务分类目标列表。',
    systemPrompt:
      '你是 Agent_Team 协作团队的 Leader（总控统筹者）。你负责任务拆解、依赖规划、成果审阅与迭代决策。你必须严格按照要求的 JSON 结构输出规划与审阅结论，不要编造未实际执行的结果。',
    color: '#38bdf8',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    zhLabel: '事前任务分类审阅者',
    kind: 'reviewer',
    builtIn: true,
    description:
      '仅负责事前定性分类：审阅 Leader 拆分出来的每一个子任务块，根据当前团队的岗位角色定义，精准裁定该子任务最应该归属哪个任务类型（角色），交由路由器派发。',
    classificationHints: '分类裁判角色，不参与子任务执行分发。',
    systemPrompt:
      '你是 Agent_Team 的 Reviewer（任务类型定性审阅者）。你只做事前分类，不直接执行子任务，也不做最终结果验收。请严格依据给定角色列表，为每个子任务选择唯一最匹配的 roleId，并以标准 JSON 输出分类结果与简明理由。',
    color: '#a78bfa',
  },
  {
    id: 'coder',
    name: 'Coder',
    zhLabel: '通用代码开发者',
    kind: 'worker',
    builtIn: true,
    description: '负责通过编写、调试、重构代码解决通用编程、算法、脚本、工具链及自动化问题。',
    classificationHints:
      '适用场景：算法实现、Python/Node/Shell 脚本、CLI 工具、测试代码、数据处理、未明确偏向纯前端或纯后端的通用开发任务。',
    systemPrompt:
      '你是团队中的 Coder（通用代码开发者）。请直接高质量完成代码编写、调试与验证，保持代码结构清晰、可运行，并在结尾简明汇报修改的文件与验证结果。',
    color: '#22d3ee',
  },
  {
    id: 'front-developer',
    name: 'Front-Developer',
    zhLabel: '前端开发者',
    kind: 'worker',
    builtIn: true,
    description: '负责 Web/桌面前端页面设计实现、组件交互、CSS 布局动画、前端工程与界面美化。',
    classificationHints:
      '适用场景：React/Vue/HTML/CSS/Tailwind 页面开发、UI 组件、交互状态、响应式布局、Electron/Web 前端视图。',
    systemPrompt:
      '你是团队中的 Front-Developer（前端开发者）。请注重界面精致度、交互流畅度、代码可维护性与视觉层次，若生成可预览页面请在工作区或产物目录输出清晰路径。',
    color: '#f472b6',
    producesVisualArtifact: true,
  },
  {
    id: 'end-developer',
    name: 'End-Developer',
    zhLabel: '后端开发者',
    kind: 'worker',
    builtIn: true,
    description: '负责后端服务架构、接口 API、数据库 Schema、权限并发、业务逻辑与系统集成。',
    classificationHints:
      '适用场景：REST/GraphQL/RPC 接口、服务端业务逻辑、数据库建模与迁移、进程调度、鉴权安全、后端服务与性能调优。',
    systemPrompt:
      '你是团队中的 End-Developer（后端开发者）。请注重系统稳定性、边界错误处理、接口契约清晰与安全性，确保后端逻辑严谨且经过验证。',
    color: '#34d399',
  },
  {
    id: 'drawer',
    name: 'Drawer',
    zhLabel: '图片绘制者',
    kind: 'worker',
    builtIn: true,
    description: '负责图片生成、插画素材绘制、图标/海报/SVG 矢量图创作，并将成品图片输出到指定产物目录。',
    classificationHints:
      '适用场景：生成配图、概念图、图标、插画、流程图/信息图、SVG/Canvas 绘图或调用生图工具产出视觉文件。',
    systemPrompt:
      '你是团队中的 Drawer（图片绘制者）。请充分利用当前工位的绘图/图像生成工具或高质量矢量/代码绘图能力完成视觉素材制作，务必将生成的图片文件保存至指定的共享产物目录，并在汇报中列出准确绝对路径。',
    color: '#fb923c',
    producesVisualArtifact: true,
  },
  {
    id: '3d-developer',
    name: '3D-Developer',
    zhLabel: '3D 建模者',
    kind: 'worker',
    builtIn: true,
    description: '负责 3D 模型、场景搭建、着色器、WebGL/Three.js、Blender Python 或 OpenSCAD 建模与渲染预览。',
    classificationHints:
      '适用场景：3D 建模、Three.js/Babylon.js 3D 场景、Blender 脚本建模、GLTF/OBJ/STL 模型生成与 3D 渲染预览。',
    systemPrompt:
      '你是团队中的 3D-Developer（3D 建模者）。请输出规范的 3D 场景代码、建模脚本或导出模型文件（如 .gltf/.obj/.stl/.html 3D 预览），并将模型与预览图输出到指定目录，汇报准确路径。',
    color: '#fbbf24',
    producesVisualArtifact: true,
  },
  {
    id: 'artist',
    name: 'Artist',
    zhLabel: '审美审核者',
    kind: 'worker',
    builtIn: true,
    description: '负责对 UI 界面、生成图片或 3D 渲染成果进行视觉审美评估，裁定是否美观并提出具体视觉优化建议。',
    classificationHints:
      '适用场景：由 Leader 拆出的 UI/图片/3D 审美评审任务、构图色彩排版审查、视觉体验验收与改进意见裁定。',
    systemPrompt:
      '你是团队中的 Artist（审美审核者）。请从构图、色彩搭配、对比度、视觉层次、排版对齐与整体高级感出发，客观严格地评估目标 UI/图片/3D 成果，给出明确裁定（通过 / 需修改）及可执行的具体修改点。',
    color: '#e879f9',
    needsVisualInput: true,
  },
  {
    id: 'copywriter',
    name: 'Copywriter',
    zhLabel: '文案编写者',
    kind: 'worker',
    builtIn: true,
    description: '负责产品文案、技术文档、README、需求说明、营销故事与各类高质量文本撰写与润色。',
    classificationHints:
      '适用场景：文档编写、产品介绍文案、宣发文本、用户手册、创意写作、内容总结与语言润色。',
    systemPrompt:
      '你是团队中的 Copywriter（文案编写者）。请根据受众与语境撰写逻辑清晰、表达精准、自然流畅且富有感染力的文本内容。',
    color: '#60a5fa',
  },
];

function pickModel(
  harness: DetectedHarness | undefined,
  preferredPatterns: RegExp[]
): string {
  if (!harness || harness.models.length === 0) return 'default';
  for (const pat of preferredPatterns) {
    const found = harness.models.find(
      (m) => pat.test(m.id) || pat.test(m.name)
    );
    if (found) return found.id;
  }
  return harness.models[0].id;
}

/**
 * Generates an intelligent default routing table based on whichever native harnesses
 * are actually ready on the current machine.
 */
export function buildDefaultRoutes(
  roles: TaskRole[],
  harnesses: DetectedHarness[],
  existingRoutes: Record<string, RoleRouteConfig> = {}
): Record<string, RoleRouteConfig> {
  const ready = harnesses.filter((h) => h.status === 'ready');
  const byId = new Map<HarnessId, DetectedHarness>(ready.map((h) => [h.id, h]));

  const fallback = ready[0];
  const pickHarness = (preferred: HarnessId[]): DetectedHarness | undefined => {
    for (const id of preferred) {
      const h = byId.get(id);
      if (h) return h;
    }
    return fallback;
  };

  const rolePreferences: Record<
    string,
    { harnesses: HarnessId[]; modelPatterns: RegExp[]; effort?: string }
  > = {
    leader: {
      harnesses: ['antigravity', 'claude', 'codex', 'deepseek'],
      modelPatterns: [/gemini-4-neon-xhigh/i, /gemini-4-neon-high/i, /opus/i, /gpt-6\.2/i, /pro/i],
      effort: 'high',
    },
    reviewer: {
      harnesses: ['deepseek', 'antigravity', 'claude', 'codex'],
      modelPatterns: [/deepseek-flash/i, /v4-flash/i, /flash/i, /haiku/i, /luna/i],
      effort: 'low',
    },
    coder: {
      harnesses: ['antigravity', 'codex', 'claude', 'deepseek'],
      modelPatterns: [/gemini-4-neon-high/i, /gpt-6\.2-sol/i, /sonnet/i, /v4-pro/i],
      effort: 'high',
    },
    'front-developer': {
      harnesses: ['claude', 'antigravity', 'codex', 'deepseek'],
      modelPatterns: [/sonnet/i, /opus/i, /gemini-4-neon-high/i, /gpt-6\.2/i],
      effort: 'high',
    },
    'end-developer': {
      harnesses: ['codex', 'antigravity', 'claude', 'deepseek'],
      modelPatterns: [/gpt-6\.2-sol/i, /gpt-6\.1-sol/i, /gpt-6/i, /gemini-4-neon/i, /opus/i],
      effort: 'high',
    },
    drawer: {
      harnesses: ['antigravity', 'claude', 'codex', 'deepseek'],
      modelPatterns: [/gemini-4-neon-high/i, /gemini-4-carbon/i, /sonnet/i],
    },
    '3d-developer': {
      harnesses: ['codex', 'antigravity', 'claude', 'deepseek'],
      modelPatterns: [/gpt-6\.2/i, /gemini-4-neon-high/i, /sonnet/i],
    },
    artist: {
      harnesses: ['antigravity', 'claude', 'codex', 'deepseek'],
      modelPatterns: [/gemini-4-neon-xhigh/i, /gemini-4-neon-high/i, /opus/i, /gpt-6\.2/i],
    },
    copywriter: {
      harnesses: ['antigravity', 'deepseek', 'claude', 'codex'],
      modelPatterns: [/gemini-4-neon-high/i, /deepseek-v4-pro/i, /sonnet/i],
    },
  };

  const routes: Record<string, RoleRouteConfig> = {};
  for (const role of roles) {
    const existing = existingRoutes[role.id];
    if (existing && byId.has(existing.harnessId)) {
      const targetHarness = byId.get(existing.harnessId)!;
      const modelStillValid =
        existing.modelId === 'default' ||
        targetHarness.models.some((m) => m.id === existing.modelId);
      routes[role.id] = {
        ...existing,
        modelId: modelStillValid
          ? existing.modelId
          : pickModel(targetHarness, rolePreferences[role.id]?.modelPatterns ?? []),
      };
      continue;
    }

    const pref = rolePreferences[role.id] ?? {
      harnesses: ['antigravity', 'claude', 'codex', 'deepseek'] as HarnessId[],
      modelPatterns: [/neon/i, /sonnet/i, /sol/i, /flash/i],
    };
    const chosen = pickHarness(pref.harnesses);
    if (chosen) {
      routes[role.id] = {
        roleId: role.id,
        harnessId: chosen.id,
        modelId: pickModel(chosen, pref.modelPatterns),
        transportMode: chosen.defaultTransport,
        effort: pref.effort,
        timeoutSec: 300,
      };
    } else if (existing) {
      routes[role.id] = existing;
    } else {
      routes[role.id] = {
        roleId: role.id,
        harnessId: 'antigravity',
        modelId: 'default',
        transportMode: 'acp',
        timeoutSec: 300,
      };
    }
  }
  return routes;
}
