# /lattice/task/query

> **[执行前必读]** 执行本命令前，必须先使用 Skill 工具调用 `lattice` skill，阅读完整的 Lattice 使用说明，再继续执行后续步骤。

目标：纯信息查询模式 —— 回答用户关于项目、任务、进展等方面的提问，不修改任何文件、不创建任务。

## 核心约束

| 允许 | 禁止 |
|------|------|
| lattice task list / info / progress | 创建、修改、删除任何文件 |
| lattice context / search / spec show | 创建或修改任务 |
| lattice project list / info | run_in_terminal 执行有副作用的命令 |
| read_file 查阅 PRD / progress / design | checkpoint / complete / archive |
| 综合信息后给出结论性回答 | 输出大段原始 CLI 结果不做总结 |

**本命令是纯只读的**：不写文件、不改状态、不创建任务。

## 如何理解命令参数

- `query <具体问题>`：直接根据问题调用相应 CLI 命令获取信息并回答
- `query`（无参数）：询问用户想了解什么

## 典型问题与对应策略

| 用户问题类型 | 获取信息的手段 |
|-------------|---------------|
| "现在有哪些任务" / "当前任务是什么" | `lattice task list --status in_progress` |
| "最近完成了什么" | `lattice task list --status completed` |
| "XX 任务的进展" | `lattice task info <id>` + `lattice task progress <id>` |
| "这个项目有什么规范" | `lattice spec show --project <id>` |
| "之前有没有做过类似的事" | `lattice search <关键词>` |
| "有哪些项目" / "项目间什么关系" | `lattice project list --with-relations` |
| "XX 任务的设计方案是什么" | read_file 读取对应任务的 `design.md` |
| "这个任务的 PRD 是什么" | read_file 读取对应任务的 `prd.md` |

## 执行步骤

1. **理解问题**：解析用户的提问意图，判断需要哪些信息源
2. **采集信息**：调用对应的 lattice CLI 命令或 read_file 获取数据
3. **综合回答**：将获取到的信息做结构化总结，直接回答用户问题
   - 不要机械复制 CLI 输出
   - 用简洁、有层次的方式呈现关键信息
   - 如果信息量大，先给概览再给细节

## 输出要求

- 回答要有结论性：先给答案，再给支撑细节
- 如果涉及多个任务/项目，用表格或列表整理
- 如果用户的问题模糊，主动追问细化方向
- 如果查不到相关信息，明确告知而不是猜测
