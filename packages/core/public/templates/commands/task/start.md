# /lattice/task/start

**[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**[依赖 skill 子文档]**（本命令期间会反复 read 的 skill 子文档）：
- `task-workflows.md`：任务模式 / 标题归纳与查重 / task start 后的起手动作 / 实施期循环（每轮用户输入到来时）/ PRD 硬触发（T1~T8）/ checkpoint 类型
- `spec-workflows.md`：按任务主题全文读取相关 spec
- `project-context.md`：进入项目默认动作 / 嵌套继承
- `lattice-rules.md`：起手与实施期硬规则（跨会话遵守）

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

按 skill `task-workflows.md` 的「task start 后的起手动作」 执行：

1. **按主题全文读取相关 spec**（必做）：见 skill `spec-workflows.md` 的「按任务主题全文读取相关 spec」
2. **参考近似任务**（按复杂性 1~5 个 PRD）
3. **完善 PRD**：不要停留在默认空白标题；只记录当前最佳认知内容（目标 / 关键约束 / 当前方案 / 修改文件索引 / 风险）；如有 design.md 先读
4. **输出 PRD 当前规模摘要**：写完 PRD 后用 1~3 行告知用户本轮 PRD 覆盖了哪几个关键段落（目标 / 修改文件数 / 实施阶段数），让 PRD 状态在会话中可见
5. **同步项目关联**：见 skill `task-workflows.md` 的「项目关联同步」。任务创建时已做项目定位（第 0 步），此处仅处理任务进行中新增 / 调整项目关联的场景——新路径用 `--paths`，新已注册项目用 `--project <id>`（先 `ltc project where <path>` / `ltc project list --search` 定位）

## 实施期循环（任务进行中每轮必做）

**每一轮用户输入到来后按以下步骤执行，不能跳步**（详见 skill `task-workflows.md` 的「实施期循环（每轮用户输入到来时）」）：

### 步骤 1：PRD 同步硬触发检查（命中即先改 PRD）

本轮是否命中 skill `task-workflows.md` 「PRD 硬触发（T1~T8）」中的 T1~T8 任一项？

- **是** → 必须先 `read_file prd.md` → `search_replace prd.md` 修订对应段落 → 打 decision/pivot checkpoint → 才进入下一步
- **否** → 跳过，进入步骤 2

### 步骤 2：spec 选读

本轮涉及之前没读过的模块 / 概念 / 规范分层？是→ read_file 全文读取相关 spec（规则详见 skill `task-workflows.md` 「② spec 选读（每轮必检）」）。

### 步骤 3：写代码

动作锚点：本轮要 search_replace 或 create_file 的业务文件 ≥ 3 个 → 必须先 `read_file prd.md` 校对"修改文件索引"（详见 skill `task-workflows.md` 「③ 写代码前锚点」）。

### 步骤 4：打 checkpoint

必须先按 skill `task-workflows.md` 「④ checkpoint 前 PRD 自检」 过一遍，命中任一项未同步项 → 先 search_replace prd.md 再打点。

### 强制项

上述 4 步与 `lattice-rules.md` §三 实施期循环双向同步：

- PRD 永不能落后于代码（同步硬触发任一项命中 → 先改 PRD）
- 新主题先选读 spec
- 代码改完必须打 checkpoint，打点前必过 PRD 自检
- 用户推翻方案 → 第一动作是改 PRD「当前方案」段 + 打 pivot checkpoint，**不是**先改代码

## 进展追踪

详见 skill `task-workflows.md` 的「checkpoint 类型」。

## 输出要求

详见 skill `task-workflows.md` 的「输出原则」。重点：

- 关键节点必须输出（任务创建后 / 启动后 / 关联项目变化后 / 发现相似任务时）
- 任务进入实施前补一段整体确认：任务 ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束要点
- 当前目录不是已注册项目时，明确提示无法自动关联当前项目
