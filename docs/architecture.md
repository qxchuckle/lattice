# Lattice 技术架构详解

本文档面向开发者和潜在贡献者，讲解 Lattice 的整体技术架构与核心设计决策。如果你是想快速上手的用户，请先阅读 [快速开始](quick-start.md)。

## 架构总览

Lattice 是一个 monorepo 项目，由三个 npm 包组成，各自职责清晰、依赖单向：

```
packages/
├── core/  → @qcqx/lattice-core  — 领域逻辑核心库（纯 TypeScript，零 CLI 依赖）
├── cli/   → @qcqx/lattice-cli  — 命令行入口（commander.js，依赖 core）
└── web/   → @qcqx/lattice-web  — 可视化前端（Express + React，依赖 core）
```

三包之间的依赖关系：

```
cli ──→ core
web ──→ core
core（无下游依赖，可独立发布）
```

**为什么这样拆**：`core` 是所有领域逻辑的唯一载体，CLI 和 Web 都只是它的"壳"。这样设计的好处是：

- 领域逻辑可被任意运行时复用（CLI 进程、Web 服务器、未来可能的 LSP / MCP 服务）
- `core` 的 `browser.ts` 入口剔除了 Node.js 专有依赖（`crypto`、`fs`），使纯函数子集可在浏览器端直接引用
- 发版时可以独立更新 CLI 和 Web，不需要同时发布

### 数据流

```
用户操作（终端 / 浏览器 / AI 客户端）
        │
        ▼
  CLI 命令 / Web API ──→ core 领域函数
        │                      │
        │                      ├──→ 文件系统（~/.lattice/ 数据真源）
        │                      ├──→ SQLite（索引 + 缓存，可重建）
        │                      └──→ Embedding 模型（RAG 向量）
        │
        ▼
  输出结果（终端文本 / JSON / HTTP 响应 / AI 上下文）
```

Lattice 的数据真源是 `~/.lattice/` 下的文件系统（JSON + Markdown）。SQLite 数据库是加速查询的索引层，可通过 `ltc rag rebuild` 从文件系统全量重建。这种"文件优先、DB 辅助"的设计使得数据可读、可 git 管理、可手动恢复。

## Core 领域逻辑层

`packages/core/src/` 按领域划分为以下模块，依赖方向严格单向无循环：

```
core/src/
├── types/          — 全局类型定义（ProjectMeta / TaskMeta / SpecFrontmatter 等）
├── paths/          — 路径工具（~/.lattice/ 目录结构 + 文件读写）
├── config/         — 配置管理（global + local 双层配置）
├── db/             — SQLite 数据库层（better-sqlite3，WAL 模式）
├── project/        — 项目身份与注册（核心模块，10+ 子文件）
├── spec/           — Spec 管理（解析 / 级联 / 冲突检测 / lint / 迁移）
├── task/           — 任务生命周期（创建 / 更新 / 归档 / checkpoint）
├── rag/            — RAG 搜索（embedding 生成 / 索引 / 语义检索）
├── search/         — 上下文聚合 + 混合搜索（FTS + 向量 RRF 融合）
├── trash/          — 软删除回收站
├── maintenance/    — 启动自检
├── template-assets.ts — 模板渲染（AI 客户端注入 + Spec 模板）
├── browser.ts      — 浏览器安全入口（纯函数子集，Vite alias 指向）
└── index.ts        — 统一 re-export（CLI / Web 的唯一导入入口）
```

### 项目模块（project/）

项目模块是 core 中最复杂的子系统，负责项目身份识别、自动注册、虚拟合并、嵌套检测等核心能力：

```
project/
├── identity.ts          — ID 模型纯函数（零 Node.js 依赖）
├── identity-generate.ts — ID 生成（依赖 crypto）
├── lookup.ts            — 项目查找 + 虚拟合并
├── association.ts       — 任务关联判断
├── register.ts          — 注册 + 自动注册
├── scan.ts              — 扫描 + 黑名单
├── nested-in.ts         — 嵌套关系自动检测
├── merge.ts             — 物理合并事务
├── fingerprint.ts       — git 指纹采集
├── relation.ts          — 项目间关系 CRUD
├── cross-user.ts        — 跨用户聚合
└── index.ts             — re-export + DB 同步
```

