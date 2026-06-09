# 任务工作流

本文件定义 Lattice 任务全流程（目录、多轮循环、checkpoint、归档）。spec 相关见 [spec-workflows.md](spec-workflows.md)。

## 任务目录与文件

```
~/.lattice/users/<username>/tasks/<task-id>/
├── task.json       # 元数据（id/title/status/projects/scopePaths 唯一来源）
├── prd.md          # 当前最佳认知快照（目标、约束、方案、文件索引），边做边修订
├── progress.yaml   # 追加型过程日志（11 类 checkpoint）
├── design.md       # 方案讨论档案（被否决方案及理由的唯一承载点）
└── ...
```

职责不重叠：PRD 管"现在认为应该是什么"，progress 管"发生了什么"，design 管"怎么讨论出来的"。

`prd.md` 不得包含 YAML frontmatter（元数据只在 task.json）。

## 任务阶段

```
design（讨论）→ start（实施）→ design（中途讨论）→ 实施 → archive（收尾）
```

- **design 模式**：只读 + 分析，禁改业务代码，讨论写入 design.md
- **implementation 模式**：start 后默认状态，可改代码
- 未显式进入 design 但出现方案讨论时，主动追加到 design.md

## 标题归纳与查重

命令参数不是任务 ID 时：

1. 归纳简洁标题
2. `lattice task list --current` + `lattice search "<标题>" --project <project-id> --type task --json` 查重
3. 有相似 in_progress 任务 → 先停下列候选给用户确认
4. `lattice task create "<标题>" --current [--parent <parent-task-id>]`

## 父子任务

任务是另一任务的后续/拆分时，创建时指定父任务：

```bash
lattice task create "<title>" --current --parent <parent-task-id>
lattice task lineage <task-id>
lattice task tree <task-id> [--descendants]
lattice task update <task-id> --parent <parent-task-id>
lattice task update <task-id> --clear-parent
```

## 实施期多轮对话循环

`lattice task start` 后，用户每轮新输入到来时按以下顺序执行：

```
用户输入
  ↓
PRD 同步硬触发清单命中任意一项？
  └─ 是：read_file prd.md → search_replace prd.md → 再改代码
  ↓
涉及未读过的模块/规范？
  └─ 是：read_file 精读相关 spec
  ↓
改代码
  ↓
打 checkpoint
```

### PRD 同步硬触发清单

以下任意一条命中即必须先改 PRD 再改代码：

| # | 触发条件 |
|---|----------|
| T1 | 用户提出新需求 / 修改需求 / 推翻方案 |
| T2 | 决定采用 / 否决一个技术方案 |
| T3 | 新增 / 移除一个修改文件 |
| T4 | 单轮将要改 ≥3 个业务文件 |
| T5 | 发现意料外的兼容性 / 边界 / 迁移问题 |
| T6 | 引入新依赖 / 模块边界 / 跨包调用 |
| T7 | 准备打 milestone checkpoint |

### 强制规则

1. PRD 是活体快照，命中硬触发立即更新，不拖到归档
2. PRD 永不落后于代码：先改 PRD 再改代码
3. 新主题先精读相关 spec
4. 代码改完必须打 checkpoint（连续 5 个小修改至少 1 个 milestone/note）
5. 用户推翻方案 = 先改 PRD 再打 pivot checkpoint
6. 过程中发现可复用内容时立即询问用户是否沉淀为 spec
7. 及时打 checkpoint：用户提供实质性信息、AI 做出关键推断、发生客观事件、AI 自身犯错时，当轮打对应类型
8. 单输入含多个语义切片时，拆为多条不同类型 checkpoint 并发记录

颗粒度兜底：连续 3 轮未产生任何 checkpoint → 必须补一条 `note`。

## checkpoint 类型

