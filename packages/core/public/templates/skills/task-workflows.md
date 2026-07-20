# 任务工作流

本文件定义 Lattice 任务全流程的所有 AI 触发条件锚点。每个一级 `##` 章节标题就是 AI 可机械识别的"何时打开本段"触发点；章节顶部 `> 何时读 / 下一步` 一句话进一步明确触发条件与读完后的去向。

> **本文权威范围**：任务全生命周期 / 实施期多轮循环细节 / checkpoint 11 类语义与触发 / 归档闭环。系统级硬约束清单见 [lattice-rules.md](lattice-rules.md)（其每条强制规则末尾的 anchor 直接跳到本文相应章节展开）；spec 概念 / 读写 / 沉淀判定见 [spec-workflows.md](spec-workflows.md)。
>
> 本文**不复述** `lattice-rules.md` 的硬约束清单形态，也不复述 `SKILL.md` 的索引维护 / 终端输出 / --force 三段权威源。

## 任务目录与文件结构

> 何时读：第一次创建 / 打开任务，或不确定 task.json / prd.md / progress.yaml / design.md 各自职责时 → 下一步：进入「任务模式：design vs implementation」判断本任务的运行模式。

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

## 任务模式：design vs implementation

> 何时读：收到 `/lattice/task/design` 或 `/lattice/task/start`，或会话中出现方案讨论时 → 下一步：若是 implementation 模式，跳到「task start 后的起手动作」；若是 design 模式，参照本节约束行事直到用户明确"开始实施"。

```
design（讨论）→ start（实施）→ design（中途讨论）→ 实施 → archive（收尾）
```

- **design 模式**：只读 + 分析，禁改业务代码，讨论写入 design.md
- **implementation 模式**：start 后默认状态，可改代码
- 未显式进入 design 但出现方案讨论时，主动追加到 design.md

