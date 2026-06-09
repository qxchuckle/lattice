# /lattice/task/design

> **[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。
>
> **[依赖 skill 子文档]**（本命令期间会 read 的 skill 子文档）：
> - `task-workflows.md`：任务模式（design vs implementation）/ 命令参数不是任务 ID 时的标题归纳与查重 / checkpoint 类型与触发条件

**目标**：进入"方案讨论模式" —— 只分析、只提案、不修改代码文件，直到用户明确要求开始实施。

## 核心约束

| 允许 | 禁止 |
|---|---|
| read_file / grep_code / search / lsp | search_replace / create_file / delete_file |
| lattice context / search / spec show | 修改任何业务代码文件 |
| 提出方案、画对比表、列 pros/cons | 默默开始实现 |
| 写入 / 追加 `design.md` | 修改 `prd.md` 方案段（结论回写除外） |
| 记录 `checkpoint --type decision` | run_in_terminal 执行有副作用的命令 |

**唯一例外**：允许写入任务目录下的 `design.md` 和 `prd.md`（仅回写最终结论时）。

## 命令参数解析

- `design <task-id>` → 对已有任务进入讨论模式
- `design <描述/主题>` → 走"标题归纳与查重"创建任务（详见 skill `task-workflows.md` 的「命令参数不是任务 ID 时：标题归纳与查重」）→ 进入讨论模式
- `design`（无参数）→ 检查活跃任务，有则进入；无则询问用户想讨论什么

## 执行步骤

### 情况一：参数是已有任务 ID

```bash
lattice context --task <task-id>
lattice task progress <task-id> --last 5
```

read_file 读取该任务的 `design.md`（如已存在），了解之前的讨论历史。

### 情况二：参数不是任务 ID

按 skill `task-workflows.md` 的「命令参数不是任务 ID 时：标题归纳与查重」 归纳标题 + 查重 + 创建任务，然后：

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

### 情况三：无参数

```bash
lattice task list --current --status in_progress
```

有活跃任务则询问是否对该任务进入讨论模式；无则询问用户想讨论什么主题。

## 进入讨论模式后

1. **读取上下文**：PRD、progress、已有 design.md
2. **开始讨论**：围绕用户问题分析、提出候选方案、对比利弊
3. **实时记录**：将讨论内容追加到 `design.md`

### design.md 写入格式

每次进入 design 模式追加一个新段：

```markdown
## YYYY-MM-DD <讨论主题>

### 背景
<为什么需要讨论这个>

### 候选方案
- **方案 A**：...
  - 优势：... / 劣势：...
- **方案 B**：...
  - 优势：... / 劣势：...

### 讨论要点
<关键问题、用户反馈、约束条件>

### 结论
<最终采纳的方案及理由>
```

每次达成关键决策时同时打 checkpoint：

```bash
lattice task checkpoint <task-id> --type decision --title "<决策标题>" -m "<决策内容>"
```

## 退出 design 模式

满足任一条件退出，回到可改代码状态：

- 用户明确说"开始实施" / "动手吧" / "按方案 X 来" / "可以写代码了"
- 用户执行 `/lattice/task/start`
- 用户发出明确的代码修改指令

退出时：

1. 将本轮讨论结论回写到 `prd.md` 对应段落
2. 确保 `design.md` 中本轮的"结论"段已填写
3. 如有未记录的关键决策，补打 checkpoint

## 隐式触发：对话中自然出现设计讨论时

`design.md` 的更新不限于显式执行本命令。存在活跃任务（`in_progress`）且对话中出现以下情况时 AI 应**主动**追加到 `design.md`：

- 用户提出多个候选方案让你对比分析
- 对话形成方案利弊讨论 / 架构决策 / 技术选型
- 用户否决某个方案并给出理由
- 讨论产生约束条件、边界定义或设计原则
- 用户问"你觉得 A 好还是 B 好"、"这样行不行"等设计类问题

> **注意**：隐式触发不进入"禁止改代码"约束，只负责把设计讨论的过程记录下来。如果用户同时讨论方案和写代码，讨论部分仍应记入 `design.md`。

## 输出要求

- 明确告诉用户已进入讨论模式，当前不会修改代码
- 新建任务时告知任务 ID 和采用的标题
- 如有讨论历史（design.md 非空），简要概括之前的讨论进展
- 讨论中聚焦方案分析，避免输出代码实现细节
- 退出讨论模式时明确告诉用户"已退出讨论模式，现在可以开始实施"
