# 任务工作流

任务全生命周期：创建/起手/实施期循环/checkpoint/归档。硬约束清单见 [lattice-rules.md](lattice-rules.md)；spec 读写/沉淀见 [spec-workflows.md](spec-workflows.md)。

## 任务目录与文件结构

```
~/.lattice/users/<username>/tasks/<task-id>/
├── task.json       # 元数据（id/title/status/projects/scopePaths 唯一来源）
├── prd.md          # 当前最佳认知快照（目标、约束、方案、文件索引），边做边修订
├── progress.yaml   # 追加型过程日志（11 类 checkpoint）
├── design.md       # 方案讨论档案（被否决方案及理由的唯一承载点）
└── ...
```

职责不重叠：PRD 管"现在认为应该是什么"，progress 管"发生了什么"，design 管"怎么讨论出来的"。`prd.md` 不含 YAML frontmatter。

## 任务模式：design vs implementation

```
design（讨论）→ start（实施）→ design（中途讨论）→ 实施 → archive（收尾）
```

- **design**：只读+分析，禁改业务代码，讨论写入 design.md
- **implementation**：start 后默认，可改代码
- 未显式进入 design 但出现方案讨论 → 主动追加 design.md

硬约束见 [lattice-rules.md §二](lattice-rules.md#二design-模式约束)。fast-start 见 [fast-start-workflows.md](fast-start-workflows.md)。

## 命令参数不是任务 ID 时：标题归纳与查重

0. **项目定位（必做）**：
   - 有路径 → `ltc project where <path>`
   - 有语义描述 → `ltc project list --search <keyword>`（可多次）
   - 定位到 → create 用 `--project <id>`；无结果 → `--current`
1. 归纳简洁标题
2. `ltc task list --current` + `ltc search "<标题>" --project <id> --type task --json` 查重
3. 有相似 in_progress 任务 → 列候选给用户确认
4. `ltc task create "<标题>" [--current | --project <id>] [--parent <id>]`

## 父子任务

```bash
ltc task create "<title>" --parent <parent-task-id>
ltc task lineage <task-id>
ltc task tree <task-id> [--descendants]
ltc task update <task-id> --parent <id> / --clear-parent
```

## task start 后的起手动作

> 委派：必须委派 `lattice-task-start` subagent（不支持时退化串行）。subagent 读取并筛选相关 spec 与任务，返回目录；**主线凭目录 Read 相关文档全文，并可自主调用 `ltc search` / `ltc context` 补全信息**。

```bash
ltc task start <task-id>
ltc context --task <task-id> --query "<主题关键词>"
```

1. 按主题精读相关 spec（→ [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)）：先从 context 列表选读，再 `ltc search` 补漏
2. 参考近似历史任务 PRD
3. 完善 PRD（目标、约束、方案、文件索引）
4. 有 design.md 先 read_file
5. 输出整体确认（ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束）

## 实施期多轮对话循环（每轮用户输入到来时）

```
用户输入
  ↓
步骤 1：PRD 硬触发（T1~T8）命中？→ 是：read prd → 改 prd → decision/pivot checkpoint
  ↓
步骤 2：spec 选读触发？→ 是：read_file 精读
  ↓
步骤 3：写代码（≥3 业务文件 → 先校对 PRD 文件索引）
  ↓
步骤 4：打 checkpoint（打点前必过 PRD 自检）
```

### PRD 同步硬触发清单（T1~T8）

命中即先改 PRD → 打 decision/pivot checkpoint → 才继续。

| # | 触发条件 |
|---|----------|
| T1 | 用户提出新需求/修改需求/推翻方案 |
| T2 | 决定采用/否决技术方案 |
| T3 | 新增/移除修改文件 |
| T4 | 单轮将改 ≥3 个业务文件 |
| T5 | 发现意料外的兼容性/边界/迁移问题 |
| T6 | 引入新依赖/模块边界/跨包调用 |
| T7 | 准备打 milestone checkpoint |
| T8 | PRD 写入了项目路径/包名/spec 引用但 task.json 未同步 |

### spec 选读触发条件

> **每轮必检，非一次性**。宁多勿少。

满足任一即触发：本轮主题词首次出现 · 用户提到"规范/约定/历史/类似/跨项目" · 涉及层级判定 · 涉及未涉及的模块边界/跨包调用 · 遇到实现困难需查历史经验

触发后活用 `ltc search` 发现起手未识别的相关 spec 或历史任务。

### 写代码前的动作锚点

本轮要改 ≥3 个业务文件 → 先 `read_file prd.md` 校对「修改文件索引」。索引缺失 → 命中 T3 先改 PRD。

### 打 checkpoint 前的 PRD 自检

确认：本轮改动文件已在索引中 · 本轮决策已写入「当前方案」· 无未同步的硬触发项。命中 → 先改 PRD 再打点。checkpoint 不替代 PRD。

## checkpoint 类型与触发条件

```bash
ltc task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

11 类，按来源分三组（互补不重叠）：

### 用户输入类

| type | 何时打 | 格式要点 |
|---|---|---|
| `context` | 用户给出背景、业务规则、技术约束等实质信息 | ≤200字原样；长则概述+关键引言 |
| `correction` | 用户指出 AI 做错 / AI 自发现犯错 | **强制三段**：做错了什么·为什么错·正确做法 |
| `constraint` | 用户施加硬约束（"不许做X"/"必须用Y"） | 明确"不要什么"或"必须什么" |

### AI 判断类

| type | 何时打 | 格式要点 |
|---|---|---|
| `assumption` | AI 做出影响方向的关键假设 | "推断了什么"+"被推翻会怎样" |
| `followup` | AI 识别出应做但主动延后的事项 | "为何现在不做" |
| `note` | 值得保留的客观事实；或连续 3 轮无 checkpoint 兜底 | 注明来源 |

### 进程事件类

| type | 何时打 |
|---|---|
| `decision` | 拍板某选项（技术决策、方案选型、用户确认） |
| `pivot` | 原方向被整体推翻（小范围纠错走 correction） |
| `milestone` | 阶段性成果通过验证 |
| `issue` | 非 AI 自身错误的问题（环境、依赖、兼容性） |
| `summary` | 任务即将归档时一次性总结 |

**选型**：用户开口 → 用户输入类；AI 推断/事实 → AI 判断类；客观事件 → 进程事件类；单输入多语义 → 拆多条。

被否决方案写 design.md，progress 不重复。查看：`ltc task progress <id> [--last N] [--type <type>]`

## 项目关联同步

任务进行中新增/调整项目关联（创建时的定位见「标题归纳与查重」第 0 步）：

| 场景 | 命令 |
|---|---|
| 在当前工作目录项目范围内 | `ltc task associate <id> --current` |
| 目标是另一个已注册项目 | `ltc task associate <id> --project <project-id>` |
| 涉及路径不是已注册项目 | `ltc task associate <id> --paths <path>` |

获取目标项目 ID：`ltc project where <path>` / `ltc project list --search <keyword>`。发现新路径/新项目当轮执行。

### spec 引用同步

```bash
ltc task ref-spec <task-id> <spec-name>     # 支持文件名/标题模糊匹配
ltc task unref-spec <task-id> <spec-id>
```

### 元数据与 PRD 一致性

task.json 的 `projects`/`scopePaths`/spec 引用是机器可读元数据，PRD 自然语言不能替代。PRD 写入路径/项目/spec 引用时必须同时 CLI 记录（命中 T8）。

### 项目间关系记录

涉及多项目时检查是否已有关系，无则推断添加：

```bash
ltc project relation add <a> <b> --type <type> --description "证据" --ai-inferred --from-task <task-id>
```

| 现象 | 类型 |
|------|------|
| 共享 git first commit / fork | `forked-from` |
| A 的 dependencies 引用 B | `depends-on` |
| 共用同一 monorepo 包 | `shares-component` |
| 同组织无强证据 | `related` |

## 任务归档前置信息采集

> 委派：必须委派 `lattice-task-archive` subagent（不支持时退化串行）。

禁止跳过：未读 PRD + progress + design.md 就写归档总结 = 必然遗漏。

```bash
ltc task info <task-id>                       # → read prd.md
ltc task progress <task-id>
ltc task progress <task-id> --type correction
ltc task progress <task-id> --type constraint
ltc task progress <task-id> --type context
# read design.md（如存在）+ git diff --stat
```

PRD 补全：最终方案 + 任务完成总结 + 遗留事项。

## 归档流程

```bash
# 1. 前置采集（上节）
# 2. 补 PRD
# 3. summary checkpoint
ltc task checkpoint <id> --type summary --title "..." -m "..."
# 4. complete + archive
ltc task complete <id> && ltc task archive <id>
# 5. ltc rag update
# 6. 二次审阅 + spec 沉淀判定
```

## 归档后的二次审阅与 spec 沉淀判定

对照 progress 和对话检查：关键决策是否全在 PRD/checkpoint · 有无遗漏改动 · 经验是否沉淀（→ [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)） · 项目间关系是否补记。发现遗漏立即补充 + `ltc rag update`。

## 命令参数为空时的归档推断规则

`ltc task list --current` + `ltc search "<对话主题>" --type task --json`。in_progress 仅 1 个且匹配 → 直接归档；多候选 → 列给用户。

## 输出原则：精简但不静默

**精简**：不复述 CLI 原始输出、不罗列每步命令、不贴全部 JSON。

**不静默**：关键节点立即输出简短说明——任务创建后（标题+ID+关联项目）· 状态切换后 · 关联项目变化后 · 发现相似任务时（列候选）· 归档完成后（结果+总结要点）。

进入实施前补整体确认：ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束。