依赖方向单向无循环：`identity → lookup → association`，`identity → register → scan`。

**纯函数设计**：`identity.ts` 中的 `selectPrimaryId`、`normalizeProjectMeta`、`normalizeLegacyId` 等函数零 Node.js 依赖，可被 `browser.ts` 安全导出到浏览器端。Node.js 专有的 `identity-generate.ts`（依赖 `crypto`）单独拆分。

### Spec 模块（spec/）

Spec 是 Lattice 中的可复用知识单元。spec 模块负责解析、级联、冲突检测和迁移：

| 文件 | 职责 |
|---|---|
| `io.ts` | 解析 / 写入 spec 文件（frontmatter + 正文） |
| `cascade.ts` | 三层级联聚合（global → user → project） |
| `conflicts.ts` | 多层级同名冲突检测 |
| `query.ts` | 模糊查找 / scope 验证 |
| `lint.ts` | frontmatter 规范校验 |
| `migrate.ts` | 旧格式 spec 迁移（`ltc spec migrate`） |
| `id.ts` | spec ID 生成（`spec-` 前缀 + base36） |
| `validate.ts` | scope 合法性验证 |

### 任务模块（task/）

任务模块管理从创建到归档的完整生命周期：

| 文件 | 职责 |
|---|---|
| `index.ts` | 任务 CRUD + 元数据管理 + DB 同步 |
| `checkpoint.ts` | 进度追踪（progress.yaml 追加写入，11 类 checkpoint） |
| `refs.ts` | 任务 ↔ spec 引用关系管理 |

每个任务在磁盘上是一个目录，包含 4 个文件，职责不重叠：

```
~/.lattice/users/<user>/tasks/<task-id>/
├── task.json       — 元数据（状态 / 关联项目 / spec 引用）
├── prd.md          — 当前最佳认知快照（目标 / 方案 / 文件索引）
├── progress.yaml   — 过程日志（checkpoint 追加记录）
└── design.md       — 方案讨论档案（被否决方案及理由，可选）
```

## CLI 命令层

