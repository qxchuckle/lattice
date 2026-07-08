# /lattice/task/delete

> **[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。
>
> **[依赖 skill 子文档]**（本命令期间会按需 read 的 skill 子文档）：
> - `task-workflows.md`：任务目录与文件结构 / checkpoint 类型
> - `command-reference.md`：`ltc task delete` / `ltc task list` / `ltc search` 参数字典

**目标**：删除任务，支持自然语言匹配候选任务交用户确认，无参数时删除当前 in_progress 任务，有风险因素时强制用户二次确认。

## 命令参数解析

- 命令后是任务 ID（或前缀） → 走"情况一"
- 命令后是自然语言描述 / 关键词 → 走"情况二"
- 命令后没有内容 → 走"情况三"

## 执行步骤

### 情况一：参数是任务 ID

```bash
ltc task info <id>          # 确认任务存在 + 获取元数据
ltc task progress <id>      # 检查是否有 checkpoint 记录
ltc task tree <id>          # 检查是否有子任务
```

拿到任务信息后进入「风险评估与确认」。

### 情况二：参数是自然语言描述

用搜索 + 列表交叉匹配找候选：

```bash
ltc search "<描述>" --type task --json
ltc task list --current
```

匹配规则：
- 搜索结果按 score 排序，取 top 5
- 排除 `archived` 任务（除非用户明确要删已归档任务）
- 搜索无结果 → 回退到 `ltc task list --current` 按标题关键词模糊匹配
- 仍无匹配 → 告知用户未找到任务，建议用 `/lattice/task/query` 查看

有候选后 → 列出候选（标题 + ID + 状态 + 简要信息）请用户选择 → 拿到任务 ID 后进入「风险评估与确认」。

### 情况三：无参数

删除当前正在执行的任务：

```bash
ltc task list --current
```

- 筛选 `in_progress` 任务
- **唯一** → 直接进入「风险评估与确认」
- **多个** → 列出候选请用户选择
- **无 in_progress 任务** → 告知用户当前没有正在执行的任务

## 风险评估与确认

定位到目标任务后，**必须**执行风险评估并交用户确认，不能跳过。

### 风险因素检查

| 检查项 | 命令 | 有风险时的处理 |
|---|---|---|
| 有子任务 | `ltc task tree <id>` | **拒绝删除**，提示用户先迁移 / 删除 / 归档子任务 |
| 状态为 in_progress | `ltc task info <id>` | 警告：任务正在执行中，删除后无法继续 |
| 有 checkpoint 记录 | `ltc task progress <id>` | 警告：将丢失 N 条进度记录 |
| 有关联项目 | `ltc task info <id>` | 提示：任务关联了 N 个项目 |

### 确认流程

1. 输出任务信息摘要（标题 + ID + 状态 + 子任务数 + checkpoint 数 + 关联项目）
2. 输出风险评估结果（列出命中的风险因素，或"无额外风险因素"）
3. 明确询问用户是否确认删除
4. 用户确认 → 执行删除；用户拒绝 / 未明确确认 → 中止，不删除

**禁止**：未经用户明确确认就执行删除。即使用户在自然语言描述中表达了删除意图，也必须先展示任务信息和风险因素再确认。

## 执行删除

用户确认后执行：

```bash
ltc task delete <task-id>
```

> 删除是软删除（移入垃圾桶），可通过 `ltc trash list` 查看、`ltc trash restore <id>` 恢复。

## 输出要求

- 列出候选任务时：标题 + ID + 状态，不贴搜索 JSON 原文
- 风险评估：简明列出命中的风险因素，无风险时也要说明
- 删除成功后：告知任务已移入垃圾桶 + 恢复方式
- 删除中止时：说明中止原因（用户拒绝 / 有子任务 / 未找到任务等）
- 无参数且无 in_progress 任务时：明确告知当前没有正在执行的任务
