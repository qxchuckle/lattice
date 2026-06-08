# 任务工作流

本文件是 Lattice 中所有 **任务全流程概念**的权威源（任务目录约定、多轮对话循环、checkpoint 类型、归档前置信息采集、输出原则）。其他文档（含 platforms/lattice-rules.md、commands/task/*.md）应通过锚点引用本文件，不再重复定义。

spec 相关概念（双重职能 / 选读 / 沉淀判定）见 [spec-workflows.md](spec-workflows.md)。

## 任务目录与文件约定

每个任务的数据存储在：

```
~/.lattice/users/<username>/tasks/<task-id>/
├── task.json       # 任务元数据（id、title、status、projects、scopePaths 等的唯一来源）
├── prd.md          # 任务主入口：收敛型内容（目标、约束、最终方案、文件索引）
├── progress.yaml   # 进展日志：追加型过程信息（决策、问题、摘要、里程碑）
├── design.md       # 方案讨论记录（候选方案、利弊对比、被否决方案及理由、最终结论）
└── ...             # 可拆分的子文档
```

**职责不重叠**：PRD 管"最终是什么"，progress 管"发生了什么"，design 管"怎么讨论出来的"。

> ⚠️ `prd.md` **不得包含 YAML frontmatter 元数据**（id / title / status / created_at / projects 等）。这些信息的唯一来源是 `task.json`，PRD 中重复会导致数据不一致。

> `lattice task create` 和 `lattice task info` 会输出 PRD 完整路径，直接使用该路径读写。

## 任务阶段与模式

```
design（讨论收敛）→ start（开始实施）→ design（中途讨论）→ 继续实施 → archive（收尾）
```

- **design 模式**：只读代码 + 分析提案，不修改业务代码。讨论内容写入 `design.md`。详见 lattice command `task/design.md`
- **implementation 模式**：可改代码（`start` 后默认状态）
- **隐式触发 design 记录**：即使未显式 `/lattice/task/design`，只要对话出现方案讨论 / 设计对比 / 架构决策，AI 应主动将讨论追加到 `design.md`（不受"禁止改代码"约束）

## 标题归纳与查重

当命令参数不是任务 ID（描述、关键词、文件引用、需求段）时，**统一遵循**：

1. **归纳标题**：结合命令参数和当前对话总结出简洁明确的任务标题
   - ❌ 不要直接把原始命令参数当标题
   - ❌ 尤其不要把文件路径、文件引用、长段描述、命令噪音原样塞进标题
2. **查重相似进行中任务**：

   ```bash
   lattice task list --current
   lattice search "<归纳出的标题>" --project <project-id> --type task --json
   ```

3. **判断**：若有相似 `in_progress` 任务，**先停下来**把候选列给用户确认；只有无相似任务或用户明确要新建时才创建
4. **创建（如需要）**：

   ```bash
   lattice task create "<标题>" --current
   # 如果是某既有任务的明确后续/拆分，补上父任务关系：
   lattice task create "<标题>" --current --parent <parent-task-id>
   ```

## 任务链路（父子任务）

任务明显属于另一个任务的后续步骤时，优先在创建时指定父任务，**不要只在 PRD 文字描述关系**：

```bash
lattice task create "<title>" --current --parent <parent-task-id>
lattice task lineage <task-id>            # 查看链路
lattice task tree <task-id>               # 整颗树
lattice task tree <task-id> --descendants # 后代树
lattice task update <task-id> --parent <parent-task-id>  # 修改归属
lattice task update <task-id> --clear-parent             # 清空父任务
```

> 任务仍挂着子任务时，不要直接删除或忽略链路；先迁移、清空或完成子任务再继续。

## 实施期多轮对话循环（必做）

任务一旦 `lattice task start`，进入"实施期"。任务进行中用户通常会有多轮对话——补充想法、调整需求、修改方案、提新约束。

**任何此类输入到来时必须按以下顺序处理，不能跳步直接改代码**：

```
用户输入
  ↓
是否影响目标 / 范围 / 约束 / 方案 / 取舍 / 文件清单 / 风险？
  ├─ 是：先 search_replace 改 prd.md + 打 decision/pivot checkpoint
  └─ 否：跳过 PRD 修订
  ↓
涉及之前没读过的模块 / 概念 / 规范分层？
  ├─ 是：read_file 精读相关 spec 正文（见 spec-workflows.md#按任务主题精读相关-spec-必做）
  └─ 否：跳过
  ↓
实际改代码 / 文件
  ↓
打 checkpoint 记录这一轮进展
```

### 强制规则

1. **PRD 永不能落后于代码**：用户提的任何"目标 / 边界 / 选型 / 取舍 / 文件清单 / 风险 / 新需求"变化，必须**先**反映到 prd.md，**再**改代码。"嘴上答应了、代码改了、PRD 没动" = 跨会话失忆的最大来源
2. **新主题先选读 spec**：本轮涉及未读过的模块或规范分层时必须 read_file 精读相关 spec
3. **代码改完必须打 checkpoint**：连续 5 个小修改也至少要 1 个 milestone/note checkpoint
4. **用户推翻方案 = 必须 pivot checkpoint**：默默实现新方案 = 丢失决策史
5. **过程中即沉淀 spec**：多轮对话中冒出长期可复用的项目认知 / 行为约束 / 流程范式 / 经验细节时，**立即询问用户是否沉淀为 spec**，不要拖到归档前

### 反模式

- 用户提了新约束 → AI 直接改代码、不更新 PRD → PRD 与代码漂移
- 连续对话 10 轮、改了 5 处代码 → 全程没 checkpoint → 进展无法跨会话恢复
- 引入新模块 / 新概念 → 不重新选读相关 spec 就动手 → 违反已有约定
- 任务中后期才意识到"原来还有 spec 应该读"

## checkpoint 类型与触发

```bash
lattice task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

| 工作单元类型 | type |
|---|---|
| 重要技术决策（方案选型 / 架构调整 / 用户拍板） | `decision` |
| 方案从 A 切到 B / 推翻原计划 | `pivot` |
| 阶段性成果交付（一组改动通过验证） | `milestone` |
| 发现问题 / 踩坑 / 兼容性事故 | `issue` |
| 调研发现 / 实验数据 / 一次性记录 | `note` |
| 任务收尾总结 | `summary` |

### 隐式触发时机（满足任一即必须 checkpoint）

1. 完成了一个 PRD 子任务 / 一个 P 级阶段
2. 用户明确拍板了某个决策点
3. 一次代码改动通过了构建 / 验证
4. 修改了 3 个以上文件或 100 行以上代码
5. 准备切换到另一个独立工作单元
6. 用户在多轮对话中给出了新约束 / 新想法 / 修改原方案
7. 发现意料外的问题 / Bug / 兼容性坑
8. 会话即将结束，或用户表示"先到这"

> **不要在每次对话轮都记录**，只在有实质性进展时记录。一次对话有多个值得记录的进展可以分多次调用。

### 查看进展

```bash
lattice task progress <task-id>            # 全部
lattice task progress <task-id> --last 3   # 最近 3 条
lattice task progress <task-id> --type decision
```

新会话 resume 任务时应读取最近进展快速对齐：

```bash
lattice context --task <task-id>
lattice task progress <task-id> --last 5
```

## 项目关联同步（实施期同步义务）

任务 `start` 后，AI 有义务**实时维护任务元数据中的项目关联**，使 `task.json` 的 `projects` / `scopePaths` 始终反映实际工作范围。

### 触发时机（与 checkpoint 平行，不依赖 checkpoint 触发）

1. 任务刚 start 后，当前工作目录对应的项目**不在** `projects` 中
2. 对话中 AI 打开、编辑或搜索了某个路径下的文件，且该路径对应的项目尚未关联
3. 用户明确提到在某个项目 / 目录下操作
4. 任务涉及多个项目协作，中途切换到新的项目目录工作
5. 任务完成前（归档闭环时）复核 `projects` 是否完整覆盖实际触及的所有项目

### 执行方式

```bash
lattice task associate <task-id> --current             # 关联当前目录对应的项目
lattice task associate <task-id> --paths <path>        # 关联指定路径（智能识别已注册项目）
lattice task associate <task-id> --project <project-id># 关联已知项目 ID
```

> 静默执行，不需要用户确认，不需要打 checkpoint。**只有关联了用户可能未预期的项目时才简短说明**。如果当前路径已在 `projects` 或 `scopePaths` 中则跳过。

> **违反信号**：任务归档时 `projects` 中只有创建时的项目，但对话中实际操作了其他项目路径的文件。

## 任务起手动作

获得任务 ID 后立即：

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

然后：

1. **按主题选读相关 spec**（必做）：见 [spec-workflows.md#按任务主题精读相关-spec-必做](spec-workflows.md#按任务主题精读相关-spec-必做)
2. **参考近似任务**：

   ```bash
   lattice search "<当前任务标题或核心关键词>" --type task --json
   ```

   根据复杂性参考不同数量已完成任务的 PRD：
   - 简单 / 常规：1 个最相关的
   - 中等复杂：2~3 个
   - 高复杂（架构级、跨模块、首次涉足）：3~5 个，必要时还看它们的 `design.md` 和 `progress.yaml`

3. **完善 PRD**：不要停留在默认空白标题
   - 只记录收敛型内容（目标、约束、关键设计、最终方案、文件索引）
   - 单文件过长可拆到该任务目录下其他 Markdown，但 `prd.md` 必须保留为主入口（摘要、索引、跳转）
4. **如果有 design.md**：先 read_file 了解之前讨论的方案、约束和结论，避免重复或偏离

## 归档前置信息采集（强制，先读后写）

`/lattice/task/archive` 与 `lattice task complete` 前必须先建立对任务全貌的认知：

```bash
# (a) 读取任务元数据 + PRD 全文
lattice task info <task-id>
# → 拿到 PRD 路径后 read_file 读取 prd.md 完整内容

# (b) 读取全部进展记录
lattice task progress <task-id>

# (c) read_file 读取 design.md（如存在）了解方案讨论历史

# (d) 回顾当前对话上下文中的决策、方案变更、最终结论

# (e) 审查本次任务的代码变更（如项目使用 git）
#    见下方「归档时审查代码变更」节
```

> **禁止跳过**：未读 PRD + progress + design.md 就写归档总结 = 必然遗漏关键决策、重复已有内容、与实际进展脱节。

### 归档时审查代码变更

归档前应审查本次任务实际修改的代码，以确保 PRD、checkpoint 和 spec 沉淀判定完整覆盖所有变更。

**触发条件**：关联项目所在目录是 git 仓库且有明确的变更基准。如果不在 git 管理下或无法确定基准，跳过此步骤。

**执行步骤**：

1. **确定 diff 基准**（按优先级）：
   - 任务创建时间对应的 commit（`git log --after="<task-created-at>" --reverse --format=%H | head -1` 的前一个 commit）
   - 对话开始前的 HEAD commit（如果整个任务在单次会话完成）
   - 近期有意义的分支点（如 `main..HEAD`）
   - 无法确定时，使用未提交变更（`git diff --stat`）作为补充参考

2. **查看变更概览**：
   ```bash
   git diff --stat <base>..HEAD
   # 或查看未提交变更
   git diff --stat
   git diff --stat --cached
   ```

3. **审查关键文件**（不要求通读所有 diff，聚焦核心变更）：
   - 新增的文件 → 完整阅读（判断是否引入了新模式/约定）
   - 改动较大的核心文件 → 看 diff 或完整源码（确认架构决策是否已记录）
   - 配置文件变更 → 快速确认（是否引入了新依赖/新规则）
   - 纯格式化/重命名 → 知晓即可，不需深入

4. **产出**（融入归档流程）：
   - 发现的未记录改动 → 补充到 PRD 或追加 checkpoint
   - 识别出的新模式/约定/架构规则 → 纳入 spec 沉淀判定
   - 确认 PRD 中的文件索引是否覆盖所有实际变更的文件

> 注意：此步骤是**辅助判定**而非逐行 code review。目标是确保归档信息完整，而非审查代码质量。

## 归档闭环

```bash
# 1. 前置信息采集（见上）
# 2. 更新 prd.md：补充最终方案 + "任务完成总结"段落 + 关键结果 / 取舍 / 遗留问题
# 3. summary checkpoint
lattice task checkpoint <task-id> --type summary --title "..." -m "..."

# 4. 完成 + 归档
lattice task complete <task-id>
lattice task archive <task-id>

# 5. 索引更新
lattice rag update

# 6. 二次审阅（见下）
# 7. spec 沉淀判定（见下）
```

### 归档后二次审阅（强制）

重新审视刚写入的 PRD 总结和 progress 记录，对照 progress 和当前对话检查：

- 当前对话中的关键决策、方案变更是否全部体现在 PRD 或 checkpoint 中
- 是否有"做了但忘记写"的改动、取舍、遗留问题
- 本次任务形成的经验是否已判断要不要沉淀为 spec
- 发现遗漏 → 立即补充到 PRD 或追加 checkpoint，然后再次 `lattice rag update`

### spec 沉淀判定

按 [spec-workflows.md#沉淀判定统一标准](spec-workflows.md#沉淀判定统一标准) 执行：

- **必须沉淀**（用户显式行为指示 / 用户主动给出的项目认知）→ 立即调用 `/lattice/spec/update/*`
- **建议沉淀**（行为约束类 + 项目认知类，两类都要看）→ 判定核心问题：下次有人 / AI 进入这个项目还需要这条信息吗？
- 不沉淀的不强行沉淀

## 命令参数为空时的归档推断

如果用户没提供任务 ID 或参数不是 ID：

```bash
lattice task list --current
lattice search "<根据当前对话归纳的主题>" --project <project-id> --type task --json
```

### 自动归档（无需确认）

满足全部条件时直接归档：

1. `in_progress` 只有 1 个，**或**多个但其中一个与当前对话主题高度匹配
2. 当前对话确实围绕该任务做了实质性工作
3. AI 对匹配结果有足够把握

满足时直接告知"确认当前会话对应任务是 XXX，现在进行归档"再走归档流程。

### 需要用户确认

- 多个候选无法确定唯一匹配
- 对话未围绕明确任务展开
- AI 信心不足

→ 列出候选请用户确认。**没有匹配候选时**告诉用户当前没有合适候选，可以根据对话先新建任务再归档。

## 输出原则：精简但不静默

整体原则：**精简但不静默**。

- **精简**：不长篇复述 CLI 输出，不罗列每一步命令，不贴 search 全部 JSON 结果
- **不静默**：到达关键阶段节点必须立即输出 2~5 行简短说明，不要等所有步骤跑完才统一汇报

### 关键节点（必须输出）

| 节点 | 必说内容 |
|---|---|
| 任务创建完成后 | 最终采用的标题（特别是从非 ID 归纳的）+ 新任务 ID + 父任务 ID（如有）+ 关联项目 |
| 任务启动 / 切换状态后 | 当前状态（`in_progress` / `archived` 等）|
| 关联项目变化后 | 当前最新的关联项目列表 |
| 发现相似进行中任务 | **先停下来**把候选列给用户确认，不要直接新建 |
| 归档完成后 | 归档结果 + 补充进 PRD 的总结要点 |

### 任务进入实施前的最终确认

在所有 CLI 跑完、进入实际实施工作前补一段整体确认：任务 ID + 状态 + 标题 + 关联项目 + 父任务 + 关键上下文 / 约束要点。

### 反例

连续执行 task list / info / search / create / start / associate 等多条命令但全程不输出任何文字解释，让用户只能从终端调用记录推断进度——**违反本规则**。

## 命令速查（属于任务流程的子集）

详细参数见 [command-reference.md](command-reference.md)。

```bash
lattice task list [--current] [--all-user] [--user <users>]
lattice task create "<title>" --current [--parent <id>]
lattice task info <id> [--lineage] [--tree] [--descendants]
lattice task update <id> [--add-project ...] [--parent ...] [--clear-parent]
lattice task tree <id> [--descendants]
lattice task lineage <id>
lattice task start <id>
lattice task checkpoint <id> --type <type> --title "..." -m "..."
lattice task progress <id> [--last <n>] [--type <type>]
lattice task associate <id> [--current] [--paths ...] [--project <id>] [--note ...]
lattice task complete <id>
lattice task archive <id>
lattice task reopen <id>
lattice task delete <id> --force
lattice context --task <id>
lattice rag update
```
