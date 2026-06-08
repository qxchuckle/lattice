# 任务工作流

本文件是 Lattice 中所有 **任务全流程概念**的权威源（任务目录、多轮对话循环、checkpoint、归档）。其他文档应通过锚点引用本文件。

spec 相关概念见 [spec-workflows.md](spec-workflows.md)。

## 任务目录与文件

```
~/.lattice/users/<username>/tasks/<task-id>/
├── task.json       # 元数据（id/title/status/projects/scopePaths 唯一来源）
├── prd.md          # 收敛型内容（目标、约束、最终方案、文件索引）
├── progress.yaml   # 追加型过程（决策、问题、里程碑）
├── design.md       # 方案讨论（候选、利弊、被否决方案及理由、结论）
└── ...             # 可拆分子文档
```

**职责不重叠**：PRD 管"最终是什么"，progress 管"发生了什么"，design 管"怎么讨论出来的"。

> ⚠️ `prd.md` **不得包含 YAML frontmatter**（id/title/status/created_at/projects 等只在 task.json）。`lattice task create` / `task info` 输出 PRD 完整路径，直接用。

## 任务阶段

```
design（讨论）→ start（实施）→ design（中途讨论）→ 实施 → archive（收尾）
```

- **design 模式**：只读 + 分析，禁改业务代码，讨论写入 `design.md`（详见 lattice command `task/design.md`）
- **implementation 模式**：`start` 后默认状态，可改代码
- **隐式触发 design 记录**：未显式 `/lattice/task/design` 但对话出现方案讨论 / 设计对比 / 架构决策时，主动追加到 `design.md`（不受"禁改代码"约束）

## 标题归纳与查重

命令参数不是任务 ID 时（描述、关键词、文件引用、需求段）：

1. **归纳标题**：结合参数和对话总结简洁标题，不要把原始参数 / 文件路径 / 长描述塞进标题
2. **查重**：

   ```bash
   lattice task list --current
   lattice search "<标题>" --project <project-id> --type task --json
   ```

3. 有相似 `in_progress` 任务 → **先停下把候选列给用户确认**，不要直接新建
4. 创建：

   ```bash
   lattice task create "<标题>" --current [--parent <parent-task-id>]
   ```

## 父子任务

任务明显是另一任务的后续 / 拆分时，**创建时就指定父任务**，不要只在 PRD 文字描述：

```bash
lattice task create "<title>" --current --parent <parent-task-id>
lattice task lineage <task-id>            # 查链路
lattice task tree <task-id> [--descendants]
lattice task update <task-id> --parent <parent-task-id>  # 改归属
lattice task update <task-id> --clear-parent             # 清空父
```

> 任务仍挂着子任务时不要直接删除；先迁移、清空或完成子任务。

## 实施期多轮对话循环（必做）

`lattice task start` 后进入实施期。**用户每轮新输入到来时按以下顺序，不能跳步**：

```
用户输入
  ↓
是否影响目标 / 范围 / 约束 / 方案 / 取舍 / 文件清单 / 风险？
  └─ 是：先 search_replace 改 prd.md + 打 decision/pivot checkpoint
  ↓
涉及之前没读过的模块 / 概念 / 规范分层？
  └─ 是：read_file 精读相关 spec（见 spec-workflows.md）
  ↓
实际改代码
  ↓
打 checkpoint 记录这一轮进展
```

### 强制规则

1. **PRD 永不落后于代码**：目标 / 边界 / 选型 / 取舍 / 文件清单 / 风险任何变化必须**先**改 PRD 再改代码——"嘴上答应了、代码改了、PRD 没动" = 跨会话失忆最大来源
2. **新主题先选读 spec**：本轮涉及未读过的模块 / 规范分层时必须 read_file 精读
3. **代码改完必须打 checkpoint**：连续 5 个小修改至少 1 个 milestone/note
4. **用户推翻方案 = 必须 pivot checkpoint**：默默实现新方案 = 丢失决策史
5. **过程中即沉淀 spec**：多轮对话中冒出长期可复用的项目认知 / 行为约束 / 流程范式 / 经验细节时，**立即询问用户是否沉淀**，不要拖到归档前

## checkpoint 类型与触发

