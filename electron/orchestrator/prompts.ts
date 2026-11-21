import { RoutingMode, SubtaskItem, TaskRole } from '../types/domain';

export function buildLeaderPlanPrompt(params: {
  goal: string;
  workspaceDir: string;
  artifactDir: string;
  workerRoles: TaskRole[];
  routingMode?: RoutingMode;
}): string {
  const roleSummary = params.workerRoles
    .map((r) => `- ${r.name} (${r.zhLabel}): ${r.description}`)
    .join('\n');

  const routingDesc =
    params.routingMode === 'manual'
      ? '稍后会由用户亲自审阅并手动决定每个子任务路由给哪个专业角色。'
      : '稍后会由专门的 Reviewer 对每个子任务进行类型定性分类，再由 Router 路由给对应专业 Agent。';

  return `你现在处于【阶段 1：Leader 任务拆解】。
请分析用户的总体目标，将其拆分为清晰、原子化、可独立交接给不同专业工位执行的子任务（subtasks）。

【重要分工原则】
1. 你（Leader）只负责拆分子任务和规划依赖关系，**不要指定最终由哪个模型执行**——${routingDesc}
2. 当前团队可用的专业能力领域参考如下（你可以据此合理切分任务边界）：
${roleSummary}
3. 请注意：不要在这个阶段直接修改代码或写文件，本阶段仅输出拆解规划 JSON！
4. 如果子任务会产生图片、截图、设计稿、3D 模型或文档等共享产物，请要求执行者保存到共享产物目录：\`${params.artifactDir}\`。
5. 若目标简单，可以只拆 1~2 个子任务；若涉及前后端、文案、画图、3D 等多领域，请按领域清晰拆分，避免单个子任务混杂不同专业类型。
6. **并发可行性判断（非常重要）**：请你仔细分析拆出的多个子任务之间是否存在先后依赖或写入同一文件的冲突：
   - 如果多个子任务互相独立、不会写入冲突的同一文件，请将它们的 \`"canRunInParallel"\` 设为 \`true\`，设置相同的 \`"parallelGroup"\`（如 \`"batch-1"\`），并在 \`"parallelReason"\` 说明可同时运行的原因；后续调度器将真正**同时并行运行**这些子任务！
   - 如果某个子任务依赖前置结果，请在 \`"dependsOn"\` 中明确列出前置任务 ID；若某任务需要独占修改工作区关键共享文件且不能与其他任务同时运行，请将 \`"canRunInParallel"\` 设为 \`false\` 并说明原因。

【工作区路径】
${params.workspaceDir}

【用户目标】
${params.goal}

【严格输出格式】
请只输出一个合法 JSON 代码块（不要调用工具修改文件）：
\`\`\`json
{
  "planSummary": "整体执行方案与拆分思路概述",
  "parallelPlanSummary": "说明哪些子任务可以同时并行运行、哪些需要串行或等待前置依赖",
  "subtasks": [
    {
      "id": "T1",
      "title": "子任务简短标题",
      "description": "极其清晰具体的执行要求、输入上下文、验收标准以及输出位置",
      "dependsOn": [],
      "canRunInParallel": true,
      "parallelGroup": "batch-1",
      "parallelReason": "与其他子任务修改不同文件且无输入依赖，可同时运行",
      "expectedArtifacts": ["可选：预期在工作区或产物目录生成的文件名/路径说明"]
    }
  ]
}
\`\`\``;
}

export function buildReviewerClassifyPrompt(params: {
  goal: string;
  subtask: SubtaskItem;
  workerRoles: TaskRole[];
}): string {
  const catalog = params.workerRoles
    .map(
      (r) =>
        `- roleId: "${r.id}" | 名称: ${r.name} (${r.zhLabel})\n  职责: ${r.description}\n  分类依据: ${r.classificationHints}`
    )
    .join('\n');

  return `你现在处于【阶段 2：Reviewer 事前任务定性分类】。
你的唯一职责是：审阅下方由 Leader 拆出的子任务，从「可用任务类型列表」中挑选**唯一最匹配**的 \`roleId\`。
不要执行任务本身，不要调用任何编辑或命令工具！

【可用任务类型（角色）清单】
${catalog}

【总体项目目标（供参考背景）】
${params.goal}

【待分类子任务】
- ID: ${params.subtask.id}
- 标题: ${params.subtask.title}
- 详细描述: ${params.subtask.description}
- 预期产物: ${(params.subtask.expectedArtifacts || []).join(', ') || '无特定声明'}

【严格输出格式】
请仅输出一个合法 JSON 代码块：
\`\`\`json
{
  "roleId": "必须严格等于上方清单中的某一个 roleId",
  "confidence": 0.95,
  "reason": "一句话说明为什么归类为该任务类型"
}
\`\`\``;
}

