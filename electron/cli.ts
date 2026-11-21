#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { HarnessRegistry } from './adapters/registry';
import { OrchestrationEngine } from './orchestrator/engine';
import { ConfigStore } from './storage/configStore';
import { buildDefaultRoutes } from './storage/defaults';
import { resolveSharedUserDataDir } from './storage/paths';
import {
  AppSettings,
  DetectedHarness,
  HarnessId,
  ManualRouteAssignment,
  OrchestrationRun,
  PermissionMode,
  RoleRouteConfig,
  RoutingMode,
  SubtaskItem,
  TaskRole,
  TransportMode,
} from './types/domain';

const CLI_VERSION = '1.0.0';
const VALID_HARNESSES: HarnessId[] = [
  'antigravity',
  'claude',
  'codex',
  'deepseek',
  'opencode',
  'zcode',
];

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  const repeatable = new Set(['bind', 'image', 'assign']);
  const booleanFlags = new Set([
    'help',
    'h',
    'version',
    'v',
    'json',
    'auto-route',
    'force',
    'stream',
    'quiet',
    'q',
    'include-stream',
  ]);

  const setFlag = (key: string, val: string | boolean) => {
    if (repeatable.has(key)) {
      const existing = Array.isArray(flags[key]) ? (flags[key] as string[]) : [];
      existing.push(String(val));
      flags[key] = existing;
    } else {
      flags[key] = val;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eqIdx = token.indexOf('=');
      if (eqIdx > 2) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        setFlag(key, val);
      } else {
        const key = token.slice(2);
        if (booleanFlags.has(key)) {
          setFlag(key, true);
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          setFlag(key, argv[++i]);
        } else {
          setFlag(key, true);
        }
      }
    } else if (token.startsWith('-') && token.length === 2) {
      const short = token.slice(1);
      const map: Record<string, string> = {
        h: 'help',
        v: 'version',
        C: 'cwd',
        m: 'model',
        r: 'role',
        q: 'quiet',
        o: 'output-report',
      };
      const key = map[short] || short;
      if (booleanFlags.has(short) || booleanFlags.has(key)) {
        setFlag(key, true);
      } else if (i + 1 < argv.length) {
        setFlag(key, argv[++i]);
      } else {
        setFlag(key, true);
      }
    } else {
      positionals.push(token);
    }
  }

  return { positionals, flags };
}

