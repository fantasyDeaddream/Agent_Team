# Agent_Team

> 跨原生工位（Native Harness）的多 AI Agent 协同编排桌面工作台（Electron + TypeScript + React）

## 核心理念

与传统脱离原生工位、通过 HTTP API 或反代模拟多角色的框架不同，**Agent_Team** 让每个 AI 始终留在自己最强的官方专属工位（Harness）中运行，通过 **ACP（Agent Client Protocol）+ 原生 Headless JSON-Stream** 双轨协议实现跨 Agent 编排与通信：

- **零反代风险**：所有调用均为本机官方 CLI / ACP 子进程直连，完整复用各家原生登录态、工具链、沙箱与提示词优势。
- **核心协作闭环（支持两种路由模式切换）**：
  1. **Leader**：拆解用户目标为带依赖关系的子任务；在子任务完成后审阅汇总，并决定最终交付或发起下一轮迭代（含按需拆分审美子任务交给 Artist）。
  2. **任务路由（可选 Reviewer 自动路由 / 用户手动路由）**：
     - **Reviewer 自动路由**：由 Reviewer 仅负责事前定性分类，审阅每个子任务块并自动判定归属角色；
     - **用户手动路由**：Leader 完成拆分（含后续迭代新拆出的子任务）后暂停，由用户在工作台界面亲自为每个子任务选择目标角色并确认派发。
  3. **Router**：根据「任务类型 → 原生工位 + 模型 + 协议模式」路由表分发任务，并实时将输出流汇总至通信总线。

## 默认内置 9 类角色（均支持自定义增删改）

| 角色 | 定位 | 说明 |
| :--- | :--- | :--- |
| `Leader` | 总控统筹者 | 拆分任务、审阅结果、汇总合并与迭代决策 |
| `Reviewer` | 事前判类审阅者 | 仅负责事前定性分类，判断子块属于哪种任务类型 |
| `Coder` | 通用代码开发者 | 编写、调试与重构通用代码、算法和脚本 |
| `Front-Developer` | 前端开发者 | 前端 UI/交互/样式与工程构建 |
| `End-Developer` | 后端开发者 | 服务端 API、数据库、业务逻辑与架构 |
| `Drawer` | 图片绘制者 | 图片生成、插画/图标/矢量图创作并输出至共享产物目录 |
| `3D-Developer` | 3D 建模者 | Three.js / WebGL / Blender 脚本 / OpenSCAD 建模与预览 |
| `Artist` | 审美审核者 | 审阅 UI 截图、生成图片或 3D 渲染预览的美观度并裁定优化点 |
| `Copywriter` | 文案编写者 | 技术文档、产品文案、说明与创意文本创作 |

## 支持的本机原生工位

- **Antigravity (`agy`)**：原生 `agy acp` + `agy --output-format stream-json -p` + `agy models` 实时探测
- **Claude Code (`claude`)**：原生 `claude -p --output-format stream-json` + 非敏感模型槽位探测
- **OpenAI Codex (`codex`)**：原生 `codex exec --json` + `~/.codex/models_cache*.json` 探测
- **DeepSeek Harness (`dsh`)**：原生 `dsh --profile acp` + `dsh --profile headless --json` + ACP 实时模型探测
- **OpenCode (`opencode`)**：支持 `opencode run --format json`、`opencode acp` 与 `opencode models` 自动探测
- **ZCode (`zcode`)**：支持 `zcode -p --json` 与 `~/.zcode/v2/` 非敏感模型配置探测

## 关键工程特性

- **实时输出流闲置超时（300,000ms）**：超时判定基于实时输出流连续静默时长（超过 300s 无任何输出且未汇报完成才超时），只要 Agent 持续输出思考、工具事件或正文便会自动续期，不再因长任务总耗时误杀。
- **首次启动新手引导**：首次运行默认清空角色模型路由，自动进入「1. 本机 Agent 探测核查 → 2. 手动配置各任务类型启用模型」引导流；工作台亦提供「启动新手引导」按钮随时重走引导。
- **Leader 智能并发判定与真正并行执行**：Leader 在拆解任务时显式评估各子任务的可并行性（`canRunInParallel`、`parallelGroup`、`parallelReason`），可并行的多个子任务在后续调度阶段将真正同时并行执行，串行独占任务则自动隔离防冲突。

## Release 安装包下载与安装

在 GitHub Releases 页面提供两个独立的 Windows x64 安装包（均为当前用户级安装，无需管理员权限，安装时自动将 `agent-team` 写入用户 `PATH` 环境变量，卸载时自动清理）：

1. **GUI & CLI 全功能版**（`Agent_Team-Setup-v1.0.0-GUI-CLI.exe`）：
   - 同时安装桌面端图形工作台 `Agent_Team.exe`（创建桌面与开始菜单快捷方式）与独立命令行 `agent-team.exe`（免 Node.js 环境），并自动把 `agent-team` 写入用户 `PATH`；两者 100% 共享角色配置、模型路由与运行历史。
2. **纯粹 CLI 版**（`Agent_Team-CLI-Setup-v1.0.0.exe`）：
   - 仅安装轻量级独立命令行 `agent-team.exe`（免 Node.js 环境、无 Electron 桌面壳），自动写入用户 `PATH`，安装后重开终端或任意 AI Agent 会话（Claude Code / Codex / Antigravity / DeepSeek Harness）即可直接执行 `agent-team`。

## CLI 命令行模式（在任意 Agent 会话内直接调起）

提供与桌面端 `Agent_Team.exe` **100% 共享角色定义、模型路由与历史记录**的命令行工具（可全局运行 `agent-team`，或直接运行独立免 Node 环境的 `release/agent-team-cli.exe`）：

```bash
# 1. 自动探测本机六家原生工位与模型清单（支持 --json 供其他 Agent 解析）
agent-team detect
agent-team detect --json

# 2. 查看/配置角色模型路由（与桌面端实时同步）
agent-team roles
agent-team route auto
agent-team route set leader --harness antigravity --model gemini-4-neon-xhigh

# 3. 完整多 Agent 协同编排（stdout 输出最终报告，stderr 输出实时进度；加 --json 输出 NDJSON）
agent-team run "开发一个带单测的 Python 工具脚本并撰写产品介绍文案" --cwd . --auto-route
agent-team run "构建页面并审美验收" --routing-mode manual --assign T1=front-developer,T2=artist --json

# 4. 在当前 Agent 会话内直接向某个专业角色/原生工位委派单个子任务
agent-team ask --role end-developer "帮我审查 src/api.ts 的并发安全问题"
agent-team ask --harness codex --model gpt-6.2-sol "为 utils.ts 补全单元测试"

# 5. 查看共享历史记录与单点连通测试
agent-team ping deepseek
agent-team runs list
```

## 开发与打包命令

```bash
# 类型检查
npm run typecheck

# 构建 Electron 主进程与 React 前端
npm run build

# 启动桌面端
npm start

# 打包 GUI & CLI 全功能安装包（release/Agent_Team-Setup-v1.0.0-GUI-CLI.exe）
npm run dist:win

# 打包纯粹 CLI 安装包（release/Agent_Team-CLI-Setup-v1.0.0.exe）
npm run dist:cli-installer

# 一键构建双安装包（GUI&CLI + 纯 CLI）
npm run dist:all
```
