# Lattice

**Lattice** 是一个跨项目的 AI 脚手架。它把分散在多个仓库中的规范、任务、项目关系和可复用经验统一管理在 `~/.lattice/` 中，并通过 CLI 提供给开发者和 AI 工具，帮助你在不同项目之间复用规则、延续上下文，并找到可参考的历史方案。

## 核心能力

| 能力 | 说明 |
|---|---|
| **Spec 分层规范** | 全局 / 用户 / 项目三级 spec，高优先级自动覆盖低优先级 |
| **任务管理** | 创建、启动、checkpoint 进展追踪、完成与归档的完整生命周期 |
| **项目关系** | 注册项目、维护跨仓库关系和嵌套项目继承 |
| **RAG 搜索** | 本地嵌入式向量 + 全文索引，搜索 spec、任务、checkpoint 等文档 |
| **上下文聚合** | `ltc context` 一键拿到当前项目所有 spec、活跃任务与关联项目 |
| **模板系统** | 内置 spec 模板和远程模板仓库，快速初始化项目规范 |
| **AI 集成** | 通过 `ltc init` 向 Cursor / Claude Code / Qoder / Trae 等客户端注入工作流 |
| **Web 可视化** | `ltc web` 启动本地可视化服务，浏览任务/项目/Spec 关系图 |

## 适用场景

- 进入一个陌生仓库时，先拿到当前项目的规范和上下文
- 多个项目并行推进时，持续维护任务状态和关联关系
- 遇到相似需求时，搜索之前做过的方案、规则和决策
- 希望让 AI / Agent 在编码前先对齐项目约定，而不是每次从零开始

## 快速开始

完整的上手指南请参阅 [快速开始](docs/quick-start.md)

```bash
# 全局安装，提供两个命令 lattice / ltc
npm install -g @qcqx/lattice-cli
# 初始化 AI 客户端集成
ltc init
# 扫描本地项目
ltc scan
# 在项目目录注册（用于非 git 项目）
ltc link
```

web 可视化视图

```bash
# 全局安装 web 包
npm install -g @qcqx/lattice-web
# 启动 web
ltc web
```

## 仓库结构

```
packages/
├── cli/   → @qcqx/lattice-cli  — 命令行入口
├── core/  → @qcqx/lattice-core — 领域逻辑核心库
└── web/   → @qcqx/lattice-web  — 可视化前端
```

## 文档入口

- [快速开始](docs/quick-start.md)
- [技术架构详解](docs/architecture.md)
- [Spec 模板仓库结构说明](docs/spec-template-registry.md)

### 子包说明

- CLI 命令行工具：[`packages/cli/README.md`](packages/cli/README.md)
- Core 领域逻辑核心库：[`packages/core/README.md`](packages/core/README.md)
- Web 可视化前端：[`packages/web/README.md`](packages/web/README.md)

### AI / Agent 工作流

- 技能入口与工作流总览：[`packages/core/public/templates/skills/SKILL.md`](packages/core/public/templates/skills/SKILL.md)
- 系统级常驻规则（强制约束）：[`packages/core/public/templates/platforms/lattice-rules.md`](packages/core/public/templates/platforms/lattice-rules.md)
- CLI 命令参数速查：[`packages/core/public/templates/skills/command-reference.md`](packages/core/public/templates/skills/command-reference.md)
- 任务工作流详解：[`packages/core/public/templates/skills/task-workflows.md`](packages/core/public/templates/skills/task-workflows.md)
- Spec 工作流详解：[`packages/core/public/templates/skills/spec-workflows.md`](packages/core/public/templates/skills/spec-workflows.md)
- 项目上下文获取：[`packages/core/public/templates/skills/project-context.md`](packages/core/public/templates/skills/project-context.md)
- 项目发现与识别：[`packages/core/public/templates/skills/project-discovery.md`](packages/core/public/templates/skills/project-discovery.md)
- Agent Commands 用途与边界：[`packages/core/public/templates/skills/agent-commands.md`](packages/core/public/templates/skills/agent-commands.md)
- Subagent 委派策略：[`packages/core/public/templates/skills/subagent-delegation.md`](packages/core/public/templates/skills/subagent-delegation.md)
- 异常排查与诊断：[`packages/core/public/templates/skills/troubleshooting.md`](packages/core/public/templates/skills/troubleshooting.md)

### 参考文档

- 目录结构与配置详解：[`docs/directory-and-config.md`](docs/directory-and-config.md)
- Spec 模板仓库组织与导入规则：[`docs/spec-template-registry.md`](docs/spec-template-registry.md)
- 内置公共模板、命令文档和平台规则：[`packages/core/public/templates/`](packages/core/public/templates/)

## 开发

```bash
# 安装依赖
pnpm install

# 构建全部
pnpm build

# 仅构建 core
pnpm build:core

# 仅构建 CLI
pnpm build:cli

# 类型检查
pnpm check-types

# Lint & Format
pnpm lint
pnpm format
```

## License

MIT
