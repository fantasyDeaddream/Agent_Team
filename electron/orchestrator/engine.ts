import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { HarnessRegistry } from '../adapters/registry';
import { ConfigStore } from '../storage/configStore';
import {
  AppSettings,
  CommMessage,
  ManualRouteAssignment,
  OrchestrationRun,
  RoleRouteConfig,
  RunEventPayload,
  StartRunRequest,
  SubmitManualRoutesRequest,
  SubtaskItem,
  TaskRole,
} from '../types/domain';
import { extractJsonObject } from './jsonParser';
import {
  buildLeaderPlanPrompt,
  buildLeaderReviewPrompt,
  buildReviewerClassifyPrompt,
  buildWorkerExecutionPrompt,
} from './prompts';

interface PlannedSubtaskSpec {
  id?: string;
  title?: string;
  description?: string;
  dependsOn?: string[];
  canRunInParallel?: boolean;
  parallelGroup?: string;
  parallelReason?: string;
  expectedArtifacts?: string[];
}

interface LeaderPlanJson {
  planSummary?: string;
  parallelPlanSummary?: string;
  subtasks?: PlannedSubtaskSpec[];
}

interface ReviewerClassifyJson {
  roleId?: string;
  confidence?: number;
  reason?: string;
}

interface LeaderReviewJson {
  decision?: 'finish' | 'iterate';
  reviewNotes?: string;
  finalReport?: string;
  nextSubtasks?: PlannedSubtaskSpec[];
}

