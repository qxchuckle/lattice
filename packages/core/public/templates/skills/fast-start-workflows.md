# Fast-start 工作流

> **本文权威范围**：fast-start 模式的完整工作流（启动 / 工作中约束 / 复杂度检测 / 转正常模式 / 归档）。正常任务工作流见 [task-workflows.md](task-workflows.md)；spec 沉淀判定见 [spec-workflows.md](spec-workflows.md)。

## 定义与适用场景

> 何时读：收到 `/lattice/task/fast-start` 或 `/lattice/task/fast-start/to-normal`，或会话中需要判断是否应从 fast-start 转正常模式时 → 下一步：按本节规则执行。

fast-start 是 `task/start` 的轻量变体：获取项目上下文和精读 spec，但不创建任务、不写 PRD、不打 checkpoint。

适用场景：

- 确定性轻量任务（改一个 bug、加一个小功能、调整配置）
- 不想被 ltc 记录的任务（快速验证、临时实验）
- 用户明确知道任务简单，不需要 PRD 追踪

不适用场景（直接用 `/lattice/task/start`）：

- 需求不明确，可能需要多轮讨论
- 涉及多文件、多模块改动
- 需要方案设计和决策记录

## 启动流程

> 何时读：收到 `/lattice/task/fast-start` 后 → 下一步：完成启动后直接开始工作。

1. **获取项目上下文**：`ltc context`
2. **精读相关 spec**：按 [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec) 选读
3. **输出简短确认**：已加载的项目上下文 + 读取了哪些 spec（2~3 行）
4. **直接开始工作**：不创建任务、不写 PRD、不打 checkpoint

## 与正常模式的差异

| | fast-start | task/start |
|---|---|---|
| 获取项目上下文 (`ltc context`) | ✓ | ✓ |
| 精读相关 spec | ✓ | ✓ |
| 创建任务 / PRD / checkpoint | ✗ | ✓ |
| 实施期 4 步循环（PRD 同步 → spec → code → checkpoint） | ✗ | ✓ |
| spec 沉淀提醒 | ✓ | ✓ |
| 复杂时转正常模式 | ✓ | — |
| 项目关联同步 | ✗ | ✓ |

**不走** [lattice-rules.md](lattice-rules.md) §三 实施期循环和 §六 任务完成闭环。

## 工作中行为约束

> 何时读：fast-start 模式下每轮用户输入到来时 → 下一步：按本节约束执行，不做 PRD / checkpoint 操作。

- **spec 精读仍然必做**——fast-start 只是省略任务记录，不省略项目认知
- **不创建任务、不写 PRD、不打 checkpoint**——这些是 fast-start 的核心特征，不是遗漏
- **不走实施期 4 步循环**——PRD 同步硬触发 / checkpoint 自检 / 文件索引校对均不适用
- **spec 沉淀仍然适用**——发现可复用内容（行为约束 / 项目认知 / 试错经验）→ 按 [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定) 主动询问用户是否沉淀
- 用户可随时使用 `/lattice/spec/update/{project|user|global}` 命令沉淀
- 当前目录不是已注册项目时，提示无法获取项目上下文，用户可选择继续裸跑或先注册项目

## 复杂度检测

> 何时读：fast-start 模式下每轮自动判断复杂度时 → 下一步：命中信号时提示用户，用户确认后执行转正常模式。

出现以下任一信号时，**立即提示用户**是否转入正常任务模式：

- 需求模糊或多次澄清仍不确定方案
- 多轮对话后仍无法完成任务
- 需要复杂方案讨论（适合 design 模式）
- 发现需要跨项目协作或复杂依赖关系

提示格式：`⚠ 当前任务复杂度较高（具体原因）。建议转入正常任务模式以记录进度和 PRD。是否转入？可使用 /lattice/task/fast-start/to-normal。`

用户确认后执行 `/lattice/task/fast-start/to-normal` 流程。

用户选择继续 fast-start → 不再重复提示同一信号，但新信号出现时再次提示。

## 转正常模式（to-normal）

> 何时读：收到 `/lattice/task/fast-start/to-normal` 或 fast-start 复杂度检测命中且用户确认转入时 → 下一步：完成转换后按正常实施期循环执行。

### 前置条件

- 当前会话处于 fast-start 模式（未创建 lattice 任务）
- 对话中已有实质工作内容（否则直接用 `/lattice/task/start` 更合适）

### 转换流程

1. **归纳任务标题 + 查重**：从对话上下文归纳简洁标题，按 [task-workflows.md#命令参数不是任务 ID 时：标题归纳与查重](task-workflows.md#命令参数不是任务-id-时标题归纳与查重) 流程查重
2. **创建并启动任务**：
   ```bash
   ltc task create "<标题>" --current
   ltc task start <task-id>
   ltc context --task <task-id>
   ```
3. **回填 PRD**：将 fast-start 阶段已完成的工作回填到 PRD：
   - **目标**：整个任务的完整目标（不仅是剩余部分）
   - **当前方案**：已完成的工作 + 剩余方案
   - **修改文件索引**：已修改和待修改的文件
   - **关键约束**：fast-start 阶段发现的约束
4. **关联项目**：`ltc task associate <task-id> --current`
5. **后续按正常模式执行**：从此刻起，完全按 [task-workflows.md#实施期多轮对话循环每轮用户输入到来时](task-workflows.md#实施期多轮对话循环每轮用户输入到来时) 执行

### 约束

- 转换是单向的：转入正常模式后不能退回 fast-start
- 回填 PRD 时不要遗漏 fast-start 阶段已完成的工作
- fast-start 阶段有值得记录的决策或纠错，转为正常模式后补打对应类型 checkpoint

## 归档

> 何时读：fast-start 模式下执行 `/lattice/task/archive` 时 → 下一步：先创建任务再按正常归档流程执行。

fast-start 模式下未创建任务，执行归档时：

1. **从对话上下文归纳任务标题**
2. `ltc task create "<标题>" --current` + `ltc task start <task-id>`
3. **回填 PRD**：将 fast-start 阶段完成的工作写入 PRD（目标 / 最终方案 / 修改文件索引 / 任务完成总结）
4. `ltc task associate <task-id> --current`
5. **按正常归档流程执行**：summary checkpoint → complete → archive → rag update → spec 沉淀判定（详见 [task-workflows.md#归档流程](task-workflows.md#归档流程)）

fast-start 模式下虽然没有任务记录，但对话中的实质工作和 spec 沉淀判定仍然适用。归档时创建任务是为了让工作成果可追溯。