```bash
lattice task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

11 类，按信息来源分三组，完全正交（多类型是互补记录，不是重复记录）：

### 用户输入类（3）——用户在对话中主动提供的信息

| type | 作用 | 何时打 | 格式要点 |
|---|---|---|---|
| `context` | 保存用户提供的背景·需求·场景·领域知识，防止长对话遗忘 | 用户给出项目背景、业务规则、技术约束等实质信息时 | ≤200字原样；200~800字概述+关键引言；>800字要点3~5条+来源指针 |
| `correction` | 记录纠错全过程，确保同类错误不再犯 | 用户指出 AI 做错了，或 AI 自己发现犯错时 | **强制三段**：做错了什么 · 为什么错 · 正确做法 |
| `constraint` | 明确记录红线，后续所有动作必须遵守 | 用户施加了"不许做 X"或"必须用 Y"等硬约束时 | 明确"不要什么"或"必须什么" |

### AI 判断类（3）——AI 自身产生的推断与记录

| type | 作用 | 何时打 | 格式要点 |
|---|---|---|---|
| `assumption` | 暴露隐含推断，便于日后用户校正 | AI 在用户未明说时做出了影响方向的关键假设 | 明确"推断了什么"与"被推翻会怎样" |
| `followup` | 登记待办，防止被遗忘 | AI 识别出应做但当前轮次主动延后的事项 | 明确"为何现在不做" |
| `note` | 记录客观事实，亦作颗粒度兜底 | 从代码/环境/工具调用获得的值得保留的事实；或连续 3 轮无 checkpoint 时兜底 | 事实需注明来源 |

### 进程事件类（5）——任务推进中发生的客观事件

| type | 作用 | 何时打 |
|---|---|---|
| `decision` | 固化选型结果，后续不再反复讨论 | 拍板某选项（技术决策、方案选型、用户确认） |
| `pivot` | 标记方向性转折，回溯时可快速定位 | 原方向被整体推翻（大范围变更；小范围纠错走 correction） |
| `milestone` | 标记阶段完成，划分任务进度 | 一个阶段性成果通过验证（构建通过、功能闭环等） |
| `issue` | 记录外因踩坑，避免重复踩 | 发生了非 AI 自身错误的问题（环境、依赖、兼容性等） |
| `summary` | 任务收尾归档依据 | 任务即将归档时，一次性总结全局 |

### 选型原则

- 用户开口提供信息 → 用户输入类
- AI 自身产生的推断或事实记录 → AI 判断类
- 任务中发生的客观事件 → 进程事件类
- 单次输入含多种语义 → 拆分为多条不同类型（互补不重叠）

### 打点前 PRD 自检

打 checkpoint 前必须确认：本轮改动的文件是否已在 PRD 文件索引中、本轮决策是否已写入 PRD、是否命中硬触发清单但 PRD 未同步。命中则先改 PRD 再打点。

checkpoint 是追加型过程日志，不能替代 PRD。决策必须同时写入 PRD 和 checkpoint。

### 被否决方案

被否决的方案写入 design.md，progress.yaml 不重复记录。

### 查看进展

```bash
lattice task progress <task-id> [--last <n>] [--type <type>]
```

## 项目关联同步

start 后 AI 实时维护 `task.json` 的 `projects` / `scopePaths`，使其反映实际工作范围。

触发时机：任务刚 start、编辑了新项目文件、中途切换项目目录、归档前复核。

```bash
lattice task associate <task-id> --current
lattice task associate <task-id> --paths <path>
lattice task associate <task-id> --project <project-id>
```

静默执行，只有关联了用户可能未预期的项目时才说明。

## 任务起手动作

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

1. 按主题选读相关 spec
2. `lattice search "<关键词>" --type task --json` 参考近似任务
3. 完善 PRD（目标、约束、方案、文件索引）
4. 如有 design.md 先 read_file

## 归档闭环

### 前置信息采集（强制，先读后写）

禁止跳过：未读 PRD + progress + design.md 就写归档总结 = 必然遗漏关键决策。

```bash
lattice task info <task-id>                           # → read_file prd.md
lattice task progress <task-id>
lattice task progress <task-id> --type correction     # 用户纠错史
lattice task progress <task-id> --type constraint     # 用户边界史
lattice task progress <task-id> --type context        # 用户背景史
# read_file design.md（如存在）
# 审查代码变更（git diff --stat）
```

### 归档流程

```bash
# 1. 前置信息采集
# 2. 更新 prd.md：补最终方案 + 任务完成总结 + 遗留
# 3. summary checkpoint
lattice task checkpoint <task-id> --type summary --title "..." -m "..."
# 4. 完成 + 归档
lattice task complete <task-id>
lattice task archive <task-id>
# 5. lattice rag update
# 6. 二次审阅 + spec 沉淀判定
```

### 二次审阅

对照 progress 和对话检查：关键决策是否全部体现在 PRD 或 checkpoint；是否有遗漏改动；经验是否已判断要不要沉淀为 spec。发现遗漏立即补充 + `lattice rag update`。

## 命令参数为空时的归档推断

- `lattice task list --current` + `lattice search "<对话主题>" --type task --json`
- in_progress 仅 1 个且与当前对话匹配 → 直接归档
- 多个候选 → 列给用户确认

## 输出原则

**精简但不静默**：不长篇复述 CLI 输出，但关键节点必须立即输出 2~5 行简短说明。

关键节点：任务创建后（标题+ID+关联项目）、状态切换后、关联项目变化后、发现相似任务时（先停下列候选）、归档完成后。

进入实施前补一段整体确认：任务 ID + 状态 + 标题 + 关联项目 + 关键约束。

## 命令速查

```bash
lattice task list [--current] [--all-user]
lattice task create "<title>" --current [--parent <id>]
lattice task info <id>
lattice task start <id>
lattice task checkpoint <id> --type <type> --title "..." -m "..."
lattice task progress <id> [--last <n>] [--type <type>]
lattice task associate <id> [--current] [--paths ...] [--project <id>]
lattice task complete <id>
lattice task archive <id>
lattice context --task <id>
```
