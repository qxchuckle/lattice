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

### 2. PRD 自检前置步骤（强制，打点前必过）

执行 `lattice task checkpoint` **之前必须先过以下自检**——任意一条命中而 PRD 未同步，**必须先 `read_file prd.md` → `search_replace prd.md` 同步后再打点**（详见 skill `task-workflows.md` 「打点前 PRD 自检」）：

- [ ] 本轮是否触发了 skill `task-workflows.md` 「PRD 同步硬触发清单」中任一项（T1~T7）？
- [ ] 本轮改动的文件是否全部出现在 PRD 的"修改文件索引"中？
- [ ] 本轮的方案 / 决策 / 否决理由是否已写入 PRD 对应段落？
- [ ] 本轮发现的新约束 / 边界 / 风险是否已写入 PRD「关键约束」或「风险」段？

> 未过自检直接打点 = 把关键决策只写进 checkpoint 而不回流 PRD，是跨会话失忆最常见路径。

### 3. 总结当前会话进展

结合对话内容归纳出 type / title / message。**类型选择和触发时机**详见 skill `task-workflows.md` 的「checkpoint 类型与触发」。

### 4. 写入

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
- checkpoint 记录过程信息（决策事件 / 问题事件 / 调整事件），**不能替代 PRD 的当前最佳认知**——任何会使 PRD 变动的决策都必须同步补 PRD，不能只写进 checkpoint
