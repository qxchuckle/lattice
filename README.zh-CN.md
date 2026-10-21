<p align="center">
  <img src="./docs/assets/lattice-logo.png" width="88" alt="Lattice" />
</p>

<h1 align="center">Lattice</h1>

<p align="center">
  <b>仓库之上，会话之外。</b><br>
  本地优先的研发记忆与工作流层 —— 规范、任务、决策与经验，在 <code>~/.lattice</code> 沉淀一次，跨项目、跨会话、跨 Agent 复用。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@qcqx/lattice-cli"><img alt="npm cli" src="https://img.shields.io/npm/v/@qcqx/lattice-cli?label=cli"></a>
  <a href="https://www.npmjs.com/package/@qcqx/lattice-core"><img alt="npm core" src="https://img.shields.io/npm/v/@qcqx/lattice-core?label=core"></a>
  <a href="https://www.npmjs.com/package/@qcqx/lattice-web"><img alt="npm web" src="https://img.shields.io/npm/v/@qcqx/lattice-web?label=web"></a>
  <a href="https://www.npmjs.com/package/@qcqx/lattice-cli"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@qcqx/lattice-cli"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/github/license/qxchuckle/lattice"></a>
  <a href="https://github.com/qxchuckle/lattice/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/qxchuckle/lattice"></a>
  <a href="https://open-vsx.org/extension/qcqx/lattice-context"><img alt="Open VSX" src="https://img.shields.io/open-vsx/v/qcqx/lattice-context?label=Open%20VSX"></a>
    <a href="https://marketplace.visualstudio.com/items?itemName=qcqx.lattice-context"><img alt="VS Marketplace" src="https://img.shields.io/visual-studio-marketplace/v/qcqx.lattice-context?label=VS%20Marketplace"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <b>简体中文</b><br>
  <a href="https://qxchuckle.github.io/lattice/zh-cn/">官网</a> ·
  <a href="https://qxchuckle.github.io/lattice/demo/?lang=zh">在线 Demo</a> ·
  <a href="https://qxchuckle.github.io/lattice/zh-cn/docs/">文档</a>
</p>

Lattice 是一个本地优先的 **研发记忆与工作流层**。它把散落在多个仓库、会话和 Agent 之间的规范、任务、决策、项目关系与经验，沉淀为结构化、可检索、可版本化的研发资产，再通过 CLI、编辑器扩展与 Web 工作台提供给人和 AI。

## 为什么需要 Lattice

- **进入陌生仓库？** 先拿到项目约定、活跃任务与关联关系，再动手写第一行代码。
- **多项目并行？** 规范、任务、决策与经验放在同一处，不再每个仓库维护一份。
- **做过类似需求？** 搜索历史规范、决策与经验，而不是每次从零开始。
- **在用 AI Agent？** 注入的是工作流，而不只是上下文：起手读记忆、实施留记录、归档做沉淀。

## 界面预览

| Web 工作台 | 任务详情 |
|---|---|
| ![工作台总览](docs/assets/screenshots/workbench-home.jpg) | ![任务详情](docs/assets/screenshots/workbench-task.jpg) |
| ![项目图谱](docs/assets/screenshots/workbench-project.jpg) | ![Spec 详情](docs/assets/screenshots/workbench-spec.jpg) |

*Web 工作台 —— 同样内嵌于 VS Code 扩展（命令「Lattice: 打开 Web 工作台」）。*

## 核心能力

| 能力 | 说明 |
|---|---|
| **Spec 分层规范** | 全局 / 用户 / 项目三级 spec，高优先级自动覆盖低优先级（含祖先项目级联） |
| **任务与 Checkpoint** | 完整生命周期（规划 → 进行中 → 完成 → 归档）+ 11 类 checkpoint 记录上下文、决策、转向与里程碑 |
| **项目注册与关系** | 基于指纹的项目身份、monorepo 嵌套、跨仓库关系、别名感知虚拟合并 |
| **RAG 搜索** | 本地嵌入式向量 + 全文索引，覆盖 spec / 任务 / checkpoint / 文档 |
| **记忆聚合** | `ltc context` 一键拿到当前仓库的规范、活跃任务、关联项目与相关记忆 |
| **双轨同步** | `origin` 单仓多机全量同步；域（经验包）多用户基于 Git 远端协作，读时合并 |
| **模板系统** | 内置 + 远程模板仓库，快速初始化项目规范 |
| **工作流注入** | `ltc init` 向 Cursor / Claude Code / Qoder / Trae 等客户端注入 Lattice 工作流 —— 起手读记忆、实施留记录、归档做沉淀 |
| **VS Code 扩展** | 原生侧栏视图、图谱工作台 Webview、Problems 规范体检、多用户支持 —— core **进程内**直连 |
| **Web 工作台** | `ltc web`（或扩展内置工作台）—— 任务 / 项目 / 规范浏览器与 Cytoscape 知识图谱 |

## 三种使用入口