export function buildWorkerExecutionPrompt(params: {
  goal: string;
  role: TaskRole;
  subtask: SubtaskItem;
  workspaceDir: string;
  artifactDir: string;
  upstreamOutputs: Array<{ id: string; title: string; roleName: string; output: string }>;
  existingArtifacts: string[];
}): string {
  const upstreamSection =
    params.upstreamOutputs.length > 0
      ? params.upstreamOutputs
          .map(
            (u) =>
              `### 上游任务 [${u.id}] ${u.title}（执行角色：${u.roleName}）\n${u.output.slice(0, 4000)}`
          )
          .join('\n\n')
      : '无直接上游依赖。';

  const artifactSection =
    params.existingArtifacts.length > 0
      ? params.existingArtifacts.map((f) => `- ${f}`).join('\n')
      : '（当前产物目录为空）';

  const artistGuidance = params.role.needsVisualInput
    ? `\n【视觉/审美评审特别说明】\n请优先查看产物目录或工作区中的相关图片、截图、页面文件或 3D 预览，给出具体的视觉评分、问题清单和明确结论（通过 / 需修改）。`
    : '';

  return `你是 Agent_Team 协同团队中的 **${params.role.name}（${params.role.zhLabel}）**。
你正在自己的原生专属工位中工作，请充分发挥你所在工位的全部原生工具与专长，高质量完成当前指派给你的子任务。

【总体目标背景】
${params.goal}

【当前指派给你的子任务】
- 任务 ID：${params.subtask.id}
- 标题：${params.subtask.title}
- 具体要求：
${params.subtask.description}
- 预期产物：${(params.subtask.expectedArtifacts || []).join(', ') || '按需生成'}

【环境路径】
- 项目工作区：${params.workspaceDir}
- 共享产物目录（跨 Agent 交接文件/图片/报告请尽量存放于此）：${params.artifactDir}

【当前共享产物目录已有文件】
${artifactSection}

【上游已完成子任务结果】
${upstreamSection}
${artistGuidance}

【交付要求】
1. 直接在工作区或共享产物目录落实实际工作（写代码/改文件/绘图/建模/写文案/审阅）。
2. 完成后用清晰结构总结：做了什么、修改/产出了哪些文件（请给出准确路径）、关键结果或遗留风险，便于 Leader 审阅汇总。`;
}

export function buildLeaderReviewPrompt(params: {
  goal: string;
  round: number;
  maxRounds: number;
  workspaceDir: string;
  artifactDir: string;
  subtasks: SubtaskItem[];
  artifactsInDir: string[];
  workerRoles: TaskRole[];
}): string {
  const resultsBlock = params.subtasks
    .map((t) => {
      const statusStr = t.status === 'completed' ? '已完成' : `异常(${t.status})`;
      const body =
        t.status === 'completed'
          ? (t.output || '').slice(0, 4500)
          : `错误信息：${t.error || '未知错误'}`;
      return `### [${t.id}] (第${t.round}轮) ${t.title}
- Reviewer 分类角色：${t.assignedRoleName || '未知'}
- 执行工位/模型：${t.harnessId || '-'} / ${t.modelId || '-'}
- 状态：${statusStr}
- 执行输出：
${body}`;
    })
    .join('\n\n---\n\n');

  const artifactsList =
    params.artifactsInDir.length > 0
      ? params.artifactsInDir.map((f) => `- ${f}`).join('\n')
      : '（无新增产物文件）';

  const hasArtist = params.workerRoles.some((r) => r.id === 'artist' || r.needsVisualInput);
  const artistHint = hasArtist
    ? '特别注意：如果本轮产出了新的 UI 页面、图片素材或 3D 视觉结果，且尚未经过视觉审美验收，你可以选择 `decision: "iterate"` 并拆分出一个审美验收子任务（稍后 Reviewer 会将其路由给 Artist 审美审核者），待审美反馈回来后再决定是否继续修改或最终交付。'
    : '';

  const forceFinishHint =
    params.round >= params.maxRounds
      ? `\n⚠️ 当前已是最后一轮（第 ${params.round}/${params.maxRounds} 轮），请务必汇总所有结果并输出 decision: "finish" 与完整的 finalReport！`
      : '';

  return `你现在处于【阶段 4：Leader 结果审阅与迭代决策】（当前第 ${params.round}/${params.maxRounds} 轮）。
请仔细审阅所有子任务的执行结果与产物，判断是否已完全达成用户目标：
- 若结果已满足要求且无需进一步修改或审美把关，请选择 \`"decision": "finish"\` 并撰写高质量的 \`finalReport\`（Markdown 格式，汇总全部成果、文件位置和使用说明）。
- 若存在缺漏、失败、代码缺陷，或者需要视觉审美审核/按审美意见返工，请选择 \`"decision": "iterate"\`，写明审阅意见，并在 \`nextSubtasks\` 中给出下一轮需要派发的新子任务（编号请接续，例如 T${params.subtasks.length + 1}）。

${artistHint}${forceFinishHint}
本阶段仅做审阅决策，不要直接调用工具修改业务文件，只输出合法 JSON！

【用户原始目标】
${params.goal}

【工作区与产物目录】
- 工作区：${params.workspaceDir}
- 产物目录文件：
${artifactsList}

【截至目前所有子任务结果】
${resultsBlock}

【严格输出格式】
\`\`\`json
{
  "decision": "finish",
  "reviewNotes": "对本轮各子任务结果的审阅评价",
  "finalReport": "当 decision 为 finish 时必填：面向用户的完整 Markdown 总结交付报告",
  "nextSubtasks": [
    {
      "id": "T99",
      "title": "当 decision 为 iterate 时填写的新增子任务标题",
      "description": "清晰描述返工/审核/补充任务的具体要求与相关文件路径",
      "dependsOn": [],
      "canRunInParallel": true,
      "parallelGroup": "iter-batch-1",
      "parallelReason": "说明是否可与本轮其他新增子任务同时并行运行",
      "expectedArtifacts": []
    }
  ]
}
\`\`\``;
}
