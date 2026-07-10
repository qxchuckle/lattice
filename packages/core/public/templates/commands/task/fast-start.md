# /lattice/task/fast-start

> **[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。
>
> **[依赖 skill 子文档]**（本命令期间按需 read）：
> - `project-context.md`：项目上下文报告
> - `spec-workflows.md`：按任务主题精读相关 spec / 沉淀判定
> - `fast-start-workflows.md`：fast-start 完整工作流（启动 / 复杂度检测 / 转正常模式 / 归档）

**目标**：以轻量模式开始工作——获取项目上下文和 spec，但不创建任务、不写 PRD、不打 checkpoint。

## 与 task/start 的区别

| | fast-start | task/start |
|---|---|---|
| 获取项目上下文 (`ltc context`) | ✓ | ✓ |
| 精读相关 spec | ✓ | ✓ |
| 创建任务 / PRD / checkpoint | ✗ | ✓ |
| 实施期 4 步循环 | ✗ | ✓ |
| spec 沉淀提醒 | ✓ | ✓ |
| 复杂时转正常模式 | ✓ | — |

## 执行步骤

1. **获取项目上下文**：`ltc context`
2. **精读相关 spec**：按 `spec-workflows.md` 的「按任务主题精读相关 spec」选读
3. **输出简短确认**：已加载的项目上下文 + 读取了哪些 spec（2~3 行）
4. **直接开始工作**：不创建任务、不写 PRD、不打 checkpoint

## 复杂度检测（每轮自动判断）

出现以下任一信号时，**立即提示用户**是否转入正常任务模式：

- 涉及修改 ≥3 个业务文件
- 需求模糊或多次澄清仍不确定方案
- 多轮对话后仍无法完成任务
- 需要方案讨论（适合 design 模式）
- 发现需要跨项目协作或复杂依赖关系

提示格式：`⚠ 当前任务复杂度较高（具体原因）。建议转入正常任务模式以记录进度和 PRD。是否转入？可使用 /lattice/task/fast-start/to-normal。`

用户确认后执行 `/lattice/task/fast-start/to-normal` 流程（详见对应命令文档）。

用户选择继续 fast-start → 不再重复提示同一信号，但新信号出现时再次提示。

## spec 沉淀

fast-start 模式**不创建任务**，但 spec 沉淀能力不受影响：

- 发现可复用内容（行为约束 / 项目认知 / 试错经验）→ 按 `spec-workflows.md` 的「沉淀判定」主动询问用户是否沉淀
- 用户可随时使用 `/lattice/spec/update/{project|user|global}` 命令沉淀
- 沉淀流程与正常模式完全一致（前置采集 → 查已有 → 冲突检测 → 写入 → 元数据刷新 → 索引更新）

## 归档

fast-start 模式下执行 `/lattice/task/archive` 时，因未创建任务，归档命令会先创建任务再按正常流程归档。详见 `task/archive.md` 的「情况三：fast-start 模式归档」。

## 约束

- 不创建任务、不写 PRD、不打 checkpoint（这些是 fast-start 的核心特征，不是遗漏）
- 不走 `lattice-rules.md` §三 实施期循环（PRD 同步 / spec 选读 / 写代码 / 打 checkpoint 的 4 步循环不适用）
- spec 精读仍然必做——fast-start 只是省略任务记录，不省略项目认知
- 当前目录不是已注册项目时，提示无法获取项目上下文，用户可选择继续裸跑或先注册项目
