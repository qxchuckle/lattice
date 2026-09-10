# /lattice/task/fast-start/to-normal

**[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**[依赖文档]**（均位于 lattice skill 目录）：
- fast-start-workflows.md：转正常模式（to-normal）
- task-workflows.md：命令参数非任务 ID 时：标题归纳与查重 / task start 后的起手动作 / 实施期循环（每轮用户输入到来时）
- spec-workflows.md：按任务主题全文读取相关 spec

**目标**：将当前 fast-start 会话转入正常任务模式——创建任务、回填 PRD、后续按正常实施期循环执行。

## 前置条件

- 当前会话处于 fast-start 模式（未创建 lattice 任务）
- 对话中已有实质工作内容（否则直接用 `/lattice/task/start` 更合适）

## 执行步骤

### 1. 归纳任务标题

从对话上下文归纳简洁标题，按 [task-workflows.md#命令参数非任务 ID 时：标题归纳与查重] 查重（有相似 in_progress → 列候选给用户确认）。

### 2. 创建并启动任务

```bash
ltc task create "<标题>" --current
ltc task start <task-id>
ltc context --task <task-id>
```

### 3. 回填 PRD

将 fast-start 阶段已完成的工作回填到 PRD：

- **目标**：整个任务的完整目标（不仅是剩余部分）
- **当前方案**：已完成的工作 + 剩余方案
- **修改文件索引**：已修改和待修改的文件
- **关键约束**：fast-start 阶段发现的约束

### 4. 关联项目

```bash
ltc task associate <task-id> --current
```

### 5. 后续按正常模式执行

从此刻起，完全按 [task-workflows.md#实施期循环（每轮用户输入到来时）] 执行。

## 输出要求

- 创建任务后：任务 ID + 标题 + 关联项目
- 回填 PRD 后：PRD 覆盖的关键段落摘要
- 整体确认：任务 ID + 状态 + 标题 + 关联项目 + 已回填的工作概述

## 约束

- 转换是单向的：转入正常模式后不能退回 fast-start
- 回填 PRD 时不要遗漏 fast-start 阶段已完成的工作
- 如果 fast-start 阶段有值得记录的决策或纠错，转为正常模式后补打对应类型 checkpoint
