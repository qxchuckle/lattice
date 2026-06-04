# 任务工作流

本文件用于处理任务的创建、开始、进展追踪、完成和归档。

## 目标

- 让当前会话和任务状态保持一致
- 把任务上下文接入当前工作
- 在任务执行过程中持续记录关键进展，确保跨会话不丢失上下文
- 在任务结束时判断是否需要沉淀新的 spec

## 任务目录与文件约定

每个任务的数据存储在：

```
~/.lattice/users/<username>/tasks/<task-id>/
├── task.json       # 任务元数据
├── prd.md          # 任务主文档（收敛型内容：目标、约束、方案、索引）
├── progress.yaml   # 进展日志（追加型内容：决策、问题、摘要）
├── design.md       # 方案讨论记录（发散→收敛：候选方案、利弊对比、决策推演）
└── ...             # 可拆分的子文档
```

- `prd.md`：记录收敛型内容——目标、约束、关键设计、最终方案概览、文件索引
- `progress.yaml`：记录追加型过程信息——决策、问题、方案调整、会话摘要、里程碑
- `design.md`：记录方案讨论过程——候选方案对比、利弊分析、被否决方案及理由、最终结论
- 三者职责不重叠：PRD 管"最终是什么"，progress 管"发生了什么"，design 管"怎么讨论出来的"
- **`prd.md` 不得包含 YAML frontmatter 元数据**（如 id、title、status、created_at、projects 等）。这些信息的唯一来源是 `task.json`，在 PRD 中重复会导致数据不一致且增加维护负担

`lattice task create` 和 `lattice task info` 会输出 PRD 的完整路径。你应直接使用该路径读写 PRD 文件。

## 任务阶段与模式

一个任务可以在 design（讨论）和 implementation（实施）模式之间切换：

```
design（讨论收敛）→ start（开始实施）→ design（中途讨论）→ 继续实施 → archive（收尾）
```

- **design 模式**：只读代码 + 分析提案，不修改业务代码文件。讨论内容记录到 `design.md`
- **implementation 模式**：可以修改代码。即 `start` 后的默认状态
- design 可以多次进出，每次讨论追加到 `design.md`
- design 也可以是任务的第一个入口（无需先 start），此时会自动创建任务
- **隐式触发**：即使用户没有显式执行 `/lattice/task/design`，只要当前对话中出现了方案讨论、设计对比、架构决策等内容，AI 也应主动将讨论过程和结论追加到 `design.md`

## 常见流程

### 需要建立任务链路时

如果一个任务明显属于另一个任务的后续步骤，优先在创建时指定父任务，而不是只在 PRD 里靠文字描述关系。

- 创建子任务时使用：

```bash
lattice task create "<title>" --current --parent <parent-task-id>
```

- 需要查看当前任务在整条链路中的位置时，使用：

```bash
lattice task lineage <task-id>
lattice task tree <task-id>
lattice task tree <task-id> --descendants
```

- 需要修改任务归属时，使用：

```bash
lattice task update <task-id> --parent <parent-task-id>
lattice task update <task-id> --clear-parent
```

- 如果某个任务仍然挂着子任务，不要直接删除或忽略它的链路关系；先迁移、清空或完成这些子任务，再继续后续操作。

### 已有任务 ID

运行：

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

### 只有非 ID 参数

先结合命令参数和当前对话，总结出一个简洁、明确的任务标题。

- 不要直接把原始命令参数当作任务标题
- 尤其不要把文件路径、文件引用、长段描述或命令噪音原样塞进标题
- 如果命令参数只是线索，可以结合当前会话主题补全为更合适的标题

如果当前目录是已注册项目，运行：

```bash
lattice task list --current
lattice search "<总结出的任务标题>" --project <project-id> --type task --json
```

先判断当前项目中是否已有相似且状态为 `in_progress` 的任务。

- 如果有，先提醒用户是否其实要继续已有任务
- 只有在没有相似进行中任务，或用户明确要求新建时，才运行：