export class OrchestrationEngine {
  private activeAbortController: AbortController | null = null;
  private activeRunId: string | null = null;
  private pendingManualRouting: {
    runId: string;
    resolve: (assignments: ManualRouteAssignment[]) => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(
    private readonly registry: HarnessRegistry,
    private readonly store: ConfigStore,
    private readonly emitEvent: (payload: RunEventPayload) => void
  ) {}

  isRunning(): boolean {
    return this.activeRunId !== null;
  }

  cancelActiveRun(): boolean {
    if (!this.activeAbortController) return false;
    this.activeAbortController.abort();
    if (this.pendingManualRouting) {
      this.pendingManualRouting.reject(new Error('任务已被用户中止'));
      this.pendingManualRouting = null;
    }
    return true;
  }

  submitManualRoutes(req: SubmitManualRoutesRequest): boolean {
    if (!this.pendingManualRouting || this.pendingManualRouting.runId !== req.runId) {
      throw new Error('当前没有等待手动路由确认的运行任务');
    }
    const pending = this.pendingManualRouting;
    this.pendingManualRouting = null;
    pending.resolve(req.assignments);
    return true;
  }

  private waitForManualRouting(
    runId: string,
    signal: AbortSignal
  ): Promise<ManualRouteAssignment[]> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('任务已被用户中止'));
        return;
      }
      const onAbort = () => {
        if (this.pendingManualRouting?.runId === runId) {
          this.pendingManualRouting = null;
        }
        reject(new Error('任务已被用户中止'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      this.pendingManualRouting = {
        runId,
        resolve: (assignments) => {
          signal.removeEventListener('abort', onAbort);
          resolve(assignments);
        },
        reject: (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      };
    });
  }

  async startRun(req: StartRunRequest, settings: AppSettings): Promise<OrchestrationRun> {
    if (this.activeRunId) {
      throw new Error('当前已有任务正在执行，请等待完成或先中止当前任务');
    }

    const workspaceDir = req.workspaceDir?.trim() || settings.defaultWorkspaceDir || process.cwd();
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }

    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${crypto
      .randomBytes(2)
      .toString('hex')}`;
    const artifactDir = path.join(workspaceDir, '.agent_team', 'runs', runId, 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });

    const now = new Date().toISOString();
    const run: OrchestrationRun = {
      id: runId,
      goal: req.goal.trim(),
      workspaceDir,
      artifactDir,
      status: 'planning',
      routingMode: req.routingMode || settings.defaultRoutingMode || 'reviewer',
      currentRound: 1,
      maxRounds: Math.max(1, Math.min(10, req.maxRounds || 3)),
      maxConcurrency: Math.max(1, Math.min(6, req.maxConcurrency || 2)),
      permissionMode: req.permissionMode || 'workspace-write',
      createdAt: now,
      updatedAt: now,
      leaderReviews: [],
      subtasks: [],
      messages: [],
    };

    const controller = new AbortController();
    this.activeAbortController = controller;
    this.activeRunId = runId;

    this.store.saveRun(run);
    this.broadcastRun(run);

    // Execute orchestration asynchronously so IPC start call returns immediately with runId
    void this.executeLifecycle(run, settings, controller.signal).finally(() => {
      this.activeAbortController = null;
      this.activeRunId = null;
      this.pendingManualRouting = null;
    });

    return run;
  }

  private async executeLifecycle(
    run: OrchestrationRun,
    initialSettings: AppSettings,
    signal: AbortSignal
  ): Promise<void> {
    let settings = initialSettings;
    const leaderRole = settings.roles.find((r) => r.kind === 'leader') ?? settings.roles[0];
    const reviewerRole = settings.roles.find((r) => r.kind === 'reviewer') ?? settings.roles[1];
    let workerRoles = settings.roles.filter((r) => r.kind === 'worker');

    const leaderRoute = this.requireRoute(leaderRole, settings);
    const reviewerRoute =
      run.routingMode === 'reviewer' ? this.requireRoute(reviewerRole, settings) : undefined;

    try {
      this.pushComm(run, {
        round: 1,
        from: 'User',
        to: `Leader (${leaderRoute.harnessId})`,
        stage: 'plan',
        harnessId: leaderRoute.harnessId,
        modelId: leaderRoute.modelId,
        title: '提交任务目标给 Leader',
        content: run.goal,
      });

      // === STAGE 1: LEADER INITIAL PLANNING ===
      run.status = 'planning';
      this.saveAndBroadcast(run);

      const planPrompt = buildLeaderPlanPrompt({
        goal: run.goal,
        workspaceDir: run.workspaceDir,
        artifactDir: run.artifactDir,
        workerRoles,
        routingMode: run.routingMode,
      });

      const planRes = await this.invokeRole({
        role: leaderRole,
        route: leaderRoute,
        settings,
        prompt: planPrompt,
        workspaceDir: run.workspaceDir,
        permissionMode: 'safe',
        signal,
        onStream: () => {},
      });

      const planJson = extractJsonObject<LeaderPlanJson>(planRes.text);
      const rawSubtasks: PlannedSubtaskSpec[] =
        planJson?.subtasks && planJson.subtasks.length > 0
          ? planJson.subtasks
          : [
              {
                id: 'T1',
                title: '执行用户目标任务',
                description: run.goal,
                dependsOn: [],
                canRunInParallel: true,
                parallelGroup: 'batch-1',
                parallelReason: '单任务直接执行',
                expectedArtifacts: [],
              },
            ];

      run.planSummary =
        planJson?.planSummary ||
        `Leader 已完成任务拆解，共规划 ${rawSubtasks.length} 个子任务。`;
      run.parallelPlanSummary = planJson?.parallelPlanSummary?.trim() || undefined;

      let roundTasks: SubtaskItem[] = rawSubtasks.map((st, idx) => ({
        id: st.id?.trim() || `T${idx + 1}`,
        round: 1,
        title: st.title?.trim() || `子任务 ${idx + 1}`,
        description: st.description?.trim() || run.goal,
        dependsOn: Array.isArray(st.dependsOn) ? st.dependsOn : [],
        canRunInParallel: typeof st.canRunInParallel === 'boolean' ? st.canRunInParallel : true,
        parallelGroup: st.parallelGroup?.trim() || undefined,
        parallelReason: st.parallelReason?.trim() || undefined,
        expectedArtifacts: Array.isArray(st.expectedArtifacts) ? st.expectedArtifacts : [],
        status: 'planned',
        streamLog: '',
      }));

      run.subtasks.push(...roundTasks);
      const parallelCount = roundTasks.filter((t) => t.canRunInParallel !== false).length;
      this.pushComm(run, {
        round: 1,
        from: `Leader (${leaderRoute.harnessId} / ${leaderRoute.modelId})`,
        to:
          run.routingMode === 'manual'
            ? 'User (手动路由)'
            : `Reviewer (${reviewerRoute?.harnessId || '-'})`,
        stage: 'plan',
        harnessId: leaderRoute.harnessId,
        modelId: leaderRoute.modelId,
        title: `Leader 拆解完成：共 ${roundTasks.length} 个子任务（${parallelCount} 个可并行）`,
        content: `${run.planSummary}${
          run.parallelPlanSummary ? `\n\n并发规划：${run.parallelPlanSummary}` : ''
        }\n\n${roundTasks
          .map(
            (t) =>
              `- [${t.id}] ${t.title} [${
                t.canRunInParallel === false ? '串行独占' : '可并行'
              }]：${t.description.slice(0, 140)}`
          )
          .join('\n')}`,
      });
      this.saveAndBroadcast(run);

      // === ITERATION LOOP: REVIEWER/MANUAL ROUTING -> ROUTER DISPATCH -> LEADER AUDIT ===
      for (let round = 1; round <= run.maxRounds; round++) {
        if (signal.aborted) throw new Error('任务已被用户中止');
        run.currentRound = round;

        // === STAGE 2: REVIEWER CLASSIFICATION OR MANUAL USER ROUTING ===
        if (run.routingMode === 'manual') {
          run.status = 'awaiting_manual_routing';
          for (const st of roundTasks) {
            st.status = 'awaiting_route';
          }
          this.pushComm(run, {
            round,
            from: 'Orchestrator',
            to: 'User (手动路由)',
            stage: 'classify',
            title: `第 ${round} 轮等待用户手动指派 ${roundTasks.length} 个子任务的角色`,
            content: roundTasks.map((t) => `- [${t.id}] ${t.title}`).join('\n'),
          });
          this.saveAndBroadcast(run);

          const userAssignments = await this.waitForManualRouting(run.id, signal);
          if (signal.aborted) throw new Error('任务已被用户中止');

          // Reload latest settings in case the user adjusted role bindings before confirming
          settings = this.store.loadSettings();
          workerRoles = settings.roles.filter((r) => r.kind === 'worker');

          const assignMap = new Map(userAssignments.map((a) => [a.subtaskId, a.roleId]));
          for (const subtask of roundTasks) {
            const pickedRoleId = assignMap.get(subtask.id);
            const matchedRole =
              workerRoles.find((r) => r.id === pickedRoleId) ||
              workerRoles.find((r) => r.id === 'coder') ||
              workerRoles[0];
            const targetRoute = this.requireRoute(matchedRole, settings);

            subtask.assignedRoleId = matchedRole.id;
            subtask.assignedRoleName = matchedRole.name;
            subtask.reviewerConfidence = 1;
            subtask.reviewerReason = `用户手动路由至 ${matchedRole.name}（${matchedRole.zhLabel}）`;
            subtask.harnessId = targetRoute.harnessId;
            subtask.modelId = targetRoute.modelId;
            subtask.transportMode = targetRoute.transportMode;
            subtask.status = 'queued';

            this.pushComm(run, {
              round,
              from: 'User (手动路由)',
              to: `Router → ${matchedRole.name} (${targetRoute.harnessId} / ${targetRoute.modelId})`,
              stage: 'classify',
              subtaskId: subtask.id,
              harnessId: targetRoute.harnessId,
              modelId: targetRoute.modelId,
              title: `[${subtask.id}] 手动指派为 ${matchedRole.name}`,
              content: `路由目标：${targetRoute.harnessId} · ${targetRoute.modelId} (${targetRoute.transportMode.toUpperCase()})`,
            });
          }
          this.saveAndBroadcast(run);
        } else {
          run.status = 'classifying';
          this.saveAndBroadcast(run);

          for (const subtask of roundTasks) {
            if (signal.aborted) throw new Error('任务已被用户中止');
            subtask.status = 'classifying';
            this.saveAndBroadcast(run);

            const classifyPrompt = buildReviewerClassifyPrompt({
              goal: run.goal,
              subtask,
              workerRoles,
            });

            const classifyRes = await this.invokeRole({
              role: reviewerRole,
              route: reviewerRoute!,
              settings,
              prompt: classifyPrompt,
              workspaceDir: run.workspaceDir,
              permissionMode: 'safe',
              signal,
            });

            const parsed = extractJsonObject<ReviewerClassifyJson>(classifyRes.text);
            const matchedRole =
              workerRoles.find((r) => r.id === parsed?.roleId) ||
              workerRoles.find(
                (r) =>
                  r.name.toLowerCase() === String(parsed?.roleId || '').toLowerCase()
              ) ||
              workerRoles.find((r) => r.id === 'coder') ||
              workerRoles[0];

            const targetRoute = this.requireRoute(matchedRole, settings);

            subtask.assignedRoleId = matchedRole.id;
            subtask.assignedRoleName = matchedRole.name;
            subtask.reviewerConfidence =
              typeof parsed?.confidence === 'number' ? parsed.confidence : 0.85;
            subtask.reviewerReason =
              parsed?.reason || `归类为 ${matchedRole.name}（${matchedRole.zhLabel}）`;
            subtask.harnessId = targetRoute.harnessId;
            subtask.modelId = targetRoute.modelId;
            subtask.transportMode = targetRoute.transportMode;
            subtask.status = 'queued';

            this.pushComm(run, {
              round,
              from: `Reviewer (${reviewerRoute!.harnessId})`,
              to: `Router → ${matchedRole.name} (${targetRoute.harnessId} / ${targetRoute.modelId})`,
              stage: 'classify',
              subtaskId: subtask.id,
              harnessId: targetRoute.harnessId,
              modelId: targetRoute.modelId,
              title: `[${subtask.id}] 判类为 ${matchedRole.name} (${Math.round(
                (subtask.reviewerConfidence ?? 0.85) * 100
              )}%)`,
              content: `分类依据：${subtask.reviewerReason}\n路由目标：${targetRoute.harnessId} · ${targetRoute.modelId} (${targetRoute.transportMode.toUpperCase()})`,
            });
            this.saveAndBroadcast(run);
          }
        }

        // === STAGE 3: ROUTER DISPATCH & TOPOLOGICAL PARALLEL EXECUTION ===
        run.status = 'executing';
        this.saveAndBroadcast(run);

        await this.executeSubtasksDag(run, roundTasks, settings, signal);

        // === STAGE 4: LEADER RESULT REVIEW & ITERATION DECISION ===
        if (signal.aborted) throw new Error('任务已被用户中止');
        run.status = 'reviewing';
        this.saveAndBroadcast(run);

        const artifactsInDir = this.scanArtifacts(run.artifactDir);
        const reviewPrompt = buildLeaderReviewPrompt({
          goal: run.goal,
          round,
          maxRounds: run.maxRounds,
          workspaceDir: run.workspaceDir,
          artifactDir: run.artifactDir,
          subtasks: run.subtasks,
          artifactsInDir,
          workerRoles,
        });

        const reviewRes = await this.invokeRole({
          role: leaderRole,
          route: leaderRoute,
          settings,
          prompt: reviewPrompt,
          workspaceDir: run.workspaceDir,
          permissionMode: 'safe',
          signal,
        });

        const reviewJson = extractJsonObject<LeaderReviewJson>(reviewRes.text);
        const wantsIterate =
          reviewJson?.decision === 'iterate' &&
          round < run.maxRounds &&
          Array.isArray(reviewJson.nextSubtasks) &&
          reviewJson.nextSubtasks.length > 0;

        const reviewNotes =
          reviewJson?.reviewNotes || reviewRes.text.slice(0, 1200) || 'Leader 已完成审阅。';

        run.leaderReviews.push({
          round,
          decision: wantsIterate ? 'iterate' : 'finish',
          reviewNotes,
          timestamp: new Date().toISOString(),
        });

        if (!wantsIterate) {
          run.finalReport =
            reviewJson?.finalReport ||
            this.synthesizeFallbackReport(run, reviewNotes);
          run.status = 'completed';
          run.finishedAt = new Date().toISOString();

          this.pushComm(run, {
            round,
            from: `Leader (${leaderRoute.harnessId})`,
            to: 'User',
            stage: 'review',
            harnessId: leaderRoute.harnessId,
            modelId: leaderRoute.modelId,
            title: `第 ${round} 轮审阅通过 — 汇总最终交付`,
            content: reviewNotes,
          });
          this.saveAndBroadcast(run);
          return;
        }

        // Leader requested another iteration with follow-up subtasks (e.g., bug fix or Artist aesthetic audit)
        const baseIdx = run.subtasks.length;
        const nextRound = round + 1;
        roundTasks = (reviewJson!.nextSubtasks || []).map((st, idx) => ({
          id: st.id?.trim() || `T${baseIdx + idx + 1}`,
          round: nextRound,
          title: st.title?.trim() || `迭代子任务 ${baseIdx + idx + 1}`,
          description: st.description?.trim() || '按 Leader 审阅意见继续完善',
          dependsOn: Array.isArray(st.dependsOn) ? st.dependsOn : [],
          canRunInParallel: typeof st.canRunInParallel === 'boolean' ? st.canRunInParallel : true,
          parallelGroup: st.parallelGroup?.trim() || undefined,
          parallelReason: st.parallelReason?.trim() || undefined,
          expectedArtifacts: Array.isArray(st.expectedArtifacts) ? st.expectedArtifacts : [],
          status: 'planned',
          streamLog: '',
        }));

        run.subtasks.push(...roundTasks);
        this.pushComm(run, {
          round,
          from: `Leader (${leaderRoute.harnessId})`,
          to:
            run.routingMode === 'manual'
              ? 'User (手动路由)'
              : `Reviewer (${reviewerRoute?.harnessId || '-'})`,
          stage: 'review',
          harnessId: leaderRoute.harnessId,
          modelId: leaderRoute.modelId,
          title: `第 ${round} 轮审阅要求继续迭代：新增 ${roundTasks.length} 个子任务`,
          content: `${reviewNotes}\n\n新一轮子任务：\n${roundTasks
            .map((t) => `- [${t.id}] ${t.title}`)
            .join('\n')}`,
        });
        this.saveAndBroadcast(run);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      run.status = signal.aborted ? 'cancelled' : 'failed';
      run.error = message;
      run.finishedAt = new Date().toISOString();
      this.pushComm(run, {
        round: run.currentRound,
        from: 'Orchestrator',
        to: 'User',
        stage: 'error',
        title: signal.aborted ? '任务已中止' : '编排流程异常终止',
        content: message,
      });
      this.saveAndBroadcast(run);
    }
  }

  private async executeSubtasksDag(
    run: OrchestrationRun,
    roundTasks: SubtaskItem[],
    settings: AppSettings,
    signal: AbortSignal
  ): Promise<void> {
    const remaining = new Set(roundTasks.map((t) => t.id));
    const runningPromises = new Map<string, Promise<void>>();
    let runningExclusive = false;
    const allById = new Map(run.subtasks.map((t) => [t.id, t]));

    const isReady = (task: SubtaskItem): boolean => {
      for (const depId of task.dependsOn) {
        const dep = allById.get(depId);
        if (!dep) continue;
        if (dep.status !== 'completed' && dep.status !== 'failed' && dep.status !== 'skipped') {
          return false;
        }
      }
      return true;
    };

    while (remaining.size > 0 || runningPromises.size > 0) {
      if (signal.aborted) throw new Error('任务已被用户中止');

      const readyTasks: SubtaskItem[] = [];
      for (const id of remaining) {
        const task = allById.get(id)!;
        if (isReady(task)) {
          readyTasks.push(task);
        }
      }

      // Break circular dependency deadlocks cleanly if any occur
      if (readyTasks.length === 0 && runningPromises.size === 0 && remaining.size > 0) {
        const firstId = remaining.values().next().value as string;
        readyTasks.push(allById.get(firstId)!);
      }

      const toLaunch: SubtaskItem[] = [];
      if (!runningExclusive && readyTasks.length > 0) {
        const parallelReady = readyTasks.filter((t) => t.canRunInParallel !== false);
        const serialReady = readyTasks.filter((t) => t.canRunInParallel === false);

        if (parallelReady.length > 0) {
          const slots = Math.max(0, run.maxConcurrency - runningPromises.size);
          toLaunch.push(...parallelReady.slice(0, slots));
        } else if (serialReady.length > 0 && runningPromises.size === 0) {
          // Exclusive/serial tasks only run when no other subtask is active
          toLaunch.push(serialReady[0]);
          runningExclusive = true;
        }
      }

      if (toLaunch.length > 1) {
        this.pushComm(run, {
          round: toLaunch[0].round,
          from: 'Router (并行调度器)',
          to: toLaunch.map((t) => `${t.id}:${t.assignedRoleName || 'Worker'}`).join(' + '),
          stage: 'route',
          title: `同时并行启动 ${toLaunch.length} 个子任务（Leader 判定可并行）`,
          content: toLaunch
            .map(
              (t) =>
                `- [${t.id}] ${t.title} → ${t.assignedRoleName} (${t.harnessId}/${t.modelId})${
                  t.parallelReason ? ` | 原因：${t.parallelReason}` : ''
                }`
            )
            .join('\n'),
        });
        this.saveAndBroadcast(run);
      }

      for (const subtask of toLaunch) {
        remaining.delete(subtask.id);
        const p = this.executeSingleSubtask(run, subtask, settings, signal).finally(() => {
          runningPromises.delete(subtask.id);
          if (subtask.canRunInParallel === false) {
            runningExclusive = false;
          }
        });
        runningPromises.set(subtask.id, p);
      }

      if (runningPromises.size > 0) {
        await Promise.race(runningPromises.values());
      }
    }
  }

  private async executeSingleSubtask(
    run: OrchestrationRun,
    subtask: SubtaskItem,
    settings: AppSettings,
    signal: AbortSignal
  ): Promise<void> {
    const role =
      settings.roles.find((r) => r.id === subtask.assignedRoleId) ??
      settings.roles.find((r) => r.kind === 'worker')!;
    const route = this.requireRoute(role, settings);

    const beforeArtifacts = new Set(this.scanArtifacts(run.artifactDir));
    const upstreamOutputs = subtask.dependsOn
      .map((depId) => run.subtasks.find((t) => t.id === depId))
      .filter((t): t is SubtaskItem => Boolean(t && t.output))
      .map((t) => ({
        id: t.id,
        title: t.title,
        roleName: t.assignedRoleName || 'Worker',
        output: t.output || '',
      }));

    const existingArtifacts = Array.from(beforeArtifacts);
    const imagePaths = role.needsVisualInput
      ? existingArtifacts.filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      : undefined;

    subtask.status = 'running';
    subtask.startedAt = new Date().toISOString();
    this.pushComm(run, {
      round: subtask.round,
      from: 'Router',
      to: `${role.name} (${route.harnessId} / ${route.modelId})`,
      stage: 'route',
      subtaskId: subtask.id,
      harnessId: route.harnessId,
      modelId: route.modelId,
      title: `派发 [${subtask.id}] ${subtask.title}`,
      content: `工位：${route.harnessId} | 模型：${route.modelId} | 协议：${route.transportMode.toUpperCase()}`,
    });
    this.saveAndBroadcast(run);

    const workerPrompt = buildWorkerExecutionPrompt({
      goal: run.goal,
      role,
      subtask,
      workspaceDir: run.workspaceDir,
      artifactDir: run.artifactDir,
      upstreamOutputs,
      existingArtifacts,
    });

    try {
      const res = await this.invokeRole({
        role,
        route,
        settings,
        prompt: workerPrompt,
        workspaceDir: run.workspaceDir,
        permissionMode: run.permissionMode,
        imagePaths,
        signal,
        onStream: (chunk) => {
          subtask.streamLog += chunk;
          this.emitEvent({
            type: 'subtask-stream',
            runId: run.id,
            subtaskId: subtask.id,
            chunk,
          });
        },
      });

      const afterArtifacts = this.scanArtifacts(run.artifactDir);
      const produced = afterArtifacts.filter((f) => !beforeArtifacts.has(f));

      subtask.status = 'completed';
      subtask.finishedAt = new Date().toISOString();
      subtask.durationMs = res.durationMs;
      subtask.output = res.text || '(执行完成，无文本输出)';
      subtask.summary = subtask.output.slice(0, 280);
      subtask.artifactsProduced = produced;

      this.pushComm(run, {
        round: subtask.round,
        from: `${role.name} (${route.harnessId} / ${route.modelId})`,
        to: 'Leader',
        stage: 'execute',
        subtaskId: subtask.id,
        harnessId: route.harnessId,
        modelId: route.modelId,
        title: `完成 [${subtask.id}] ${subtask.title} (${(res.durationMs / 1000).toFixed(1)}s)`,
        content:
          subtask.output.slice(0, 1200) +
          (produced.length > 0 ? `\n\n新增产物文件：\n${produced.join('\n')}` : ''),
      });
      this.saveAndBroadcast(run);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      subtask.status = 'failed';
      subtask.finishedAt = new Date().toISOString();
      subtask.error = errMsg;

      this.pushComm(run, {
        round: subtask.round,
        from: `${role.name} (${route.harnessId})`,
        to: 'Leader',
        stage: 'error',
        subtaskId: subtask.id,
        harnessId: route.harnessId,
        modelId: route.modelId,
        title: `执行失败 [${subtask.id}] ${subtask.title}`,
        content: errMsg,
      });
      this.saveAndBroadcast(run);
    }
  }

  private invokeRole(params: {
    role: TaskRole;
    route: RoleRouteConfig;
    settings: AppSettings;
    prompt: string;
    workspaceDir: string;
    permissionMode: OrchestrationRun['permissionMode'];
    imagePaths?: string[];
    signal: AbortSignal;
    onStream?: (chunk: string, channel: 'text' | 'thought' | 'tool' | 'stderr') => void;
  }) {
    return this.registry.execute(params.route.harnessId, {
      prompt: params.prompt,
      systemPrompt: params.role.systemPrompt,
      modelId: params.route.modelId,
      transportMode: params.route.transportMode,
      effort: params.route.effort,
      workspaceDir: params.workspaceDir,
      permissionMode: params.permissionMode,
      imagePaths: params.imagePaths,
      timeoutMs: (params.route.timeoutSec || 300) * 1000,
      customExecutablePath: params.settings.customExecutablePaths[params.route.harnessId],
      signal: params.signal,
      onStream: params.onStream,
    });
  }

  private requireRoute(role: TaskRole, settings: AppSettings): RoleRouteConfig {
    const route = settings.routes[role.id];
    if (!route) {
      throw new Error(`角色「${role.name}」尚未配置路由 Agent 与模型，请前往「角色与路由」页面配置`);
    }
    return route;
  }

  private scanArtifacts(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    const walk = (cur: string) => {
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, entry.name);
        if (entry.isDirectory()) walk(full);
        else results.push(full);
      }
    };
    walk(dir);
    return results;
  }

  private synthesizeFallbackReport(run: OrchestrationRun, reviewNotes: string): string {
    const parts = [
      `# 任务交付汇总`,
      `**目标**：${run.goal}`,
      `## Leader 审阅意见`,
      reviewNotes,
      `## 各子任务执行结果`,
      ...run.subtasks.map(
        (t) =>
          `### [${t.id}] ${t.title}（${t.assignedRoleName || '-'} @ ${t.harnessId || '-'}/${
            t.modelId || '-'
          }）\n${t.output || t.error || ''}`
      ),
    ];
    return parts.join('\n\n');
  }

  private pushComm(
    run: OrchestrationRun,
    input: Omit<CommMessage, 'id' | 'timestamp'>
  ): void {
    const msg: CommMessage = {
      ...input,
      id: `msg-${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
    };
    run.messages.push(msg);
    this.emitEvent({
      type: 'comm-message',
      runId: run.id,
      message: msg,
    });
  }

  private saveAndBroadcast(run: OrchestrationRun): void {
    run.updatedAt = new Date().toISOString();
    this.store.saveRun(run);
    this.broadcastRun(run);
  }

  private broadcastRun(run: OrchestrationRun): void {
    this.emitEvent({
      type: 'run-updated',
      runId: run.id,
      run,
    });
  }
}