| | CLI | VS Code 扩展 | Web 工作台 |
|---|---|---|---|
| **适合** | 自动化、脚本、AI Agent | 日常浏览与编辑 | 可视化探索 |
| **安装** | `npm i -g @qcqx/lattice-cli` | [Open VSX](https://open-vsx.org/extension/qcqx/lattice-context) · [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=qcqx.lattice-context) | `npm i -g @qcqx/lattice-web` |
| **使用** | `ltc init` · `ltc scan` · `ltc context` | 活动栏 → Lattice（首次运行：**快速开始**，无需 CLI） | `ltc web` → 浏览器，或扩展内置 Webview |
| **文档** | [packages/cli](./packages/cli/README.zh-CN.md) | [packages/vscode](./packages/vscode/README.zh-CN.md) | [packages/web](./packages/web/README.zh-CN.md) |

## 包一览

| 包 | 角色 | 版本 |
|---|---|---|
| [`@qcqx/lattice-core`](./packages/core) | 领域核心：存储、spec 级联、RAG、同步 | [![core](https://img.shields.io/npm/v/@qcqx/lattice-core?label=%20)](https://www.npmjs.com/package/@qcqx/lattice-core) |
| [`@qcqx/lattice-protocol`](./packages/protocol) | 跨端契约（types-only DTO / 消息） | [![protocol](https://img.shields.io/npm/v/@qcqx/lattice-protocol?label=%20)](https://www.npmjs.com/package/@qcqx/lattice-protocol) |
| [`@qcqx/lattice-services`](./packages/services) | 用例层：CLI / Web / 扩展共享 | [![services](https://img.shields.io/npm/v/@qcqx/lattice-services?label=%20)](https://www.npmjs.com/package/@qcqx/lattice-services) |
| [`@qcqx/lattice-cli`](./packages/cli) | 命令行（`lattice` / `ltc`） | [![cli](https://img.shields.io/npm/v/@qcqx/lattice-cli?label=%20)](https://www.npmjs.com/package/@qcqx/lattice-cli) |
| [`@qcqx/lattice-web`](./packages/web) | Web 服务端（HTTP API + 静态资源） | [![web](https://img.shields.io/npm/v/@qcqx/lattice-web?label=%20)](https://www.npmjs.com/package/@qcqx/lattice-web) |
| [`@qcqx/lattice-web-ui`](./packages/web-ui) | 共享 React UI（web 客户端与扩展 Webview 共用） | [![web-ui](https://img.shields.io/npm/v/@qcqx/lattice-web-ui?label=%20)](https://www.npmjs.com/package/@qcqx/lattice-web-ui) |
| [`lattice`（VS Code）](./packages/vscode) | VS Code 扩展（进程内 core + Webview） | 0.1.1（VSIX） |

## 快速开始

```bash
# CLI —— 安装后提供 `lattice` 与 `ltc` 两个命令
npm install -g @qcqx/lattice-cli
ltc init          # 创建 ~/.lattice、选择用户名、注入 AI 客户端工作流
ltc scan          # 扫描并注册本地项目（非 git 项目可在目录内 `ltc link`）
ltc context       # 当前仓库的全部规范 / 活跃任务 / 关联项目
```

```bash
# 开发与打包 VS Code 扩展
pnpm install
pnpm package:vscode   # → packages/vscode/dist-vsix/lattice-context-<version>.vsix
```

```bash
# Web 工作台
npm install -g @qcqx/lattice-web
ltc web               # 打开本地 Web UI
```

## 数据与隐私

- 一切都在你本机的 `~/.lattice` —— 项目、规范、任务、checkpoint、搜索索引。
- 无遥测；工具本身不发任何网络请求。同步（origin / 域）只访问**你自己配置**的 Git 远端。
- VS Code 扩展以**进程内**方式读写同一数据根（不起 CLI 子进程、不需要本地 HTTP 服务）。

## 文档

- [快速开始](./docs/quick-start.zh-CN.md)
- [技术架构详解](./docs/architecture.zh-CN.md)
- [目录与配置](./docs/directory-and-config.zh-CN.md)
- [Spec 模板仓库结构](./docs/spec-template-registry.zh-CN.md)
- [文档索引](./docs/README.zh-CN.md)

子包文档：[cli](./packages/cli/README.zh-CN.md) · [core](./packages/core/README.zh-CN.md) · [web](./packages/web/README.zh-CN.md) · [vscode](./packages/vscode/README.zh-CN.md)

### AI / Agent 工作流模板

- [技能入口与工作流总览](./packages/core/public/templates/skills/zh/SKILL.md)
- [系统级常驻规则（强制约束）](./packages/core/public/templates/platforms/zh/lattice-rules.md)
- [CLI 命令参数速查](./packages/core/public/templates/skills/zh/command-reference.md)
- [任务工作流详解](./packages/core/public/templates/skills/zh/task-workflows.md) · [Spec 工作流详解](./packages/core/public/templates/skills/zh/spec-workflows.md)
- [项目上下文获取](./packages/core/public/templates/skills/zh/project-context.md) · [项目发现与识别](./packages/core/public/templates/skills/zh/project-discovery.md)
- [Agent Commands 用途与边界](./packages/core/public/templates/skills/zh/agent-commands.md)

## 仓库结构

```
packages/
├── core/       → @qcqx/lattice-core       领域核心（存储、级联、RAG、同步）
├── protocol/   → @qcqx/lattice-protocol   跨端契约（types-only）
├── services/   → @qcqx/lattice-services   多宿主共享用例层
├── cli/        → @qcqx/lattice-cli        命令行（lattice / ltc）
├── web/        → @qcqx/lattice-web        Web 服务端 + 客户端构建
├── web-ui/     → @qcqx/lattice-web-ui     共享 React UI 组件
└── vscode/     → lattice（VS Code 扩展）   侧栏视图、Webview、诊断
```

## 参与贡献

欢迎提 Issue 与 PR —— 见 [CONTRIBUTING.md](./CONTRIBUTING.md)。请遵守 [行为准则](./CODE_OF_CONDUCT.md)；
安全问题请按 [SECURITY.md](./SECURITY.md) 报告。

## License

[MIT](./LICENSE)

<!-- Star History —— star 量起来后解除注释：
<p align="center">
  <a href="https://star-history.com/#qxchuckle/lattice&Date"><img src="https://api.star-history.com/svg?repos=qxchuckle/lattice&type=Date" alt="Star History Chart" width="640"></a>
</p>
-->
