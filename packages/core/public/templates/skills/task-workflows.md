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

### 参考近似任务

任务开始后，应主动搜索已完成的近似任务作为参考：

```bash
lattice search "<当前任务标题或核心关键词>" --type task --json
```

根据搜索结果和当前任务的复杂性，自行判断需要参考多少个近似任务的 PRD：

- **简单/常规任务**（模式清晰、涉及范围小）：参考 1 个最相关的已完成任务 PRD 即可
- **中等复杂任务**（涉及多个模块或需要理解上下文模式）：参考 2~3 个相关任务 PRD
- **高复杂任务**（架构级变更、跨模块协作、首次涉足的领域）：参考 3~5 个相关任务 PRD，必要时还应查看它们的 `design.md` 和 `progress.yaml`

判断依据：
- 搜索结果中 score 较高且与当前任务领域/模式高度相关的优先参考
- 如果当前任务是某类模式的重复应用（如"适配 X 能力"），应参考同类已完成任务了解标准做法
- 如果当前任务涉及此前未触及的架构或概念，应广泛参考多个相关任务建立认知

不要机械地固定只看 1 个任务。参考数量应与任务复杂性匹配。

### 自动关联实际工作项目路径

任务执行过程中，AI 应**主动判断并关联**当前实际围绕哪个项目路径在工作，而不是仅依赖创建时的 `--current` 关联。

**为什么**：`lattice task create --current` 只关联创建任务时所在的项目。但实际工作中，AI 可能在另一个项目目录下操作文件、编辑代码，或在多个项目间切换。如果不主动关联，任务元数据中的 `projects` / `scopePaths` 与实际工作范围会脱节，导致搜索和上下文丢失。

**触发时机**（满足任一即应执行关联）：

1. 任务开始后，当前工作目录对应的项目**不在** `task.json` 的 `projects` 列表中
2. 对话中 AI 打开、编辑或搜索了某个路径下的文件，且该路径对应的项目尚未关联
3. 用户明确提到在某个项目/目录下操作
4. 任务涉及多个项目协作，中途切换到新的项目目录工作

**执行方式**：

```bash
# 关联当前工作目录对应的项目
lattice task associate <task-id> --current

# 关联指定路径（AI 判断实际工作目录）
lattice task associate <task-id> --paths <path>

# 关联已知的项目 ID
lattice task associate <task-id> --project <project-id>
```

**行为原则**：

- 这是**静默执行**的辅助动作，不需要每次都向用户确认——除非 AI 对关联判断不确定
- 如果 `lattice task associate --current` 报告当前路径已在 `projects` 或 `scopePaths` 中，不需要重复执行
- 关联后无需额外告知用户，除非关联了**意料外**的项目（此时应简短说明）
- 任务归档时，最终的 `projects` 和 `scopePaths` 应完整反映本次任务实际触及过的所有项目

**典型场景**：

- 用户说"适配 X 能力包到 Y 项目"，创建任务时在 Lattice 仓库目录下（关联了 Lattice），但实际编辑的代码在 `/Users/a1/qcqx/sdk-xxx/` 目录 → 应自动 `task associate --paths /Users/a1/qcqx/sdk-xxx/`
- 任务涉及修改 A 项目的组件并在 B 项目中消费 → 两个路径都应关联
- 用户在对话中贴出了 `/some/path/src/xxx.ts` 并要求修改 → 判断该路径属于哪个项目并关联

### 完善 PRD

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

整体原则：**精简但不静默**。"精简"是指不要长篇复述 CLI 输出、不要罗列每一步命令；但在关键阶段必须给出简短说明，不能一路静默地连续跑 CLI。

### 阶段性输出（必须）

执行任务相关命令的过程中，到达以下关键节点时必须立即输出一段简短说明（一般 2~5 行），不要等所有步骤都跑完再统一汇报：

- **任务创建完成后**：说明最终任务标题（特别是从非 ID 参数归纳出来的情况）、新任务 ID、父任务 ID（如有）、创建时关联的项目
- **任务启动 / 切换状态后**：说明当前状态（`in_progress` / `archived` 等）
- **关联项目发生变化时**（执行了 `task associate`）：说明当前最新的关联项目列表
- **发现相似进行中任务时**：先停下来把候选列给用户确认，不要直接新建
- **归档完成后**：说明归档结果及补充进 PRD 的总结要点

### 整体输出

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
