# Lattice 工作流（系统级常驻规则）

Lattice 是跨项目的 AI 上下文管理工具。本规则定义 **AI 在使用 Lattice 时必须遵守的工作节奏**，违反任一条都会导致项目记忆断层、任务进度丢失。

## 一、起手契约（每个新会话第一件事）

进入工作目录并准备开始任何编码、分析或回答前，**必须按顺序执行**：

1. 运行 `lattice context`：拿当前项目的聚合上下文（spec / 活跃任务 / 关联项目）
2. 如果输出显示有"活跃任务"：立即 `lattice task info <id>` 看 PRD + `lattice task progress <id>` 看 checkpoint 历史 + 若 design.md 存在则 read_file 了解讨论背景
3. 如果用户提到"规范 / 之前 / 类似 / 历史 / 跨项目"等关键词：先 `lattice search <query>` 再开始作答
4. 如果需求横跨多个仓库：先 `lattice project list --with-relations`

**违反信号**：未拿上下文就开始改文件、未看活跃任务 PRD 就独立思考实现方案。

## 二、Design 模式约束

当用户通过 `/lattice/task/design` 进入讨论模式时，**严格禁止修改业务代码文件**：

- ✅ 允许：read_file / grep_code / search / lsp / lattice 命令 / 写入 design.md
- ❌ 禁止：search_replace / create_file / delete_file / 有副作用的 run_in_terminal

**退出条件**：用户明确说"开始实施"/"动手吧"/"按方案 X 来"，或执行 `/lattice/task/start`，或发出明确的代码修改指令。

**讨论中的记录义务**：
- 讨论内容追加到任务目录下的 `design.md`
- 关键决策达成时打 `checkpoint --type decision`
- 讨论收敛后将结论回写 `prd.md`

**隐式触发**：即使未显式执行 `/lattice/task/design`，只要当前有活跃任务且对话中出现方案讨论、设计对比、架构决策等内容，也应主动将讨论过程追加到 `design.md`。隐式触发不受"禁止改代码"约束，只负责记录设计信息。

## 三、实施期 checkpoint 节奏（最关键）

任务一旦 `lattice task start`，你就进入"实施期"。**每个独立工作单元结束时必须打 checkpoint**：

| 工作单元类型 | checkpoint 类型 |
|---|---|
| 重要技术决策（方案选型 / 架构调整 / 用户拍板） | `--type decision` |
| 阶段性成果交付（一组改动通过验证） | `--type milestone` |
| 调研发现 / 实验数据 / 一次性记录 | `--type note` |
| 任务收尾总结 | `--type summary` |

**触发条件**（满足任一即必须 checkpoint）：

1. 完成了一个 PRD 子任务 / 一个 P 级阶段
2. 用户明确拍板了某个决策点
3. 一次代码改动通过了构建/验证
4. 修改了 3 个以上文件或 100 行以上代码
5. 准备切换到另一个独立工作单元

**反模式**：连续 3+ 轮工具调用无 checkpoint = 失忆风险。一旦上下文被压缩，这些改动就无法从 progress.yaml 追溯。

## 四、上下文压缩失忆恢复（长会话保命）

检测到以下信号时**必须立即刷新对当前任务的认知**：

- 上下文中出现 "summary" / "conversation summarized" / "continued from previous"
- 你不记得当前会话开头做了什么
- 用户提到"刚才那个 / 之前的方案 / 上次说的"但你印象模糊

**恢复动作**（按顺序）：

1. `lattice task list --current --status in_progress` 找到活跃任务
2. `lattice task info <id>` 重读 PRD
3. `lattice task progress <id>` 重读 checkpoint 历史
4. 若发现自上一个 checkpoint 后已做改动但未记录 → **立即补一个 checkpoint 回填**

## 五、任务完成闭环

`lattice task complete` 前**必须完成**：

0. **前置信息采集（先读后写）**：在写任何总结或更新 PRD 之前，必须先：
   - `lattice task info <id>` 拿到 PRD 路径，然后 read_file 读取 PRD 全文
   - `lattice task progress <id>` 读取全部 checkpoint 历史
   - read_file 读取 `design.md`（如存在），了解方案讨论历史
   - 回顾当前对话上下文中的决策、方案变更和最终结论
   - **禁止跳过**：未读 PRD + progress + design.md 就写总结 = 必然遗漏关键信息
1. **PRD 补全**：基于上述完整认知，把"实施完成情况"和"任务完成总结"段落补到 PRD 末尾
2. **summary checkpoint**：`--type summary` 写最终成果
3. **rag update**：`lattice rag update` 让本次产出可被未来搜索
4. （可选）**spec 沉淀**：若本次形成长期规则，同样先读 PRD + progress 再写 spec，新建/更新 project/user/global spec
5. （可选）**archive**：完成且确认无后续 → `lattice task archive`
6. **二次审阅**：归档或 spec 沉淀完成后，重新审视已写入的 PRD 总结和 spec 内容，对照 progress 和当前对话检查有无遗漏；如发现遗漏立即补充并再次 `rag update`

跳过前置信息采集 / PRD 补全 / summary / 二次审阅 / rag update = 任务记忆不完整。

## 六、Spec 优先级与冲突

项目级 spec > 用户级 spec > 全局 spec。同名冲突时：
- **以项目级为准**，但要在回答中明确告知用户存在冲突
- 用 `lattice spec conflicts` 主动检测语义冲突，不要默默吞掉差异

## 七、禁令（红线）

- ❌ 不要跳过上下文直接凭经验改陌生项目
- ❌ 不要把一次性临时需求写成长期 spec
- ❌ 不要把项目级特例直接提升为全局规则
- ❌ 不要连续多轮改动而不打 checkpoint
- ❌ 不要在 task complete 前跳过 PRD 补全或 summary
- ❌ 不要忽视上下文压缩信号而盲目继续
- ❌ 不要在 design 模式下修改业务代码文件