```bash
lattice task create "<总结出的任务标题>" --current
```

拿到任务 ID 后，再运行：

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

开始任务后，应主动完善该任务的 `prd.md`，并运行 `lattice rag update` 确保新任务被索引。

- 不要停留在默认生成的空白标题
- PRD 只记录收敛型内容：任务目标、约束、当前方案、关键待办和文件索引
- `prd.md` 可以只承担任务主入口职责，不必把所有细节都堆在一个文件里
- 当单个任务过大、`prd.md` 已经过长，或任务天然分成多个步骤时，可以把详细设计、计划、阶段记录、复盘等拆到该任务目录下的其他 Markdown 文件中，再由 `prd.md` 负责摘要、索引和跳转
- 如果用户后续补充了设计、约束、边界条件、方案取舍或新的阶段结论，要自行判断是否需要同步更新 PRD
- 如果在任务执行过程中发现实际涉及的项目范围发生变化，也要同步更新任务元数据里的 `projects` 字段
- 当任务理解发生变化时，优先更新 PRD，再继续后续实现或分析

### 任务进展追踪

任务执行过程中，应主动通过 `lattice task checkpoint` 记录关键进展。这是确保跨会话上下文不丢失的核心机制：

```bash
lattice task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

可用类型：

| type | 含义 | 典型场景 |
|------|------|----------|
| `decision` | 设计/技术决策 | 确认方案、选型、取舍 |
| `issue` | 发现问题/踩坑 | Bug、兼容性问题、性能瓶颈 |
| `pivot` | 方案调整 | 从 A 方案切换到 B 方案 |
| `summary` | 会话/阶段摘要 | 会话结束、阶段性总结 |
| `milestone` | 里程碑达成 | 模块完成、测试通过 |
| `note` | 一般记录 | 其他值得记住的信息 |

**隐式触发时机**（Agent 应主动执行，无需用户显式要求）：

- 用户确认了一个设计决策或技术选型
- 发现了意料外的问题、Bug 或兼容性坑
- 方案从 A 调整为 B（pivot）
- 一个阶段性目标完成（模块实现完毕、测试通过等）
- 会话即将结束，或用户表示“先到这”“下次继续”
- 用户反馈了重要约束或修正

**注意：** 不要在每次对话轮都记录，只在有实质性进展时记录。

查看已记录的进展：

```bash
lattice task progress <task-id>              # 全部
lattice task progress <task-id> --last 3     # 最近 3 条
lattice task progress <task-id> --type decision  # 只看决策
```

新会话 resume 任务时，应读取最近进展快速对齐上下文：

```bash
lattice context --task <task-id>
lattice task progress <task-id> --last 5
```

### 任务完成时

归档前必须先建立对任务全貌的完整认知，再产出总结。**严格按"先读后写"顺序执行**：

**第一步：前置信息采集（必须完成才能写总结）**

```bash
# (a) 读取任务元数据，拿到 PRD 路径
lattice task info <task-id>

# (b) read_file 读取 prd.md 完整内容，了解当前方案和已有内容

# (c) 读取全部进展记录，了解决策历程和已记录的里程碑
lattice task progress <task-id>

# (d) read_file 读取 design.md（如存在），了解方案讨论历史