function getStrFlag(flags: ParsedArgs['flags'], key: string): string | undefined {
  const v = flags[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[v.length - 1];
  return undefined;
}

function getArrFlag(flags: ParsedArgs['flags'], key: string): string[] {
  const v = flags[key];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [v];
  return [];
}

function hasFlag(flags: ParsedArgs['flags'], key: string): boolean {
  return Boolean(flags[key]);
}

function readStdinAll(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

function printHelp(): void {
  const text = `Agent_Team CLI v${CLI_VERSION} — 跨原生工位多 AI 协作编排命令行工具
与桌面端 Agent_Team.exe 100% 共享角色定义、模型路由表与历史运行记录。
数据目录：${resolveSharedUserDataDir()}

用法:
  agent-team <command> [options]

核心命令:
  detect [--json]
      自动探测本机所有原生工位 (Antigravity/Claude/Codex/DeepSeek/OpenCode/ZCode) 与模型列表

  roles [--json]
      查看当前所有任务角色及其绑定的原生工位与模型

  route set <roleId> --harness <h> --model <m> [--transport acp|headless] [--effort <e>] [--idle-timeout <sec>]
      为指定角色绑定原生工位与模型（持久化，与桌面端同步）
  route clear <roleId>
      清空指定角色的路由绑定
  route auto [--force]
      按本机已就绪的 Agent 自动填充空路由（加 --force 覆盖全部已有绑定）

  ping <harness> [--model <m>] [--transport acp|headless] [--cwd <dir>] [--json]
      对指定原生工位执行真实单点连通测试

  run <goal | -> [options]
      启动完整多 Agent 协同编排（Leader 拆解 → Reviewer/手动路由 → 并行执行 → Leader 审阅迭代）
      参数:
        -C, --cwd <dir>                目标工作区目录（默认当前目录）
        --routing-mode <reviewer|manual> 路由模式（默认读取全局配置，缺省 reviewer）
        --assign <T1=coder,T2=artist>  手动路由非交互预设（可重复，适合在 Agent 会话内直接指定）
        --auto-route                   若某些角色尚未配置路由，本次运行自动临时补全就绪模型
        --leader <harness[:model]>     本次运行临时覆盖 Leader 工位与模型
        --reviewer <harness[:model]>   本次运行临时覆盖 Reviewer 工位与模型
        --bind <role=harness[:model]>  本次运行临时覆盖指定角色路由（可重复）
        --max-rounds <n>               最大迭代轮次（默认 3）
        --max-concurrency <n>          最大并发子任务数（默认 4）
        --permission <mode>            权限模式: safe | workspace-write | full-auto
        --idle-timeout <sec>           实时流闲置超时秒数（默认 300）
        -o, --output-report <file>     将最终汇总报告写入指定文件
        --stream                       向 stderr 输出各子任务实时流日志
        --json                         向 stdout 输出机器可读的 NDJSON 事件与最终结果
        --include-stream               与 --json 联用，同时输出子任务实时流事件
        -q, --quiet                    静默 stderr 过程日志，仅输出最终结果到 stdout

  ask <prompt | -> [options]
      直接向单个角色或指定原生工位委派任务（适合在当前 Agent 会话内快速呼叫另一家工位）
      参数:
        -r, --role <roleId>            按角色路由表调用（如 front-developer / end-developer / artist）
        --harness <h>                  直接指定原生工位（覆盖 --role 的工位）
        -m, --model <modelId>          直接指定模型
        --transport <acp|headless>     指定协议通道
        --effort <level>               思考强度
        --image <file>                 附带图片路径供视觉审阅（可重复）
        -C, --cwd <dir>                工作区目录（默认当前目录）
        --permission <mode>            safe | workspace-write | full-auto（默认 workspace-write）
        --idle-timeout <sec>           实时流闲置超时秒数（默认 300）
        --json                         以 JSON 输出执行结果

  runs [list | show <runId> | delete <runId>] [--json]
      查看或管理历史运行记录（与桌面端共享）

示例:
  agent-team detect
  agent-team route auto
  agent-team run "写一个 Python 爬虫并生成使用文档" --auto-route
  agent-team run "开发深色番茄钟并审美验收" --routing-mode manual --max-rounds 2
  agent-team ask --role end-developer "为 src/api.ts 补全错误处理与单元测试"
  agent-team run "生成工具脚本与产品文案" --auto-route --json
`;
  process.stdout.write(text);
}

function resolveModelIdForHarness(
  rawModel: string,
  harness: DetectedHarness | undefined
): string {
  if (!rawModel) return harness?.models[0]?.id || 'default';
  if (!harness || harness.models.length === 0) return rawModel;

  // 1. Exact ID match
  const exact = harness.models.find((m) => m.id === rawModel);
  if (exact) return exact.id;

  // 2. Normalize Windows PowerShell quote-stripped JSON tuples like [deepseek-official,deepseek-flash]
  //    or friendly shorthand like deepseek-official/deepseek-flash or deepseek-flash
  const lower = rawModel.toLowerCase();
  const normalizedTuple = lower.replace(/^\[|\]$/g, '').replace(/["'\s]/g, '');
  for (const m of harness.models) {
    if (m.name.toLowerCase() === lower) return m.id;
    if (m.id.startsWith('[')) {
      try {
        const pair = JSON.parse(m.id) as string[];
        if (Array.isArray(pair) && pair.length === 2) {
          const [prov, mod] = pair.map((s) => s.toLowerCase());
          if (
            `${prov}/${mod}` === lower ||
            `${prov},${mod}` === normalizedTuple ||
            mod === lower
          ) {
            return m.id;
          }
        }
      } catch {
        // ignore
      }
    }
  }
  return rawModel;
}

function parseHarnessModelSpec(
  spec: string,
  harnesses: DetectedHarness[]
): { harnessId: HarnessId; modelId: string; transportMode: TransportMode } {
  const colonIdx = spec.indexOf(':');
  const rawHarness = (colonIdx >= 0 ? spec.slice(0, colonIdx) : spec).trim() as HarnessId;
  const rawModel = colonIdx >= 0 ? spec.slice(colonIdx + 1).trim() : '';

  if (!VALID_HARNESSES.includes(rawHarness)) {
    throw new Error(`无效的工位名称 "${rawHarness}"，可选：${VALID_HARNESSES.join(', ')}`);
  }

  const h = harnesses.find((item) => item.id === rawHarness);
  const modelId = resolveModelIdForHarness(rawModel, h);
  const transportMode = h?.defaultTransport || 'headless';
  return { harnessId: rawHarness, modelId, transportMode };
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

function parseAssignFlags(assignArgs: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of assignArgs) {
    for (const part of item.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const taskId = trimmed.slice(0, eq).trim();
      const roleId = trimmed.slice(eq + 1).trim();
      if (taskId && roleId) map.set(taskId, roleId);
    }
  }
  return map;
}

async function promptManualRoutesInteractive(
  awaiting: SubtaskItem[],
  workerRoles: TaskRole[],
  settings: AppSettings
): Promise<ManualRouteAssignment[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  const ask = (q: string) =>
    new Promise<string>((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

  process.stderr.write('\n================ 手动路由指派 ================\n');
  process.stderr.write('可选专业角色：\n');
  workerRoles.forEach((r, idx) => {
    const route = settings.routes[r.id];
    const binding = route ? `${route.harnessId} / ${route.modelId}` : '未配置';
    process.stderr.write(`  [${idx + 1}] ${r.id} (${r.name} · ${r.zhLabel}) -> ${binding}\n`);
  });

  const assignments: ManualRouteAssignment[] = [];
  try {
    for (const task of awaiting) {
      const suggestedId = guessInitialRoleId(task, workerRoles);
      const suggestedIdx = Math.max(
        1,
        workerRoles.findIndex((r) => r.id === suggestedId) + 1
      );
      process.stderr.write(
        `\n子任务 [${task.id}] ${task.title} [${
          task.canRunInParallel === false ? '串行独占' : '可并行'
        }]\n  描述: ${task.description}\n`
      );
      const ans = await ask(
        `  请指派角色（输入编号 1-${workerRoles.length} 或 roleId，直接回车默认 [${suggestedIdx}] ${suggestedId}）: `
      );
      let chosenRoleId = suggestedId;
      if (ans) {
        const asNum = Number(ans);
        if (Number.isInteger(asNum) && asNum >= 1 && asNum <= workerRoles.length) {
          chosenRoleId = workerRoles[asNum - 1].id;
        } else {
          const byId = workerRoles.find(
            (r) => r.id.toLowerCase() === ans.toLowerCase() || r.name.toLowerCase() === ans.toLowerCase()
          );
          if (byId) chosenRoleId = byId.id;
        }
      }
      assignments.push({ subtaskId: task.id, roleId: chosenRoleId });
    }
  } finally {
    rl.close();
  }
  return assignments;
}

async function cmdDetect(
  registry: HarnessRegistry,
  store: ConfigStore,
  jsonMode: boolean
): Promise<number> {
  const settings = store.loadSettings();
  const harnesses = await registry.detectAll(settings.customExecutablePaths);
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ harnesses }, null, 2) + '\n');
    return 0;
  }

  process.stdout.write('本机原生 Agent 工位探测结果：\n\n');
  for (const h of harnesses) {
    const statusIcon =
      h.status === 'ready' ? '[就绪]' : h.status === 'missing_cli' ? '[缺CLI]' : '[未装]';
    process.stdout.write(
      `${statusIcon} ${h.name} (${h.id}) | 版本: ${h.version || '-'} | 通道: ${h.supportedTransports.join(',')} | 模型数: ${h.models.length}\n`
    );
    process.stdout.write(`       路径: ${h.executablePath || '-'}\n`);
    process.stdout.write(`       状态: ${h.statusMessage}\n`);
    if (h.models.length > 0) {
      const sample = h.models
        .slice(0, 5)
        .map((m) => m.id)
        .join(', ');
      process.stdout.write(
        `       模型示例: ${sample}${h.models.length > 5 ? ` ... (共 ${h.models.length} 个)` : ''}\n`
      );
    }
    process.stdout.write('\n');
  }
  return 0;
}

async function cmdRoles(store: ConfigStore, jsonMode: boolean): Promise<number> {
  const settings = store.loadSettings();
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({ roles: settings.roles, routes: settings.routes }, null, 2) + '\n'
    );
    return 0;
  }

  process.stdout.write(`角色与模型路由配置（共 ${settings.roles.length} 类）：\n\n`);
  for (const r of settings.roles) {
    const rt = settings.routes[r.id];
    const binding = rt
      ? `${rt.harnessId} | ${rt.modelId} | ${rt.transportMode.toUpperCase()}${
          rt.effort ? ` | effort=${rt.effort}` : ''
        } | idle=${rt.timeoutSec || 300}s`
      : '（未配置）';
    process.stdout.write(`- ${r.id.padEnd(16)} [${r.name} · ${r.zhLabel}] => ${binding}\n`);
  }
  return 0;
}

