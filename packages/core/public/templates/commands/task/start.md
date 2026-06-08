# /lattice/task/start

> **[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**目标**：开始一个任务，让当前会话和任务状态保持一致。

## 命令参数解析

- 命令后是已存在的任务 ID → 直接 `lattice task start <task-id>`
- 命令后是非 ID 的描述 / 关键词 / 文件引用 / 需求段 → 走"标题归纳与查重"流程，详见 skill `task-workflows.md` 的「标题归纳与查重」

## 执行步骤

### 情况一：参数是任务 ID

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

### 情况二：参数不是任务 ID

按 skill `task-workflows.md` 的「标题归纳与查重」 完成归纳 + 查重 + 创建（必要时带 `--parent`），拿到任务 ID 后再执行情况一的命令。

## 开始任务后（必做）

按 skill `task-workflows.md` 的「任务起手动作」 执行：

1. **按主题精读相关 spec**（必做）：见 skill `spec-workflows.md` 的「按任务主题精读相关 spec」
2. **参考近似任务**（按复杂性 1~5 个 PRD）
3. **完善 PRD**：不要停留在默认空白标题；只记录收敛型内容；如有 design.md 先读
4. **同步项目关联**：见 skill `task-workflows.md` 的「项目关联同步（实施期同步义务）」

## 实施期循环（任务进行中每轮必做）

详见 skill `task-workflows.md` 的「实施期多轮对话循环」：

```
用户输入 → PRD（如需）→ spec（如需）→ code → checkpoint
```

强制规则：PRD 永不能落后于代码 / 新主题先选读 spec / 代码改完必须打 checkpoint / 用户推翻方案必须 pivot。

## 进展追踪

详见 skill `task-workflows.md` 的「checkpoint 类型与触发」。

## 输出要求

详见 skill `task-workflows.md` 的「输出原则：精简但不静默」。重点：

- 关键节点必须输出（任务创建后 / 启动后 / 关联项目变化后 / 发现相似任务时）
- 任务进入实施前补一段整体确认：任务 ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束要点
- 当前目录不是已注册项目时，明确提示无法自动关联当前项目