# (e) 回顾当前对话上下文中产生的决策、方案变更和最终结论
```

**为什么**：如果没有先读 PRD 原文和 progress 历史就直接写归档总结，极容易遗漏关键决策、重复已有内容、或与实际进展脱节。

**第二步：更新 PRD**

在完成前置信息采集后，再更新该任务的 `prd.md`：

- 查看 progress 中的关键决策和问题是否已在 PRD 中体现
- 补充最终采用的设计或执行方案
- 记录关键结果、主要取舍和仍待后续处理的问题
- 增加"任务完成总结"，明确这次任务实际交付了什么
- 如果 `prd.md` 过长，可以把详细复盘内容拆到其他 Markdown 文件中渐进式加载；但 `prd.md` 仍必须作为必要入口

**第三步：完成并归档**

```bash
lattice task complete <task-id>
lattice task archive <task-id>
lattice rag update
```

**第四步：二次审阅（归档后必做）**

归档完成后，重新审视刚写入的 PRD 总结和 progress 记录，检查是否有遗漏：

- 当前对话中产生的关键决策、方案变更是否全部体现在 PRD 或 checkpoint 中
- 是否有"做了但忘记写"的改动、取舍或遗留问题
- 本次任务形成的经验是否已判断要不要沉淀为 spec
- 如果发现遗漏，立即补充到 PRD 或追加 checkpoint，然后再次 `lattice rag update`

归档后运行 `rag update`，因为 PRD 通常在归档前补充了完成总结，需要重新索引。如果 `rag update` 报错，降级使用 `lattice rag rebuild`。

如果用户没有提供任务 ID，或提供的内容不是任务 ID，则先运行：

```bash
lattice task list --current
lattice search "<根据当前对话和命令参数总结出的任务标题或主题>" --project <project-id> --type task --json
```

先在当前项目中找出 `in_progress` 的候选任务，并结合当前对话判断哪个任务最可能是本次会话正在结束的任务。

**自动归档（无需确认）**：如果满足以下全部条件，直接归档：

1. `in_progress` 任务只有一个，或虽有多个但其中一个与当前对话主题高度匹配
2. 当前对话确实围绕该任务做了实质性工作
3. AI 对匹配结果有足够把握

满足时直接告知用户"确认当前会话对应任务是 XXX，现在进行归档"，然后执行归档流程。

**需要确认**：有多个候选且无法确定唯一匹配、或对话未围绕明确任务展开时，列出候选任务请用户确认。

- 如果没有明显候选，不要擅自归档，先把候选任务列给用户确认
- 如果当前没有匹配的可归档任务，也可以告诉用户：如果需要，可以根据当前对话先新建一个任务，补上必要描述和完成总结后再归档

## 归档前判断

在总结中补充：

- 本次任务是否形成了长期规则
- 这些规则更适合项目级、用户级还是全局级
- 是否需要更新对应 spec

## 相关命令

```bash
lattice task list
lattice task list --current
lattice task list --current --all-user
lattice task list --current --user <users>
lattice task create "<title>" --current
lattice task create "<title>" --current --parent <task-id>
lattice task update <id> --add-project <project-id>
lattice task update <id> --parent <task-id>
lattice task update <id> --clear-parent
lattice task tree <id>
lattice task tree <id> --descendants
lattice task lineage <id>
lattice task start <id>
lattice task checkpoint <id> --type <type> --title "..." -m "..."
lattice task progress <id>
lattice task progress <id> --last <n>
lattice task progress <id> --type <type>
lattice task complete <id>
lattice task archive <id>
lattice task reopen <id>
lattice task delete <id>
lattice context --task <id>
lattice rag update
```

## 输出要求

- 明确任务 ID、当前状态和关联项目
- 如果任务标题是根据非 ID 参数归纳出来的，明确告诉用户采用了什么标题
- 提炼任务最关键的约束与背景
- AI / Agent 调用 `lattice search` 查找候选任务时优先带上 `--json`，再根据结构化字段做判断
- 如果发现相似进行中任务，先提醒用户确认是否继续已有任务
- 如果任务执行中更新了关联项目，明确告诉用户 `projects` 字段已同步更新以及当前关联项目列表
- 开始任务后主动完善并持续维护该任务的 `prd.md`
- 即使拆分了 PRD，也保持 `prd.md` 作为必要入口
- 如果用户未提供归档目标，先确认当前会话对应的进行中任务，再执行归档
- 如果没有匹配的可归档任务，明确告诉用户当前没有候选，并补充可以根据当前对话先新建任务再归档
- 归档前先更新 `prd.md`，补上任务完成总结
- 即使归档时 PRD 已拆分，也通过 `prd.md` 回写最终总结和入口索引
- 结束任务时给出是否需要沉淀 spec 的判断