async function cmdRoute(
  args: ParsedArgs,
  registry: HarnessRegistry,
  store: ConfigStore
): Promise<number> {
  const sub = args.positionals[1];
  const jsonMode = hasFlag(args.flags, 'json');
  const settings = store.loadSettings();

  if (sub === 'auto') {
    const detected = await registry.detectAll(settings.customExecutablePaths);
    const force = hasFlag(args.flags, 'force');
    settings.routes = buildDefaultRoutes(
      settings.roles,
      detected,
      force ? {} : settings.routes
    );
    settings.onboardingCompleted = true;
    store.saveSettings(settings);
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ok: true, routes: settings.routes }, null, 2) + '\n');
    } else {
      process.stdout.write(
        `已自动${force ? '重置并' : ''}填充角色模型路由，共配置 ${Object.keys(settings.routes).length} 个角色。\n`
      );
      await cmdRoles(store, false);
    }
    return 0;
  }

  if (sub === 'clear') {
    const roleId = args.positionals[2];
    if (!roleId) {
      process.stderr.write('错误：请指定要清空的 roleId，例如 agent-team route clear coder\n');
      return 1;
    }
    delete settings.routes[roleId];
    store.saveSettings(settings);
    process.stdout.write(
      jsonMode
        ? JSON.stringify({ ok: true, cleared: roleId }) + '\n'
        : `已清空角色 "${roleId}" 的模型绑定。\n`
    );
    return 0;
  }

  if (sub === 'set') {
    const roleId = args.positionals[2];
    const harnessId = getStrFlag(args.flags, 'harness') as HarnessId | undefined;
    const modelId = getStrFlag(args.flags, 'model');
    if (!roleId || !harnessId) {
      process.stderr.write(
        '错误：用法为 agent-team route set <roleId> --harness <h> --model <m> [--transport acp|headless]\n'
      );
      return 1;
    }
    if (!VALID_HARNESSES.includes(harnessId)) {
      process.stderr.write(`错误：无效工位 "${harnessId}"，可选 ${VALID_HARNESSES.join(', ')}\n`);
      return 1;
    }
    const role = settings.roles.find((r) => r.id === roleId);
    if (!role) {
      process.stderr.write(`错误：未找到角色 "${roleId}"，请先运行 agent-team roles 查看可用角色。\n`);
      return 1;
    }
    const detected = await registry.detectAll(settings.customExecutablePaths);
    const h = detected.find((item) => item.id === harnessId);
    const transport =
      (getStrFlag(args.flags, 'transport') as TransportMode | undefined) ||
      h?.defaultTransport ||
      'headless';
    const effort = getStrFlag(args.flags, 'effort');
    const idleSec = Number(getStrFlag(args.flags, 'idle-timeout') || 300);

    const route: RoleRouteConfig = {
      roleId,
      harnessId,
      modelId: resolveModelIdForHarness(modelId || '', h),
      transportMode: transport,
      effort,
      timeoutSec: Number.isFinite(idleSec) && idleSec > 0 ? idleSec : 300,
    };
    settings.routes[roleId] = route;
    settings.onboardingCompleted = true;
    store.saveSettings(settings);
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ok: true, route }, null, 2) + '\n');
    } else {
      process.stdout.write(
        `已保存路由：${roleId} => ${route.harnessId} / ${route.modelId} (${route.transportMode.toUpperCase()})\n`
      );
    }
    return 0;
  }

  process.stderr.write('用法：agent-team route <set|clear|auto> ...\n');
  return 1;
}