design 模式具体允许 / 禁止动作的硬约束清单见 [lattice-rules.md §二 Design 模式约束](lattice-rules.md#二design-模式约束)。

> **fast-start 模式**：`/lattice/task/fast-start` 是 `task/start` 的轻量变体（不创建任务 / PRD / checkpoint），完整工作流见独立文档 [fast-start-workflows.md](fast-start-workflows.md)。

## 命令参数不是任务 ID 时：标题归纳与查重

> 何时读：`task create` / `task start` 收到的参数是描述 / 关键词 / 文件引用 / 需求段（不是已存在的任务 ID）时 → 下一步：拿到任务 ID 后跳到「task start 后的起手动作」。

0. **项目定位（前置，必做）**：从用户输入中提取项目路径或语义描述，先定位实际工作项目：
   - 提供了路径（文件 / 目录 / 包名）→ `ltc project where <path>`
   - 提供了语义描述（需求段 / 项目名关键词）→ AI 抽取关键词 + 自由补充 → `ltc project list --search <keyword>`（可多次搜）
   - 定位到项目 → 后续 create 用 `--project <id>`；无路径无语义描述 / 定位无结果 → 默认 `--current`
   - 定位到的项目与当前目录项目是否一致无需比对：若一致，`--project <id>` 与 `--current` 等价
1. 归纳简洁标题
2. `ltc task list --current` + `ltc search "<标题>" --project <project-id> --type task --json` 查重
3. 有相似 in_progress 任务 → 先停下列候选给用户确认
4. `ltc task create "<标题>" [--current | --project <id>] [--parent <parent-task-id>]`（参数由第 0 步定位结果决定）

## 父子任务

> 何时读：当前任务是另一任务的拆分 / 后续 / 子主题时 → 下一步：创建后回到「task start 后的起手动作」。

```bash
ltc task create "<title>" [--current | --project <id>] --parent <parent-task-id>
ltc task lineage <task-id>
ltc task tree <task-id> [--descendants]
ltc task update <task-id> --parent <parent-task-id>
ltc task update <task-id> --clear-parent
```

## task start 后的起手动作

> 何时读：`ltc task start` 执行完毕后必跑 → 下一步：进入「实施期多轮对话循环」。

```bash
ltc task start <task-id>
ltc context --task <task-id> --query "<任务标题/主题关键词>"
```

1. 按主题选读相关 spec（→ [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)）——分两步：先从 context 列表按标题/描述选读，再 `ltc search "<任务关键词>" --json` 语义搜索补漏
2. 从搜索结果中参考近似历史任务 PRD（提供“之前怎么做的”参考）
3. 完善 PRD（目标、约束、方案、文件索引）
4. 如有 design.md 先 read_file
5. 给用户输出整体确认（任务 ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束）

## 实施期多轮对话循环（每轮用户输入到来时）

> 何时读：每一轮用户新输入到来时机械执行（不能跳步） → 下一步：本轮所有步骤完成后等待下一轮用户输入。

```
用户输入
  ↓
步骤 1：PRD 同步硬触发清单（T1~T8）命中任意一项？
  └─ 是：read_file prd.md → search_replace prd.md → 打 decision/pivot checkpoint → 才进入下一步
  ↓
步骤 2：spec 选读触发条件命中？
  └─ 是：read_file 精读相关 spec
  ↓
步骤 3：写代码（动作锚点：≥3 个业务文件 → 先校对 PRD 文件索引）
  ↓
步骤 4：打 checkpoint（打点前必过 PRD 自检）
```

### PRD 同步硬触发清单（T1~T8）

> 步骤 1 判断本轮是否命中。命中即先 `read_file prd.md` → `search_replace prd.md` 修订对应段落 → 打 decision / pivot checkpoint → 才进入下一步。

| # | 触发条件 |
|---|----------|
| T1 | 用户提出新需求 / 修改需求 / 推翻方案 |
| T2 | 决定采用 / 否决一个技术方案 |
| T3 | 新增 / 移除一个修改文件 |
| T4 | 单轮将要改 ≥3 个业务文件 |
| T5 | 发现意料外的兼容性 / 边界 / 迁移问题 |
| T6 | 引入新依赖 / 模块边界 / 跨包调用 |
| T7 | 准备打 milestone checkpoint |
| T8 | 在 PRD 中写入了项目路径 / 包名 / spec 引用，但 task.json 的 projects / scopePaths / spec 引用未同步 |

### spec 选读触发条件

> 步骤 2：本轮涉及之前没读过的模块 / 概念 / 规范分层时打开本段 → 下一步：read_file 精读相关 spec 后进入步骤 3。

> **每轮必检，非一次性**：spec 精读不是起手读完就结束。实施期每一轮都检查下列触发条件，发现新的相关 spec 即时 `read_file` 补读。

满足任一即触发：

- 本轮主题词第一次出现（之前对话未涉及）
- 用户提到“规范 / 约定 / 历史 / 类似 / 跨项目”
- 涉及项目级 / 用户级 / 全局级规则的层级判定（→ [spec-workflows.md#层级](spec-workflows.md#层级)）
- 涉及之前未涉及的项目模块边界 / 跨包调用
- 遇到实现困难 / 多方案分支需要决策——通过 `ltc search` 查找相关 spec 或历史任务，学习已有经验再动手

触发后的动作不仅是读已知 spec，还应**活用 `ltc search`** 搜索本轮新出现的关键词，发现起手时未识别的相关 spec 或历史任务经验。

### 写代码前的动作锚点

> 步骤 3：本轮要 `search_replace` 或 `create_file` 的业务文件 ≥ 3 个时打开本段 → 下一步：read_file PRD 校对完毕后才执行编辑动作。

- 必须先 `read_file prd.md` 校对「修改文件索引」段
- 索引中缺失文件 → 命中 T3，回到步骤 1 先改 PRD
- 索引中已有但本轮无需修改 → 在 PRD 中标注为"本轮跳过"

### 打 checkpoint 前的 PRD 自检

> 步骤 4：每次打 checkpoint 前必做 → 下一步：自检通过后再 `ltc task checkpoint` 命令；命中任一未同步项必须先 `search_replace prd.md` 再打点。

打 checkpoint 前必须确认：

- 本轮改动的文件是否已在 PRD 文件索引中
- 本轮决策是否已写入 PRD「当前方案」段
- 是否命中硬触发清单（T1~T8）但 PRD 未同步

命中即先改 PRD 再打点。checkpoint 是追加型过程日志，不能替代 PRD；决策必须同时写入 PRD 和 checkpoint。

### 强制规则（与 lattice-rules.md §三 双向同步）

> 何时读：实施期任意时刻发现自己即将违反硬约束时 → 下一步：跳回 [lattice-rules.md §三 实施期循环](lattice-rules.md#三实施期循环) 复核每条规则的后果锚点。

1. PRD 是活体快照，命中硬触发立即更新，不拖到归档（→ lattice-rules.md §三 第 1 条）
2. PRD 永不落后于代码：先改 PRD 再改代码（→ lattice-rules.md §三 第 1 条）
3. 新主题先精读相关 spec（→ lattice-rules.md §三 第 3 条）
4. 代码改完必须打 checkpoint，连续 5 个小修改至少 1 个 milestone / note（→ lattice-rules.md §三 第 4 条）
5. 用户推翻方案 = 先改 PRD 再打 pivot checkpoint（→ lattice-rules.md §三 第 5 条）
6. 过程中发现可复用内容 → 立即询问用户是否沉淀为 spec（→ lattice-rules.md §三 第 6 条 / [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)）
7. 及时打 checkpoint：用户提供实质性信息、AI 做出关键推断、发生客观事件、AI 自身犯错时，当轮打对应类型（→ lattice-rules.md §三 第 7 条）
8. 单输入含多语义切片 → 拆为多条不同类型 checkpoint 并发记录（→ lattice-rules.md §三 第 8 条）

颗粒度兜底：连续 3 轮未产生任何 checkpoint → 必须补一条 `note`。

## checkpoint 类型与触发条件

> 何时读：决定本轮要打什么类型 checkpoint 时 → 下一步：执行 `ltc task checkpoint <id> --type <type> --title "..." -m "..."`。

```bash
ltc task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

11 类，按信息来源分三组，完全正交（多类型是互补记录，不是重复记录）：

### 用户输入类（3）—— 用户在对话中主动提供的信息

| type | 作用 | 何时打 | 格式要点 |
|---|---|---|---|
| `context` | 保存用户提供的背景·需求·场景·领域知识，防止长对话遗忘 | 用户给出项目背景、业务规则、技术约束等实质信息时 | ≤200字原样；200~800字概述+关键引言；>800字要点3~5条+来源指针 |
| `correction` | 记录纠错全过程，确保同类错误不再犯 | 用户指出 AI 做错了，或 AI 自己发现犯错时 | **强制三段**：做错了什么 · 为什么错 · 正确做法 |
| `constraint` | 明确记录红线，后续所有动作必须遵守 | 用户施加了"不许做 X"或"必须用 Y"等硬约束时 | 明确"不要什么"或"必须什么" |

### AI 判断类（3）—— AI 自身产生的推断与记录

| type | 作用 | 何时打 | 格式要点 |
|---|---|---|---|
| `assumption` | 暴露隐含推断，便于日后用户校正 | AI 在用户未明说时做出了影响方向的关键假设 | 明确"推断了什么"与"被推翻会怎样" |
| `followup` | 登记待办，防止被遗忘 | AI 识别出应做但当前轮次主动延后的事项 | 明确"为何现在不做" |
| `note` | 记录客观事实，亦作颗粒度兜底 | 从代码/环境/工具调用获得的值得保留的事实；或连续 3 轮无 checkpoint 时兜底 | 事实需注明来源 |

### 进程事件类（5）—— 任务推进中发生的客观事件

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

### 被否决方案的去向

被否决的方案写入 design.md，progress.yaml 不重复记录。

### 查看进展

```bash
ltc task progress <task-id> [--last <n>] [--type <type>]
```

## 项目关联同步

> 何时读：任务刚 start 后 / 编辑了新项目文件 / 中途切换项目目录 / 归档前复核时 → 下一步：按场景选择 `task associate` 参数，让 task.json 的 projects/scopePaths 反映实际工作范围。

任务创建时的项目定位见「命令参数不是任务 ID 时」第 0 步。本节聚焦任务进行中新增 / 调整项目关联的场景。

按任务实际涉及的项目选择参数：

| 场景 | 命令 |
|---|---|
| 任务在当前工作目录对应的项目范围内 | `ltc task associate <task-id> --current` |
| 任务目标是另一个已注册项目（与当前目录无关） | `ltc task associate <task-id> --project <project-id>` |
| 任务涉及的路径不是已注册项目 | `ltc task associate <task-id> --paths <path>` |

获取目标项目 ID：到目标项目目录下运行 `ltc context` / `ltc status`，或用 `ltc project where <path>` / `ltc project list --search <keyword>` 查询。不要用 `--current` 关联到与任务无关的当前目录项目。

发现任务涉及新路径 / 新项目时当轮执行，不延后。只有关联了用户可能未预期的项目时才输出说明。

### spec 引用同步

实施时参照了某 spec → 用 `ltc task ref-spec` 记录到 task.json：

```bash
ltc task ref-spec <task-id> <spec-name>     # 支持文件名 / 标题模糊匹配
ltc task unref-spec <task-id> <spec-id>      # 移除引用
```

### 元数据与 PRD 一致性

**task.json 的 `projects` / `scopePaths` / spec 引用是机器可读的结构化元数据，PRD 中的自然语言描述不能替代 CLI 记录。** 当在 PRD 中写入了以下信息时，必须同时用 CLI 记录到 task.json：

| PRD 中写入的内容 | 必须执行的 CLI 命令 |
|---|---|
| 工作目录 / 文件路径 | `ltc task associate <task-id> --paths <path>` |
| 关联的项目名称 / ID | `ltc task associate <task-id> --project <project-id>` |
| 参照的 spec 名称 | `ltc task ref-spec <task-id> <spec-name>` |

### 项目间关系记录

任务涉及多个已注册项目时，检查项目间是否已有关系记录，无则推断并添加：

```bash
ltc project relation list <project-id>   # 查看当前项目已有关系
ltc project relation add <a> <b> --type <type> \
  --description "证据描述" --ai-inferred --from-task <task-id>
```

常见判定证据（详见 [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）：

| 现象 | 关系类型 |
|------|----------|
| 两项目共享 git first commit / fork | `forked-from` |
| package.json 中 A 直接 dependencies 引用 B | `depends-on` |
| 多项目共用同一 monorepo 包 | `shares-component` |
| 同组织相邻仓库，无强证据 | `related` |

发现关系后当轮记录，不延后到归档。

## 任务归档前置信息采集

> 何时读：`ltc task complete` 之前必读 → 下一步：写归档总结、打 summary checkpoint、执行「归档流程」。

禁止跳过：未读 PRD + progress + design.md 就写归档总结 = 必然遗漏关键决策。

```bash
ltc task info <task-id>                           # → read_file prd.md
ltc task progress <task-id>
ltc task progress <task-id> --type correction     # 用户纠错史
ltc task progress <task-id> --type constraint     # 用户边界史
ltc task progress <task-id> --type context        # 用户背景史
# read_file design.md（如存在）
# 审查代码变更（git diff --stat）
```

PRD 补全内容：最终方案 + 任务完成总结 + 遗留事项。

## 归档流程

> 何时读：「任务归档前置信息采集」+ PRD 补全 + summary checkpoint 完成后 → 下一步：执行「归档后的二次审阅与 spec 沉淀判定」。

```bash
# 1. 前置信息采集（详见上一节）
# 2. 更新 prd.md：补最终方案 + 任务完成总结 + 遗留
# 3. summary checkpoint
ltc task checkpoint <task-id> --type summary --title "..." -m "..."
# 4. 完成 + 归档
ltc task complete <task-id>
ltc task archive <task-id>
# 5. ltc rag update（→ SKILL.md#索引维护）
# 6. 二次审阅 + spec 沉淀判定（详见下一节）
```

## 归档后的二次审阅与 spec 沉淀判定

> 何时读：`archive` 完成后必跑 → 下一步：发现遗漏立即补充 PRD / 补打 checkpoint / `ltc rag update`；判定为可沉淀经验时跳到 [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定) 走沉淀流程。

二次审阅对照 progress 和对话检查：

- 关键决策是否全部体现在 PRD 或 checkpoint
- 是否有遗漏改动
- 经验是否已判断要不要沉淀为 spec（见 [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)）
- 任务中是否发现了未记录的项目间关系 → 补充 `ltc project relation add`（详见 [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）

发现遗漏立即补充 + `ltc rag update`。

## 命令参数为空时的归档推断规则

> 何时读：`/lattice:task:archive` 不带参数时 → 下一步：根据推断结果归档单一候选，或列候选给用户确认。

- `ltc task list --current` + `ltc search "<对话主题>" --type task --json`
- in_progress 仅 1 个且与当前对话匹配 → 直接归档
- 多个候选 → 列给用户确认

## 输出原则：精简但不静默

> 何时读：实施期任意 CLI 调用后、或一次会话连续运行多条 ltc 命令时 → 下一步：按本段格式给出简短说明（2~5 行），不长篇复述 CLI 输出。

**精简的含义**：不长篇复述 CLI 原始输出、不罗列每步执行了哪条命令、不贴 search 全部 JSON。

**不静默的含义**：关键节点必须立即输出 2~5 行简短说明：

- 任务创建后（标题 + ID + 父任务 ID + 关联项目）
- 状态切换后（task start / complete / archive）
- 关联项目变化后
- 发现相似 in_progress 任务时（先停下列候选给用户确认）
- 归档完成后（结果 + 补进 PRD 的总结要点）

**最终确认**：进入实际实施工作前再补一段整体确认：任务 ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束。

## 命令速查

> 何时读：需要查 task 子命令参数语法时 → 下一步：完整参数与字段含义见 [command-reference.md](command-reference.md)。

```bash
ltc task list [--current] [--all-user]
ltc task create "<title>" [--current | --project <id>] [--parent <id>]
ltc task info <id>
ltc task start <id>
ltc task checkpoint <id> --type <type> --title "..." -m "..."
ltc task progress <id> [--last <n>] [--type <type>]
ltc task associate <id> [--current] [--paths ...] [--project <id>]
ltc task complete <id>
ltc task archive <id>
ltc context --task <id> --query "<任务主题>"
```

> `--current` 基于当前工作目录解析项目。**写入类**（`task create` / `task associate`）：用户提供了路径/语义描述时必须先 `ltc project where` / `ltc project list --search` 定位，定位到用 `--project <id>`（见「命令参数不是任务 ID 时」第 0 步）。**读取类**（`task list`）：与当前目录无关时用 `--project <id>`。
