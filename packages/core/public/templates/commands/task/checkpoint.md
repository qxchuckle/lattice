# /lattice/task/checkpoint

> **[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**目标**：记录当前任务的关键进展，确保过程信息结构化落盘，支持跨会话追踪。

## 命令参数解析

- 命令后有任务 ID → 直接对该任务添加检查点
- 命令后没有任务 ID → 通过 `lattice task list --current --status in_progress` 推断当前任务；多个时询问用户确认

## 执行步骤

### 1. 确定目标任务

```bash
lattice task info <task-id>     # 有 ID 时
lattice task list --current     # 无 ID 时，选 in_progress 的
```

### 2. 总结当前会话进展

结合对话内容归纳出 type / title / message。**类型选择和触发时机**详见 skill `task-workflows.md` 的「checkpoint 类型与触发」。

### 3. 写入

```bash
lattice task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

## 输出要求

- 告诉用户检查点已记录，显示检查点 ID / 类型 / 标题
- 如果是隐式触发，简要说明为什么在此时记录

## 注意事项

- 不要在每次对话轮都记录，只在有实质性进展时记录
- 标题简洁（≤ 30 字），message 可详细
- 一次对话有多个值得记录的进展可以分多次调用
- checkpoint 记录过程信息（决策 / 问题 / 调整），不是收敛型内容（目标 / 约束）—— 后者应更新到 `prd.md`