async function cmdPing(
  args: ParsedArgs,
  registry: HarnessRegistry,
  store: ConfigStore
): Promise<number> {
  const harnessId = args.positionals[1] as HarnessId | undefined;
  const jsonMode = hasFlag(args.flags, 'json');
  if (!harnessId || !VALID_HARNESSES.includes(harnessId)) {
    process.stderr.write(
      `错误：请指定有效的工位名，例如 agent-team ping antigravity（可选：${VALID_HARNESSES.join(', ')}）\n`
    );
    return 1;
  }

  const settings = store.loadSettings();
  const detected = await registry.detectAll(settings.customExecutablePaths);
  const h = detected.find((item) => item.id === harnessId);
  const modelId = resolveModelIdForHarness(getStrFlag(args.flags, 'model') || '', h);
  const transport =
    (getStrFlag(args.flags, 'transport') as TransportMode | undefined) ||
    h?.defaultTransport ||
    'headless';
  const cwd = path.resolve(getStrFlag(args.flags, 'cwd') || process.cwd());

  const res = await registry.ping(
    harnessId,
    modelId,
    transport,
    cwd,
    settings.customExecutablePaths[harnessId]
  );

  if (jsonMode) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  } else if (res.ok) {
    process.stdout.write(
      `[OK] ${res.harnessId} (${res.transportMode.toUpperCase()} / ${res.modelId}) 耗时 ${res.latencyMs}ms\n回复: ${res.reply}\n`
    );
  } else {
    process.stderr.write(
      `[FAIL] ${res.harnessId} (${res.transportMode.toUpperCase()} / ${res.modelId}) 耗时 ${res.latencyMs}ms\n错误: ${res.error}\n`
    );
  }
  return res.ok ? 0 : 1;
}

