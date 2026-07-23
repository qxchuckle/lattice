# /lattice/task/start

**[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**[依赖 skill 子文档]**（本命令期间会反复 read 的 skill 子文档）：
- `task-workflows.md`：标题归纳与查重 / task start 后的起手动作 / 实施期循环（①~⑤）/ checkpoint 类型 / 输出原则
- `spec-workflows.md`：按任务主题全文读取相关 spec
- `project-context.md`：进入项目默认动作 / 嵌套继承
- `lattice-rules.md`：起手与实施期硬规则（跨会话遵守）/ 回答闭合自检（§十）
- `subagent-delegation.md`：委派判定 / dispatch prompt 契约（起手动作委派 `lattice-task-start`）

**目标**：开始一个任务，让当前会话和任务状态保持一致。

## 命令参数解析

- 命令后是已存在的任务 ID → 直接 `ltc task start <task-id>`
- 命令后是非 ID 的描述 / 关键词 / 文件引用 / 需求段 → 走"标题归纳与查重"流程，详见 skill `task-workflows.md` 的「命令参数不是任务 ID 时：标题归纳与查重」

## 执行步骤

### 情况一：参数是任务 ID

```bash
ltc task start <task-id>
ltc context --task <task-id>
```

### 情况二：参数不是任务 ID

按 skill `task-workflows.md` 的「命令参数不是任务 ID 时：标题归纳与查重」 完成**项目定位（第 0 步，必做）** + 归纳 + 查重 + 创建（参数由第 0 步定位结果决定，必要时带 `--parent`），拿到任务 ID 后再执行情况一的命令。

## 开始任务后（必做）

按 skill `task-workflows.md` 的「task start 后的起手动作」6 步执行（spec 全文读取 → 参考历史任务 → 完善 PRD → PRD 规模摘要 → 同步项目关联 → 整体确认）。

## 实施期循环（任务进行中每轮必做）

按 skill `task-workflows.md` 的「实施期循环（每轮用户输入到来时）」①~⑤ 步执行，不能跳步。

## 进展追踪

详见 skill `task-workflows.md` 的「checkpoint 类型」。

## 输出要求

详见 skill `task-workflows.md` 的「输出原则」。
