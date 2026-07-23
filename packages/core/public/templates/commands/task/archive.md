# /lattice/task/archive

**[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**[依赖文档]**：
- task-workflows.md：归档 > 前置采集 / 归档 > 流程 / 归档 > 二次审阅 / 空参数归档推断
- spec-workflows.md：沉淀判定 / 写入流程 / 层级
- subagent-delegation.md：委派判定 / dispatch prompt 契约（归档委派 `lattice-task-archive`）

**目标**：结束并归档一个任务，同时判断是否需要沉淀规范。

## 命令参数解析

- 命令后是任务 ID → 走"情况一"
- 命令后没有内容或不是有效任务 ID → 走"情况二"自动推断（[task-workflows.md#空参数归档推断]）

## 执行步骤

### 情况一：命令后有任务 ID

完整归档闭环 [task-workflows.md#归档]：

1. **前置信息采集（必须先读后写）**：[task-workflows.md#前置采集]。**禁止跳过**——未读 PRD + progress + design.md 就写归档总结 = 必然遗漏关键决策
   - 含代码变更审查：如项目使用 git，通过 diff 审查本次任务修改的代码（`git diff --stat`），必要时阅读完整源文件，以确保归档信息完整覆盖所有实际变更
2. **更新 PRD**：补充最终方案、关键结果、取舍、遗留问题、"任务完成总结"段落；确保 progress 中的关键决策已在 PRD 中体现
   - 任务有父 / 子任务时先用 `ltc task lineage` / `ltc task tree --descendants` 检查链路是否仍合理
3. **summary checkpoint** + **complete** + **archive** + **`ltc rag update`**
4. **归档后二次审阅**（必做）：[task-workflows.md#二次审阅]
5. **spec 沉淀判定**：见下文"归档前检查"段

### 情况二：参数为空 / 不是任务 ID

按 [task-workflows.md#空参数归档推断] 自动推断：

- **自动归档**（无需用户确认）：满足"`in_progress` 唯一或高度匹配 + 对话围绕该任务有实质工作 + AI 有把握"全部条件时直接归档
- **需要用户确认**：多候选无法确定 / 对话未围绕明确任务 / AI 信心不足 → 列出候选请用户确认
- **没有匹配候选**：明确告诉用户当前没有合适候选，可以根据当前对话先新建任务再归档

### 情况三：fast-start 模式归档

当前会话处于 fast-start 模式（通过 `/lattice/task/fast-start` 开始，未创建 lattice 任务）时执行归档：

1. **从对话上下文归纳任务标题**
2. `ltc task create "<标题>" --current` + `ltc task start <task-id>`
3. **回填 PRD**：将 fast-start 阶段完成的工作写入 PRD（目标 / 最终方案 / 修改文件索引 / 任务完成总结）
4. `ltc task associate <task-id> --current`
5. **按情况一正常归档**：summary checkpoint → complete → archive → rag update → spec 沉淀判定

fast-start 模式下虽然没有任务记录，但对话中的实质工作和 spec 沉淀判定仍然适用。归档时创建任务是为了让工作成果可追溯。

## 归档前检查（spec 沉淀判定）

完整判定标准 [spec-workflows.md#沉淀判定]。在归档输出中必须补充：

- **强制沉淀判定**：是否存在用户显式行为指示 / 用户主动给出的项目认知 → 任一存在**必须**沉淀，不能只留在对话中消失
- **建议沉淀判定**（两类都要看）：行为约束类 + 项目认知类
- 这些规则或认知是否应该更新项目 spec？是否有一部分应该提升为用户 spec 或全局 spec？
- 判定核心问题：**下次有人 / AI 进入这个项目，是否还需要这条信息？**
- `prd.md` 是否补上最终方案和任务完成总结
- 如果 PRD 已拆分，`prd.md` 是否仍保留为任务主入口
- 当前任务是否仍有未处理的后续子任务；如有，归档说明中明确这些子任务的状态和后续安排

## 输出要求

- 告诉用户任务已归档，简短总结任务完成结果
- 命令参数为空且 AI 能确定任务时，直接告知确认的任务并执行归档
- 无法确定唯一候选时，列出候选请用户确认
- 没有匹配候选时，告知并补充"可帮用户根据对话新建任务后再归档"
- 归档前先更新 `prd.md`，补充任务描述和完成总结
- 发现应该沉淀规范时，明确指出建议使用哪个 `/lattice/spec/update/*` 命令