async function cmdAsk(
  args: ParsedArgs,
  registry: HarnessRegistry,
  store: ConfigStore
): Promise<number> {
  const jsonMode = hasFlag(args.flags, 'json');
  const quiet = hasFlag(args.flags, 'quiet');
  let prompt = args.positionals.slice(1).join(' ').trim();
  if (prompt === '-' || (!prompt && !process.stdin.isTTY)) {
    prompt = await readStdinAll();
  }
  if (!prompt) {
    process.stderr.write('错误：请提供任务内容，例如 agent-team ask --role coder "写个脚本"\n');
    return 1;
  }

  const settings = store.loadSettings();
  const roleId = getStrFlag(args.flags, 'role');
  const role = roleId
    ? settings.roles.find(
        (r) => r.id.toLowerCase() === roleId.toLowerCase() || r.name.toLowerCase() === roleId.toLowerCase()
      )
    : undefined;
  if (roleId && !role) {
    process.stderr.write(`错误：未找到角色 "${roleId}"。\n`);
    return 1;
  }

  const savedRoute = role ? settings.routes[role.id] : undefined;
  let harnessId = (getStrFlag(args.flags, 'harness') as HarnessId | undefined) || savedRoute?.harnessId;
  let modelId = getStrFlag(args.flags, 'model') || savedRoute?.modelId;
  let transportMode =
    (getStrFlag(args.flags, 'transport') as TransportMode | undefined) || savedRoute?.transportMode;
  const effort = getStrFlag(args.flags, 'effort') || savedRoute?.effort;

  if (!harnessId || (harnessId === 'deepseek' && modelId && !modelId.startsWith('['))) {
    const detected = await registry.detectAll(settings.customExecutablePaths);
    if (!harnessId) {
      const auto = buildDefaultRoutes(settings.roles, detected, {});
      const fallbackRoute = role ? auto[role.id] : Object.values(auto)[0];
      if (!fallbackRoute) {
        process.stderr.write('错误：未指定 --harness 且本机未探测到可用原生工位。\n');
        return 1;
      }
      harnessId = fallbackRoute.harnessId;
      modelId = modelId || fallbackRoute.modelId;
      transportMode = transportMode || fallbackRoute.transportMode;
    } else {
      const h = detected.find((item) => item.id === harnessId);
      modelId = resolveModelIdForHarness(modelId || '', h);
    }
  }

  const cwd = path.resolve(getStrFlag(args.flags, 'cwd') || process.cwd());
  const permissionMode = (getStrFlag(args.flags, 'permission') ||
    settings.defaultPermissionMode ||
    'workspace-write') as PermissionMode;
  const idleSec = Number(getStrFlag(args.flags, 'idle-timeout') || savedRoute?.timeoutSec || 300);
  const imagePaths = getArrFlag(args.flags, 'image').map((p) => path.resolve(p));

  const controller = new AbortController();
  const onSigInt = () => controller.abort();
  process.on('SIGINT', onSigInt);

  try {
    if (!quiet && !jsonMode) {
      process.stderr.write(
        `[Agent_Team ask] 角色=${role?.name || '-'} | 工位=${harnessId} | 模型=${
          modelId || 'default'
        } | 协议=${(transportMode || 'default').toUpperCase()}\n`
      );
    }

    const res = await registry.execute(harnessId, {
      prompt,
      systemPrompt: role?.systemPrompt,
      modelId: modelId || 'default',
      transportMode,
      effort,
      workspaceDir: cwd,
      permissionMode,
      imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
      timeoutMs: (Number.isFinite(idleSec) && idleSec > 0 ? idleSec : 300) * 1000,
      customExecutablePath: settings.customExecutablePaths[harnessId],
      signal: controller.signal,
      onStream:
        hasFlag(args.flags, 'stream') && !jsonMode
          ? (chunk) => process.stderr.write(chunk)
          : undefined,
    });

    if (jsonMode) {
      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            roleId: role?.id,
            harnessId,
            modelUsed: res.modelUsed,
            transportUsed: res.transportUsed,
            durationMs: res.durationMs,
            text: res.text,
          },
          null,
          2
        ) + '\n'
      );
    } else {
      process.stdout.write(res.text + '\n');
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n');
    } else {
      process.stderr.write(`[Agent_Team ask 失败] ${message}\n`);
    }
    return 1;
  } finally {
    process.off('SIGINT', onSigInt);
  }
}

