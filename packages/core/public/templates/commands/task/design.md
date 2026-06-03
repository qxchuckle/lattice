# /lattice/task/design

> **[执行前必读]** 执行本命令前，必须先使用 Skill 工具调用 `lattice` skill，阅读完整的 Lattice 使用说明，再继续执行后续步骤。

目标：进入"方案讨论模式"—— 只分析、只提案、不修改代码文件，直到用户明确要求开始实施。

## 核心约束

进入 design 模式后，AI 的行为边界：

| 允许 | 禁止 |
|------|------|
| read_file / grep_code / search / lsp | search_replace / create_file / delete_file |
| lattice context / search / spec show | 修改任何业务代码文件 |
| 提出方案、画对比表、列 pros/cons | 默默开始实现 |
| 写入/追加 `design.md` | 修改 `prd.md` 方案段（结论回写除外） |
| 记录 `checkpoint --type decision` | run_in_terminal 执行有副作用的命令 |

**唯一例外**：允许写入任务目录下的 `design.md` 和 `prd.md`（仅回写最终结论时）。

## 如何理解命令参数

- `design <task-id>`：对已有任务进入讨论模式
- `design <描述/主题>`：归纳标题 → 查重 → 创建任务 → 进入讨论模式
- `design`（无参数）：检查当前活跃任务，有则进入；无则询问用户想讨论什么

## 执行步骤

### 情况一：参数是已有任务 ID

```bash
lattice context --task <task-id>
lattice task progress <task-id> --last 5
```

然后读取该任务目录下的 `design.md`（如果已存在），了解之前的讨论历史。

### 情况二：参数不是任务 ID

先结合命令参数和当前对话，归纳出简洁明确的任务标题（参考 `/lattice/task/start` 的归纳规则）。

如果当前目录是已注册项目：

```bash
lattice task list --current
lattice search "<归纳出的标题>" --project <project-id> --type task --json
```

判断是否已有相似的 `in_progress` 任务：

- 如果有，先提醒用户是否继续该任务的讨论
- 如果没有，创建新任务：

```bash
lattice task create "<归纳出的任务标题>" --current
lattice task start <task-id>
lattice context --task <task-id>
```

### 情况三：无参数

```bash
lattice task list --current --status in_progress
```

- 如果有活跃任务，询问用户是否对该任务进入讨论模式
- 如果没有活跃任务，询问用户想讨论什么主题

## 进入讨论模式后

1. **读取上下文**：PRD、progress、已有 design.md（如存在）
2. **开始讨论**：围绕用户的问题分析、提出候选方案、对比利弊
3. **实时记录**：将讨论内容追加写入任务目录下的 `design.md`

### design.md 写入格式

每次进入 design 模式时，追加一个新的讨论段：

```markdown
## YYYY-MM-DD <讨论主题>

### 背景
<为什么需要讨论这个>

### 候选方案
- **方案 A**：...
  - 优势：...
  - 劣势：...
- **方案 B**：...
  - 优势：...
  - 劣势：...

### 讨论要点
<关键问题、用户反馈、约束条件>

### 结论
<最终采纳的方案及理由>
```

- 讨论过程中可以随时追加内容到当前段
- 每次达成关键决策时，同时打 checkpoint：

```bash
lattice task checkpoint <task-id> --type decision --title "<决策标题>" -m "<决策内容>"
```

## 退出 design 模式

满足以下任一条件时退出讨论模式，回到可以修改代码的状态：

- 用户明确说"开始实施" / "动手吧" / "按方案 X 来" / "可以写代码了"
- 用户执行 `/lattice/task/start`
- 用户发出明确的代码修改指令（如"把这个函数改成..."）

退出时：

1. 将本轮讨论的结论回写到 `prd.md` 的对应段落
2. 确保 `design.md` 中本轮讨论的"结论"段已填写
3. 如有未记录的关键决策，补打 checkpoint

## 输出要求

- 明确告诉用户已进入讨论模式，当前不会修改代码
- 如果是新建任务，告知任务 ID 和采用的标题
- 如果已有讨论历史（design.md 非空），简要概括之前的讨论进展
- 讨论过程中聚焦方案分析，避免输出代码实现细节
- 退出讨论模式时，明确告诉用户"已退出讨论模式，现在可以开始实施"

## 隐式触发：对话中自然出现设计讨论时

`design.md` 的更新不仅限于用户显式执行本命令。当存在活跃任务（`in_progress`）且当前对话中出现以下情况时，AI 应**主动**将讨论内容追加到 `design.md`：

- 用户提出多个候选方案让你对比分析
- 对话中形成了方案利弊讨论、架构决策、技术选型
- 用户否决了某个方案并给出理由
- 讨论产生了约束条件、边界定义或设计原则
- 用户问"你觉得 A 好还是 B 好"、"这样行不行"等设计类问题

**注意**：隐式触发时不需要进入"禁止改代码"的 design 模式约束。它只是把设计讨论的过程记录下来，避免这些信息随对话消失。如果用户同时在讨论方案和写代码，讨论部分仍然应该记入 `design.md`。
