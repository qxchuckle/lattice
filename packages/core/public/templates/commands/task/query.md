# /lattice/task/query

> **[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。
>
> **[依赖 skill 子文档]**（本命令期间会按需 read 的 skill 子文档）：
> - `project-context.md`：项目 / 任务上下文查询
> - `task-workflows.md`：任务状态 / 进展 / checkpoint 查询语义
> - `command-reference.md`：CLI 参数字典
> - `subagent-delegation.md`（可选）：多词多类型并行调研场景下委派给 subagent

**目标**：纯信息查询模式 —— 回答用户关于项目、任务、进展的提问，**不修改任何文件、不创建任务**。

## 核心约束（纯只读）

| 允许 | 禁止 |
|---|---|
| `lattice task list / info / progress` | 创建、修改、删除任何文件 |
| `lattice context / search / spec show` | 创建或修改任务 |
| `lattice project list / info` | run_in_terminal 执行有副作用的命令 |
| `read_file` 查阅 PRD / progress / design | `checkpoint` / `complete` / `archive` |
| 综合信息后给出结论性回答 | 输出大段原始 CLI 结果不做总结 |

## 命令参数解析

- `query <具体问题>` → 直接根据问题调用相应 CLI 命令获取信息并回答
- `query`（无参数）→ 询问用户想了解什么

## 典型问题与对应策略

| 用户问题 | 信息源 |
|---|---|
| "现在有哪些任务" / "当前任务是什么" | `lattice task list --status in_progress` |
| "最近完成了什么" | `lattice task list --status completed` |
| "XX 任务的进展" | `lattice task info <id>` + `lattice task progress <id>` |
| "这个项目有什么规范" | `lattice spec show --project <id>` |
| "之前有没有做过类似的事" | `lattice search <关键词> --json` |
| "有哪些项目" / "项目间什么关系" | `lattice project list --with-relations` |
| "XX 任务的设计方案是什么" | read_file 任务 `design.md` |
| "这个任务的 PRD 是什么" | read_file 任务 `prd.md` |

完整 CLI 参数见 skill `command-reference.md`。

## 执行步骤

1. **理解问题**：解析提问意图，判断需要哪些信息源
2. **采集信息**：调用对应 CLI 命令或 read_file
3. **综合回答**：结论先行，再给支撑细节；不要机械复制 CLI 输出

## 输出要求

- 回答有结论性：先给答案，再给支撑细节
- 涉及多个任务 / 项目时用表格或列表整理
- 问题模糊时主动追问细化方向
- 查不到时明确告知，不要猜测