async function cmdRun(
  args: ParsedArgs,
  registry: HarnessRegistry,
  store: ConfigStore
): Promise<number> {
  const jsonMode = hasFlag(args.flags, 'json');
  const includeStream = hasFlag(args.flags, 'include-stream');
  const showStream = hasFlag(args.flags, 'stream');
  const quiet = hasFlag(args.flags, 'quiet');

  let goal = args.positionals.slice(1).join(' ').trim();
  if (goal === '-' || (!goal && !process.stdin.isTTY)) {
    goal = await readStdinAll();
  }
  if (!goal) {
    process.stderr.write('错误：请提供协作目标，例如 agent-team run "构建一个工具并写文档"\n');
    return 1;
  }

  const savedSettings = store.loadSettings();
  // Clone settings for this run so temporary CLI overrides do not overwrite GUI defaults
  const runSettings: AppSettings = {
    ...savedSettings,
    roles: savedSettings.roles.map((r) => ({ ...r })),
    routes: Object.fromEntries(
      Object.entries(savedSettings.routes).map(([k, v]) => [k, { ...v }])
    ),
  };

  const routingMode = (getStrFlag(args.flags, 'routing-mode') ||
    runSettings.defaultRoutingMode ||
    'reviewer') as RoutingMode;
  const maxRounds = Number(getStrFlag(args.flags, 'max-rounds') || runSettings.defaultMaxRounds || 3);
  const maxConcurrency = Number(
    getStrFlag(args.flags, 'max-concurrency') || runSettings.defaultMaxConcurrency || 4
  );
  const permissionMode = (getStrFlag(args.flags, 'permission') ||
    runSettings.defaultPermissionMode ||
    'workspace-write') as PermissionMode;
  const cwd = path.resolve(getStrFlag(args.flags, 'cwd') || process.cwd());
  const idleTimeoutFlag = getStrFlag(args.flags, 'idle-timeout');
  const outputReportPath = getStrFlag(args.flags, 'output-report');

  const needsDetect =
    hasFlag(args.flags, 'auto-route') ||
    Boolean(getStrFlag(args.flags, 'leader')) ||
    Boolean(getStrFlag(args.flags, 'reviewer')) ||
    getArrFlag(args.flags, 'bind').length > 0;

  let detected: DetectedHarness[] = [];
  if (needsDetect) {
    detected = await registry.detectAll(runSettings.customExecutablePaths);
  }

  if (hasFlag(args.flags, 'auto-route')) {
    runSettings.routes = buildDefaultRoutes(runSettings.roles, detected, runSettings.routes);
  }

  const leaderSpec = getStrFlag(args.flags, 'leader');
  if (leaderSpec) {
    const parsed = parseHarnessModelSpec(leaderSpec, detected);
    runSettings.routes.leader = {
      roleId: 'leader',
      ...parsed,
      timeoutSec: 300,
    };
  }

  const reviewerSpec = getStrFlag(args.flags, 'reviewer');
  if (reviewerSpec) {
    const parsed = parseHarnessModelSpec(reviewerSpec, detected);
    runSettings.routes.reviewer = {
      roleId: 'reviewer',
      ...parsed,
      timeoutSec: 300,
    };
  }

  for (const bindExpr of getArrFlag(args.flags, 'bind')) {
    const eq = bindExpr.indexOf('=');
    if (eq <= 0) {
      throw new Error(`--bind 格式应为 roleId=harness[:model]，收到 "${bindExpr}"`);
    }
    const rId = bindExpr.slice(0, eq).trim();
    const spec = bindExpr.slice(eq + 1).trim();
    const parsed = parseHarnessModelSpec(spec, detected);
    runSettings.routes[rId] = {
      roleId: rId,
      ...parsed,
      timeoutSec: 300,
    };
  }

  if (idleTimeoutFlag) {
    const sec = Number(idleTimeoutFlag);
    if (Number.isFinite(sec) && sec > 0) {
      for (const route of Object.values(runSettings.routes)) {
        route.timeoutSec = sec;
      }
    }
  }

  // Validate required core routes before launching
  if (!runSettings.routes.leader) {
    const errMsg =
      '尚未配置 Leader 模型路由。请先运行 `agent-team route auto` / `agent-team route set leader ...`，或在本次命令附加 `--auto-route` / `--leader antigravity:gemini-4-neon-high`。';
    if (jsonMode) process.stdout.write(JSON.stringify({ event: 'error', error: errMsg }) + '\n');
    else process.stderr.write(`错误：${errMsg}\n`);
    return 1;
  }
  if (routingMode === 'reviewer' && !runSettings.routes.reviewer) {
    const errMsg =
      '当前为 Reviewer 自动路由模式，但尚未配置 Reviewer 模型。请附加 `--auto-route` / `--reviewer ...` 或切换 `--routing-mode manual`。';
    if (jsonMode) process.stdout.write(JSON.stringify({ event: 'error', error: errMsg }) + '\n');
    else process.stderr.write(`错误：${errMsg}\n`);
    return 1;
  }

  const presetAssignMap = parseAssignFlags(getArrFlag(args.flags, 'assign'));
  let manualPromptBusy = false;
  let lastStatus = '';

  let resolveDone!: (run: OrchestrationRun) => void;
  const donePromise = new Promise<OrchestrationRun>((res) => (resolveDone = res));

  const engine = new OrchestrationEngine(registry, store, (ev) => {
    if (ev.type === 'comm-message' && ev.message) {
      if (jsonMode) {
        process.stdout.write(JSON.stringify({ event: 'comm', message: ev.message }) + '\n');
      } else if (!quiet) {
        const m = ev.message;
        process.stderr.write(
          `[${m.stage.toUpperCase()} R${m.round}] ${m.from} -> ${m.to} | ${m.title}\n`
        );
      }
    } else if (ev.type === 'subtask-stream' && ev.subtaskId && ev.chunk) {
      if (jsonMode && includeStream) {
        process.stdout.write(
          JSON.stringify({ event: 'stream', subtaskId: ev.subtaskId, chunk: ev.chunk }) + '\n'
        );
      } else if (showStream && !jsonMode && !quiet) {
        process.stderr.write(ev.chunk);
      }
    } else if (ev.type === 'run-updated' && ev.run) {
      const r = ev.run;
      if (r.status !== lastStatus) {
        lastStatus = r.status;
        if (jsonMode) {
          process.stdout.write(
            JSON.stringify({ event: 'status', runId: r.id, status: r.status, round: r.currentRound }) +
              '\n'
          );
        }
      }

      if (r.status === 'awaiting_manual_routing' && !manualPromptBusy) {
        manualPromptBusy = true;
        const awaiting = r.subtasks.filter((t) => t.status === 'awaiting_route');
        const workerRoles = runSettings.roles.filter((role) => role.kind === 'worker');

        void (async () => {
          try {
            let assignments: ManualRouteAssignment[];
            if (presetAssignMap.size > 0 || !process.stdin.isTTY || jsonMode) {
              assignments = awaiting.map((task) => ({
                subtaskId: task.id,
                roleId: presetAssignMap.get(task.id) || guessInitialRoleId(task, workerRoles),
              }));
              if (!jsonMode && !quiet) {
                process.stderr.write(
                  `[MANUAL ROUTE] 应用路由指派：${assignments
                    .map((a) => `${a.subtaskId}=${a.roleId}`)
                    .join(', ')}\n`
                );
              }
            } else {
              assignments = await promptManualRoutesInteractive(
                awaiting,
                workerRoles,
                runSettings
              );
            }
            engine.submitManualRoutes({ runId: r.id, assignments });
          } catch (err) {
            process.stderr.write(`手动路由提交异常：${String(err)}\n`);
            engine.cancelActiveRun();
          } finally {
            manualPromptBusy = false;
          }
        })();
      }

      if (['completed', 'failed', 'cancelled'].includes(r.status)) {
        resolveDone(r);
      }
    }
  });

  const onSigInt = () => {
    if (!jsonMode) process.stderr.write('\n收到中断信号，正在中止所有子工位进程...\n');
    engine.cancelActiveRun();
  };
  process.on('SIGINT', onSigInt);

  try {
    await engine.startRun(
      {
        goal,
        workspaceDir: cwd,
        maxRounds: Number.isFinite(maxRounds) ? maxRounds : 3,
        maxConcurrency: Number.isFinite(maxConcurrency) ? maxConcurrency : 4,
        permissionMode,
        routingMode,
      },
      runSettings
    );

    const finalRun = await donePromise;

    if (outputReportPath && finalRun.finalReport) {
      const absOut = path.resolve(outputReportPath);
      fs.mkdirSync(path.dirname(absOut), { recursive: true });
      fs.writeFileSync(absOut, finalRun.finalReport, 'utf8');
    }

    if (jsonMode) {
      process.stdout.write(JSON.stringify({ event: 'result', run: finalRun }) + '\n');
    } else if (finalRun.status === 'completed') {
      if (!quiet) {
        process.stderr.write(
          `\n[完成] Run ID: ${finalRun.id} | 共享产物目录: ${finalRun.artifactDir}\n\n`
        );
      }
      process.stdout.write((finalRun.finalReport || '(任务完成)') + '\n');
    } else {
      process.stderr.write(
        `\n[终止] 状态=${finalRun.status} | 原因=${finalRun.error || '未知错误'}\n`
      );
    }

    return finalRun.status === 'completed' ? 0 : 1;
  } finally {
    process.off('SIGINT', onSigInt);
  }
}