```bash
lattice task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

| type | 适用 |
|---|---|
| `decision` | 重要技术决策 / 方案选型 / 用户拍板 |
| `pivot` | 方案从 A 切到 B / 推翻原计划 |
| `milestone` | 阶段性成果交付（一组改动通过验证） |
| `issue` | 发现问题 / 踩坑 / 兼容性事故 |
| `note` | 调研发现 / 实验数据 / 一次性记录 |
| `summary` | 任务收尾总结 |

### 何时打（隐式触发时机）

- **进展型**：完成 PRD 子任务 / 一组改动通过验证 / 改动 ≥3 文件或 100 行
- **决策型**：用户拍板某决策 / 推翻原方案 / 给出新约束新想法
- **边界型**：切换到独立工作单元 / 发现意料外问题 / 会话即将结束

> 不要每轮对话都记录，只在有实质性进展时记录。一次对话有多个进展可分多次调用。

### 查看进展

```bash
lattice task progress <task-id> [--last <n>] [--type <type>]
```

新会话 resume 任务时：`lattice context --task <id>` + `lattice task progress <id> --last 5` 快速对齐。

## 项目关联同步（实施期同步义务）

`start` 后 AI 有义务**实时维护 `task.json` 的 `projects` / `scopePaths`**，使其反映实际工作范围。

### 触发时机

- 任务刚 start，当前目录对应项目不在 `projects` 中
- 打开 / 编辑 / 搜索了某路径文件，且该路径对应项目尚未关联
- 用户明确提到在某项目 / 目录下操作
- 中途切换到新项目目录工作
- 归档前复核 `projects` 是否覆盖实际触及的所有项目

### 执行

```bash
lattice task associate <task-id> --current               # 当前目录
lattice task associate <task-id> --paths <path>          # 指定路径
lattice task associate <task-id> --project <project-id>  # 已知项目 ID
```

> 静默执行不需用户确认，**只有关联了用户可能未预期的项目时才简短说明**。当前路径已在 `projects` 或 `scopePaths` 中则跳过。

## 任务起手动作

获得任务 ID 后立即：

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

然后：

1. **按主题选读相关 spec**（必做）：见 [spec-workflows.md#读-spec](spec-workflows.md#读-spec)
2. **参考近似任务**：`lattice search "<标题或核心关键词>" --type task --json`，按复杂度参考 1~5 个已完成任务的 PRD（高复杂度可同时看 design.md / progress.yaml）
3. **完善 PRD**：不停留在默认空白；只记录收敛型内容（目标、约束、关键设计、最终方案、文件索引）；过长可拆但 `prd.md` 必须保留主入口
4. **如有 design.md**：先 read_file 了解之前讨论的方案、约束、结论

## 归档前置信息采集（强制，先读后写）

`/lattice/task/archive` 与 `lattice task complete` 前必须先建立任务全貌认知：

```bash
# (a) 任务元数据 + PRD 全文
lattice task info <task-id>      # 拿到 PRD 路径 → read_file prd.md

# (b) 全部进展记录
lattice task progress <task-id>

# (c) read_file design.md（如存在）

# (d) 回顾当前对话中的决策、方案变更、最终结论

# (e) 审查代码变更（如项目用 git，见下节）
```

> 禁止跳过：未读 PRD + progress + design.md 就写归档总结 = 必然遗漏关键决策。

### 归档时审查代码变更

git 仓库且能确定变更基准时执行；否则跳过。目标是**确保归档信息完整**而非 code review。

| 步骤 | 做什么 |
|---|---|
| 确定 diff 基准 | 优先级：任务创建时间对应 commit > 对话开始前 HEAD > 分支点（如 `main..HEAD`）> 未提交变更（`git diff --stat`） |
| 看变更概览 | `git diff --stat <base>..HEAD` 或 `git diff --stat [--cached]` |
| 审查关键文件 | 新增文件→完整读；核心改动→看 diff 或源码；配置变更→快速确认；纯格式化→知晓即可 |
| 产出 | 未记录改动→补 PRD 或追加 checkpoint；新模式/约定→纳入 spec 沉淀判定；确认 PRD 文件索引覆盖所有变更 |

## 归档闭环

```bash
# 1. 前置信息采集（见上）
# 2. 更新 prd.md：补最终方案 + "任务完成总结" + 关键结果/取舍/遗留
# 3. summary checkpoint
lattice task checkpoint <task-id> --type summary --title "..." -m "..."
# 4. 完成 + 归档
lattice task complete <task-id>
lattice task archive <task-id>
# 5. 索引更新
lattice rag update
# 6. 二次审阅 + 7. spec 沉淀判定
```

### 归档后二次审阅（强制）

对照 progress 和当前对话检查：
- 关键决策、方案变更是否全部体现在 PRD 或 checkpoint
- 是否有"做了但忘记写"的改动、取舍、遗留问题
- 经验是否已判断要不要沉淀为 spec
- 发现遗漏 → 立即补充 + 再次 `lattice rag update`

### spec 沉淀判定

按 [spec-workflows.md#写-spec沉淀判定--写入流程](spec-workflows.md#写-spec沉淀判定--写入流程) 的三档表执行（必须写 / 建议写 / 不写）。

## 命令参数为空时的归档推断

用户没给任务 ID 或参数不是 ID 时：

```bash
lattice task list --current
lattice search "<对话主题>" --project <project-id> --type task --json
```

**自动归档（无需确认）**：满足全部时直接走归档流程：
- `in_progress` 仅 1 个，或多个但其中一个与当前对话主题高度匹配
- 当前对话围绕该任务做了实质性工作
- AI 对匹配有足够把握

**需用户确认**：多个候选无法定唯一 / 对话未围绕明确任务 / AI 信心不足 → 列候选给用户确认。无候选时告诉用户可先新建再归档。

## 输出原则：精简但不静默

- **精简**：不长篇复述 CLI 输出，不罗列每步命令，不贴 search 全部 JSON
- **不静默**：到达关键节点必须立即输出 2~5 行简短说明，不等所有步骤跑完才统一汇报

### 关键节点必说

| 节点 | 必说 |
|---|---|
| 任务创建后 | 最终标题 + 新任务 ID + 父任务 ID（如有）+ 关联项目 |
| 启动 / 切换状态后 | 当前状态 |
| 关联项目变化后 | 最新关联项目列表 |
| 发现相似任务 | **先停下**列候选给用户确认 |
| 归档完成后 | 归档结果 + 补充进 PRD 的总结要点 |

进入实际实施前补一段整体确认：任务 ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束。

## 命令速查（高频）

详细参数见 [command-reference.md](command-reference.md)。

```bash
lattice task list [--current] [--all-user] [--user <users>]
lattice task create "<title>" --current [--parent <id>]
lattice task info <id>
lattice task start <id>
lattice task checkpoint <id> --type <type> --title "..." -m "..."
lattice task progress <id> [--last <n>]
lattice task associate <id> [--current] [--paths ...] [--project <id>]
lattice task complete <id>
lattice task archive <id>
lattice context --task <id>
```