`packages/cli/` 使用 [commander.js](https://github.com/tj/commander.js) 构建，采用"注册函数"模式组织命令：

```typescript
// cli/src/index.ts — 入口
const program = new Command();
registerInitCommand(program);      // ltc init
registerLinkCommand(program);      // ltc link
registerTaskCommand(program);      // ltc task ...
registerSpecCommand(program);      // ltc spec ...
// ... 共 18 个命令模块
```

每个命令模块导出一个 `registerXxxCommand(program: Command)` 函数，在入口统一注册。这种模式的好处是命令间完全解耦，新增命令只需写一个文件 + 在入口加一行。

### 命令模块清单

| 模块 | 命令 | 职责 |
|---|---|---|
| `init.ts` | `ltc init` | 初始化 + AI 客户端检测注入 |
| `link.ts` | `ltc link` | 手动注册项目（生成 lattice.json） |
| `unlink.ts` | `ltc unlink` | 取消项目注册 |
| `scan.ts` | `ltc scan` | 批量扫描 git 项目 |
| `project.ts` | `ltc project ...` | 项目管理 + 关系管理 |
| `task.ts` | `ltc task ...` | 任务全生命周期 |
| `spec.ts` | `ltc spec ...` | Spec 管理 + 模板 |
| `context.ts` | `ltc context` | 上下文聚合（核心命令） |
| `search.ts` | `ltc search` | RAG 搜索 |
| `config.ts` | `ltc config ...` | 配置管理 |
| `status.ts` | `ltc status` | 当前项目状态 |
| `doctor.ts` | `ltc doctor` | 健康检查 + 自动修复 |
| `sync.ts` | `ltc sync` | 同步 spec 模板 |
| `user.ts` | `ltc user ...` | 用户管理 |
| `rag.ts` | `ltc rag ...` | RAG 索引管理 |
| `trash.ts` | `ltc trash ...` | 回收站管理 |
| `web.ts` | `ltc web` | 启动可视化服务 |

### 全局选项注入

CLI 入口在命令注册后，通过递归遍历为所有叶子命令自动注入两个全局选项：

- `--force` / `-f`：跳过二次确认（AI 调用时必须，避免阻塞等待用户输入）
- `--debug` / `-d`：输出调试信息

```typescript
// 递归为所有叶子命令添加 --force / --debug
ensureForceOption(program);
ensureDebugOption(program);
```

### 进程生命周期

```typescript
async function main(): Promise<void> {
  // 进程退出时确保 DB 正确关闭（WAL checkpoint，防数据丢失）
  process.on('exit', () => closeDb());

  // 启动自检（失败不阻断主命令）
  await runStartupSelfCheck();

  await program.parseAsync(process.argv);
}
```

## 数据模型

### 项目身份标识

Lattice 的项目身份识别是其最核心的设计之一。每个项目有一组 IDs，格式为 `<prefix>:<content>`：

| 前缀 | 来源 | 优先级 |
|---|---|---|
| `legacy:` | `lattice.json` 中的随机 16 字符 ID | 1（最高） |
| `git:` | git first commit SHA 前 16 位 | 2 |
| `remote:` | `sha256(normalize(git_remote))` 前 16 位 | 3 |

任一 ID 匹配即视为同一项目。优先级由 `selectPrimaryId()` 基于 `ID_PRIORITY_MAP` 运行时动态计算，不靠数组顺序。

**虚拟合并**：多个物理注册项目如果有 ID 交集，在查询层自动聚合为一个逻辑项目，零物理操作。各自保留独立的 `project.json` / spec / task。这实现了"同一个项目在多台机器、多个 fork、多个 worktree 下都能被识别为同一个"。

### Spec 三级分层

```
全局级  ~/.lattice/spec/                    — 多用户多项目通用
用户级  ~/.lattice/users/<user>/spec/       — 跨项目复用
项目级  ~/.lattice/users/<user>/projects/<id>/spec/  — 仅当前项目
```

优先级：项目级 > 用户级 > 全局级。同名冲突时高优先级覆盖低优先级，通过 `getCascadedSpecs()` 在运行时聚合。

### Task 生命周期

任务有 4 种状态，状态流转由 CLI 命令驱动：

```
planning → in_progress → completed → archived
              ↑                │
              └─── 可回退 ──────┘
```

任务的核心数据结构 `TaskMeta` 包含：

- `projects` — 关联的项目 ID 列表（可跨项目）
- `scopePaths` — 额外路径（不属于已注册项目但任务涉及的路径）
- `referencedSpecs` — 引用的 spec 列表
- `parentTaskId` — 父任务 ID（支持子任务树）

## AI 客户端集成（Agent 注入）

Lattice 的核心价值之一是让 AI 工具在编码前自动获取项目规范和上下文。这通过 `ltc init` 的 AI 客户端检测与注入机制实现。

### 三层注入模型

Lattice 向 AI 客户端注入三类文件，形成 **Rules + Skill + Commands** 三层工作流约束：

```
~/.<client>/
├── rules/lattice.mdc        — 常驻规则（alwaysApply，每次对话都加载）
├── AGENT.md / CLAUDE.md     — 原生规则入口（部分客户端）
├── skills/lattice/SKILL.md  — 技能入口（渐进式加载，按需展开子文档）
└── commands/                — Slash 命令（/lattice:task:start 等）
    ├── task/
    │   ├── start.md
    │   ├── checkpoint.md
    │   └── ...
    ├── context.md
    └── ...
```

| 层 | 加载策略 | 内容 | 文件真源 |
|---|---|---|---|
| **Rules** | alwaysApply（常驻） | 系统级硬约束清单（起手契约 / 实施期循环 / 归档闭环） | `platforms/lattice-rules.md` |
| **Skill** | 渐进式（按需展开） | 工作流总览 + 子文档锚点（任务 / spec / 项目 / 搜索） | `skills/SKILL.md` + 子文档 |
| **Commands** | 用户触发（slash） | 具体操作流程（task start / task design / keep 等） | `commands/*.md` |

**为什么三层而不是一层**：Rules 保证底线约束不遗漏（即使 AI 忘了读 Skill），Skill 提供完整的上下文按需加载（避免一次性塞入过多 token），Commands 提供标准化的操作入口（用户一句话触发完整流程）。三者互补：

- Rules 是"必须遵守的"——硬约束、禁令、强制循环
- Skill 是"应该知道的"——工作流全貌、判定条件、命令速查
- Commands 是"怎么做的"——具体步骤、输出格式

### 多客户端适配

`ltc init` 通过 `detectAndConfigureAITools()` 自动检测本地已安装的 AI 客户端，并按各客户端的目录约定注入文件：

| 客户端 | 检测路径 | Rules 落地 | Skill 落地 | Commands 落地 | Agents 落地 |
|---|---|---|---|---|---|
| **Cursor** | `~/.cursor/` | `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Claude Code** | `~/.claude/` | `CLAUDE.md` + `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Qoder** | `~/.qoder/` | `AGENT.md` + `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Trae** | `~/.trae/` | `AGENT.md` + `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Agent** | `~/.agents/` | `AGENT.md` + `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Windsurf** | `~/.windsurf/` | `rules/lattice.md` | — | — | — |
| **Kiro** | `~/.kiro/` | `steering/lattice.md` | — | — | — |
| **Codex** | `~/.codex/` | `AGENTS.md` | `skills/lattice/SKILL.md` | 转化为独立 skills | — |

所有客户端共享同一份 `lattice-rules.md` 正文内容，差异仅在于：

- **Cursor 系**（.mdc 格式）在正文前拼接 frontmatter（`alwaysApply: true`）
- **Claude Code / Qoder / Trae / Agent** 同时写入原生入口文件（`CLAUDE.md` / `AGENT.md`）和 `.mdc` 规则文件
- **Codex** 没有原生 slash command 机制，commands 被转化为独立 skills（`deployCommandsAsSkills`）
- **Agents 注入**使用增量复制（同名覆盖 + 新增，不删除用户自定义 agent），不支持 subagent 的平台跳过

### 标记化更新机制

规则文件注入使用 `LATTICE:BEGIN` / `LATTICE:END` 标记包裹正文，实现幂等更新：

```markdown
<!-- LATTICE:BEGIN -->
（Lattice 规则正文，更新时只替换标记之间的内容）
<!-- LATTICE:END -->
```

`injectLatticeBlock()` 函数处理四种情况：

| 文件状态 | 行为 |
|---|---|
| 已含完整标记 | 仅替换标记之间的正文，标记外的用户内容保留 |
| 文件不存在 / 空 | 写入完整内容（含 frontmatter） |
| 无标记 + 覆盖模式 | 整文件覆盖为带标记的内容 |
| 无标记 + 追加模式 | 在原内容末尾追加带标记的块 |

这确保用户在同一个 `CLAUDE.md` 中混入自己的规则时，`ltc init` 更新不会覆盖用户内容。

### 模板渲染管线

```
packages/core/public/templates/          — 模板真源（随 npm 包发布）
├── platforms/lattice-rules.md           — 所有客户端共享的规则正文
├── skills/SKILL.md + 子文档             — 技能入口 + 子文档
├── commands/*.md                        — slash 命令模板
└── spec/                                — spec 模板（frontend / backend / api 等）
```

`template-assets.ts` 负责模板的读取、渲染和分发。渲染函数按平台适配：

```typescript
// 所有平台指向同一个模板文件
const platformTemplatePaths: Record<PlatformName, string> = {
  cursorRules: LATTICE_RULES_TEMPLATE,
  claudeCode: LATTICE_RULES_TEMPLATE,
  windsurfRules: LATTICE_RULES_TEMPLATE,
  kiroSteering: LATTICE_RULES_TEMPLATE,
};

// Cursor 系额外拼接 frontmatter
export function renderCursorRules(data?: TemplateData): string {
  return `${CURSOR_RULES_FRONTMATTER}${renderPlatformTemplate('cursorRules', data)}`;
}
```

## 工作流设计

Lattice 不只是数据管理工具——它通过 AI 客户端注入，在 AI 编码过程中施加结构化的工作流约束。

### Skill + CLI 双驱动

Lattice 的工作流由两个引擎驱动：

1. **Skill 驱动（AI 侧）**：注入到 AI 客户端的 Skill 文档定义了"AI 应该怎么做"——何时获取上下文、何时读 spec、何时打 checkpoint、何时改 PRD。这是声明式的，靠 AI 遵守文档约定。

2. **CLI 驱动（工具侧）**：`ltc` 命令是"AI 实际执行操作的工具"——创建任务、打 checkpoint、搜索 spec、聚合上下文。这是命令式的，靠 CLI 的输入输出约束行为。

两者形成闭环：Skill 告诉 AI"该做什么"，CLI 提供"怎么做的工具"。

### PRD 驱动开发

每个任务有一个 PRD 文件（`prd.md`），是"当前最佳认知的活体快照"。它不是需求文档（写完就不动的），而是边做边修订的：

```
目标 → 关键约束 → 当前方案 → 修改文件索引 → 风险 → 任务完成总结
```

工作流强制要求"PRD 永不落后于代码"——命中硬触发清单（T1~T8）时必须先改 PRD 再改代码。这确保了上下文压缩后 AI 读 PRD 仍能获得正确的认知。

### Checkpoint 11 类

任务进展通过 `progress.yaml` 追加记录，11 种类型按信息来源分三组，完全正交：

```
用户输入类（3）              AI 判断类（3）           进程事件类（5）
├── context（背景）          ├── assumption（推断）   ├── decision（决策）
├── correction（纠错）       ├── followup（待办）     ├── pivot（转折）
└── constraint（约束）       └── note（事实）         ├── milestone（里程碑）
                                                     ├── issue（踩坑）
                                                     └── summary（总结）
```

**设计原则**：多类型是互补记录，不是重复记录。单条用户输入常需多类型并发打点——比如用户推翻方案，同时打 `pivot`（方向转折）+ `correction`（纠错）+ `constraint`（新约束）。

### Design vs Implementation 模式

任务有两种运行模式：

- **Design 模式**：只读 + 分析，禁止改业务代码，讨论写入 `design.md`。退出条件是用户明确说"开始实施"。
- **Implementation 模式**：`ltc task start` 后默认状态，可改代码。

这分离了"想清楚"和"做出来"两个阶段，避免 AI 在方案未定时就开始写代码。

## RAG 搜索架构

Lattice 内置本地 RAG（Retrieval-Augmented Generation）搜索，不依赖任何远程 API。

### 混合检索

搜索采用 **FTS（全文索引）+ Embedding（语义向量）** 混合策略，通过 RRF（Reciprocal Rank Fusion）融合排序：

```
用户查询
   │
   ├──→ FTS5 全文检索（SQLite 内置）
   │       └── 关键词匹配（title / content / tags / ngram）
   │
   ├──→ 语义检索（all-MiniLM-L6-v2 embedding）
   │       └── 余弦相似度排序
   │
   └──→ RRF 融合
           ├── rank-based 基础分（1 / (K + rank)）
           ├── title boost（精确 / 部分 / 关键词命中）
           ├── scope 加权（project > user > global）
           ├── type 加权（relation 降权）
           └── 多维度 rerank boost（domain / heading / tag / path）
```

**为什么混合**：FTS 擅长精确关键词匹配（"lattice init"），语义检索擅长概念相似（"项目注册" ≈ "项目发现"）。单用任一种都有盲区，RRF 融合取长补短。

### 增量索引

`ltc rag update` 默认增量更新——只处理内容哈希变化的文档，不全量重建：

```
collectAllSearchDocuments()    — 收集所有可索引文档（spec / task / project / relation）
    │
    ├── 新文档 → 生成 embedding + 写入 FTS
    ├── 内容变化 → 更新 embedding + 更新 FTS
    └── 文档消失 → 删除 embedding + 删除 FTS
```

异常时回退全量重建（`ltc rag rebuild`）。

### Embedding 模型

使用 `Xenova/all-MiniLM-L6-v2`（384 维），通过 `@xenova/transformers` 在 Node.js 中本地推理，无需 GPU 或远程 API。模型文件缓存在 `~/.lattice/models/`，支持通过 `HF_ENDPOINT` 环境变量切换国内镜像。

## Web 可视化层

`packages/web/` 提供本地可视化服务，采用 Express + React 架构：

```
web/src/
├── server/              — Express 服务端
│   ├── app.ts           — Express app 创建
│   ├── index.ts         — 服务启动 / 端口探测 / 浏览器打开
│   ├── routes.ts        — REST API 路由
│   └── schemas.ts       — 请求 / 响应 schema
├── client/              — React 前端
│   ├── App.tsx          — 应用入口
│   ├── main.tsx         — Vite 入口
│   ├── store.ts         — 全局状态管理
│   ├── hooks.ts         — React hooks（数据获取 + 业务逻辑）
│   ├── adapters/        — HTTP 适配层（调用 server API）
│   ├── components/      — UI 组件
│   │   ├── CytoscapeGraph.tsx     — 力导向图（项目关系可视化）
│   │   ├── DetailPanel.tsx        — 详情面板
│   │   ├── sidebar/               — 树形浏览器侧边栏
│   │   └── graph/                 — 图布局算法
│   └── styles/          — 全局样式
└── shared/              — 前后端共享类型
```

### Adapter 模式

客户端通过 `adapters/http.ts` 调用服务端 REST API，不直接调用 core 函数。这层抽象使得未来可以替换为 WebSocket 或其他传输方式。

```
React 组件 → hooks → adapters/http → Express API → core 函数
```

### 力导向图

项目关系可视化使用 [Cytoscape.js](https://js.cytoscape.org) + COSE-Bilkent / fcose 布局算法，支持：

- 节点拖拽 / 缩放 / 点击查看详情
- 关系类型筛选（fork / depends-on / shares-component / nested-in）
- 重叠节点自动消解
- 径向布局 / 顺序布局切换

## 关键设计决策

### 1. 文件优先，DB 辅助

Lattice 的数据真源是文件系统（JSON + Markdown），SQLite 是加速查询的索引层。这意味着：

- 数据可读——直接 `cat` 就能看到内容
- 可 git 管理——`~/.lattice/` 可纳入版本控制
- 可手动恢复——即使 SQLite 损坏，`ltc rag rebuild` 可从文件全量重建
- DB 同步是约束——写物理文件后必须同步 DB（`syncProjectMetaToDb` 而非裸 `upsertProject`）

### 2. 虚拟合并零物理操作

多个物理项目有 ID 交集时，在查询层聚合为一个逻辑项目，**不合并物理文件**。各自保留独立的 `project.json` / spec / task。

**为什么**：`lattice link` 在 fork / worktree 场景下可能创建多个注册项指向同一个仓库。物理合并会有数据丢失风险（spec 冲突怎么选？），虚拟合并在查询层解决，零风险。

### 3. 磁盘回退扫描

`autoRegisterProject` 查 DB 未命中时，回退扫描磁盘 projects 目录，通过 `project.json` 中的 IDs 匹配。找到则自愈同步到 DB。

**为什么需要**：当磁盘有 `project.json` 但 DB 无记录时（数据不一致状态），只查 DB 会创建重复注册。磁盘回退在 DB 未命中时兜底。

### 4. Spec 级联继承

嵌套项目（如 monorepo 子包）自动继承祖先项目的 spec。`getCascadedSpecsWithAncestors` 在聚合时把祖先项目的 spec 一并纳入，优先级低于当前项目。

**为什么**：monorepo 中根项目的规范（如 "所有子包使用 pnpm"）应该自动适用于子包，不需要每个子包重复声明。

### 5. --force 全局注入

CLI 入口递归为所有叶子命令注入 `--force` 选项。AI 调用 CLI 时常需要跳过二次确认，如果不统一注入，遇到未声明的 `--force` 会报 `unknown option` 错误。

### 6. 进程退出 DB 关闭

CLI 入口注册 `process.on('exit', () => closeDb())`，确保 SQLite WAL checkpoint 在进程退出前执行。WAL 模式下未 checkpoint 的数据可能丢失，这行代码是数据安全的兜底。

## 扩展阅读

- [快速开始](quick-start.md) — 安装、初始化、基本使用
- [Spec 模板仓库结构说明](spec-template-registry.md) — 如何组织自定义 spec 模板
- [Skill 入口与工作流总览](../packages/core/public/templates/skills/SKILL.md) — AI 工作流完整文档
- [系统级常驻规则](../packages/core/public/templates/platforms/lattice-rules.md) — AI 硬约束清单
- [CLI 命令速查](../packages/core/public/templates/skills/command-reference.md) — 所有命令参数参考
- [项目身份标识与虚拟合并机制](../packages/core/public/templates/skills/project-discovery.md) — 项目识别深入