async function cmdRuns(args: ParsedArgs, store: ConfigStore): Promise<number> {
  const sub = args.positionals[1] || 'list';
  const jsonMode = hasFlag(args.flags, 'json');

  if (sub === 'list') {
    const runs = store.listRuns();
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ runs }, null, 2) + '\n');
      return 0;
    }
    if (runs.length === 0) {
      process.stdout.write('暂无历史运行记录。\n');
      return 0;
    }
    for (const r of runs.slice(0, 20)) {
      process.stdout.write(
        `${r.id} | ${r.status.padEnd(10)} | ${r.routingMode || 'reviewer'} | 子任务=${
          r.subtasks.length
        } | ${r.goal.slice(0, 60)}\n`
      );
    }
    return 0;
  }

  if (sub === 'show') {
    const runId = args.positionals[2];
    if (!runId) {
      process.stderr.write('错误：请指定 runId，例如 agent-team runs show <runId>\n');
      return 1;
    }
    const run = store.loadRun(runId);
    if (!run) {
      process.stderr.write(`错误：未找到运行记录 "${runId}"。\n`);
      return 1;
    }
    if (jsonMode) {
      process.stdout.write(JSON.stringify(run, null, 2) + '\n');
    } else {
      process.stdout.write(`Run: ${run.id} (${run.status})\n目标: ${run.goal}\n\n`);
      process.stdout.write((run.finalReport || run.error || '(无汇总报告)') + '\n');
    }
    return 0;
  }

  if (sub === 'delete') {
    const runId = args.positionals[2];
    if (!runId) {
      process.stderr.write('错误：请指定 runId。\n');
      return 1;
    }
    const ok = store.deleteRun(runId);
    process.stdout.write(
      jsonMode
        ? JSON.stringify({ ok, deleted: runId }) + '\n'
        : ok
          ? `已删除运行记录 ${runId}。\n`
          : `未找到运行记录 ${runId}。\n`
    );
    return ok ? 0 : 1;
  }

  process.stderr.write('用法：agent-team runs <list|show|delete>\n');
  return 1;
}

