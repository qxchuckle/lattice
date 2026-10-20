# /lattice/task/start

**[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**[依赖文档]**（均位于 lattice skill 目录）：
- task-workflows.md：标题归纳与查重 / 起手动作 / 实施期循环 / checkpoint 类型 / 输出原则
- spec-workflows.md：按任务主题全文读取相关 spec
- project-context.md：进入项目默认动作 / 嵌套继承
- lattice-rules.md：起手与实施期硬规则 / 十、回答闭合自检
- subagent-delegation.md：委派判定 / dispatch prompt 契约（起手委派 `lattice-task-start`）

**目标**：开始一个任务，让当前会话和任务状态保持一致。

## 命令参数解析

- 命令后是已存在的任务 ID → 直接 `ltc task start <task-id>`
- 命令后是非 ID 的描述 / 关键词 / 文件引用 / 需求段 → 走"标题归纳与查重"流程（[task-workflows.md#命令参数非任务 ID 时：标题归纳与查重]）

## 执行步骤

### 情况一：参数是任务 ID

```bash
ltc task start <task-id>
```

### 情况二：参数不是任务 ID

按 [task-workflows.md#命令参数非任务 ID 时：标题归纳与查重] 完成**项目定位（第 0 步，必做）** + 归纳 + 查重 + 创建（第 4 步一次串联 create→start：命令替换捕获 `-q` 输出的 ID 再传给 start，见该节），随后执行 [task-workflows.md#task start 后的起手动作]。

## 开始任务后（必做）

按 [task-workflows.md#task start 后的起手动作] 执行。

## 实施期循环（任务进行中每轮必做）

按 [task-workflows.md#实施期循环] 逐步执行，不能跳步。

## 进展追踪

[task-workflows.md#checkpoint 类型]。

## 输出要求

[task-workflows.md#输出原则]。