async function main(): Promise<void> {
  const args = parseArgv(process.argv.slice(2));
  const cmd = args.positionals[0];

  if (hasFlag(args.flags, 'version')) {
    process.stdout.write(`agent-team ${CLI_VERSION}\n`);
    return;
  }

  if (!cmd || cmd === 'help' || hasFlag(args.flags, 'help')) {
    printHelp();
    return;
  }

  const store = new ConfigStore(resolveSharedUserDataDir());
  const registry = new HarnessRegistry();

  let exitCode = 0;
  try {
    switch (cmd) {
      case 'detect':
        exitCode = await cmdDetect(registry, store, hasFlag(args.flags, 'json'));
        break;
      case 'roles':
        exitCode = await cmdRoles(store, hasFlag(args.flags, 'json'));
        break;
      case 'route':
        exitCode = await cmdRoute(args, registry, store);
        break;
      case 'ping':
        exitCode = await cmdPing(args, registry, store);
        break;
      case 'ask':
        exitCode = await cmdAsk(args, registry, store);
        break;
      case 'run':
        exitCode = await cmdRun(args, registry, store);
        break;
      case 'runs':
        exitCode = await cmdRuns(args, store);
        break;
      default:
        process.stderr.write(`未知命令: "${cmd}"。运行 agent-team --help 查看帮助。\n`);
        exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (hasFlag(args.flags, 'json')) {
      process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n');
    } else {
      process.stderr.write(`错误：${message}\n`);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}

void main();
