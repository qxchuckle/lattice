# Lattice 工作流（系统级常驻规则）

Lattice 是跨项目的 AI 上下文管理工具。本文件定义 AI 使用 Lattice 时的硬性约束。详细流程见 skill 子文档。

## 一、起手契约（每个新会话第一件事）

1. `lattice context` —— 拿当前项目聚合上下文
2. 按当前主题精读相关 spec（`lattice context` 输出只是标题列表，看到标题不等于了解内容）
3. 有活跃任务 → `lattice task info <id>` + `lattice task progress <id>` + read_file design.md（如存在）
4. 用户提到"规范/之前/类似/历史/跨项目" → 先 `lattice search <query> --json`
5. 需求横跨多仓库 → `lattice project list --with-relations`

## 二、Design 模式约束

`/lattice/task/design` 后严格禁止修改业务代码文件。

- 允许：read_file / grep_code / search / lsp / lattice 命令 / 写入 design.md
- 禁止：search_replace / create_file / delete_file / 有副作用的 run_in_terminal

退出条件：用户明确说"开始实施"或发出代码修改指令。

记录义务：讨论追加 design.md；关键决策打 decision checkpoint；结论回写 prd.md。

未显式进入 design 但出现方案讨论时，主动追加到 design.md。

## 三、实施期循环

`lattice task start` 后，每轮执行固定循环：PRD 同步 → spec 精读 → 改代码 → 打 checkpoint。

详见 skill `task-workflows.md`「实施期多轮对话循环」。

**强制规则**：

1. PRD 硬触发清单命中 → 先改 PRD 再改代码
2. 写代码前/打 checkpoint 前/complete 前/用户推翻方案后，各有必做动作
3. 新主题先精读相关 spec
4. 代码改完必须打 checkpoint
5. 用户推翻方案 = pivot checkpoint
6. 发现可复用内容 → 立即询问用户是否沉淀为 spec
7. 及时打 checkpoint，不得延后
8. 单输入含多语义 → 拆为多条不同类型 checkpoint

颗粒度兜底：连续 3 轮未产生 checkpoint → 补 `note`。

## 四、项目关联同步

任务 start 后，实时维护 `task.json` 的 `projects` / `scopePaths`。详见 skill `task-workflows.md`「项目关联同步」。

## 五、上下文压缩失忆恢复

检测到以下任一信号时立即执行恢复：

- 上下文出现 "summary" / "conversation summarized" / "continued from previous"
- 不记得当前会话开头做了什么
- 用户提到"刚才那个/之前的方案/上次说的"但印象模糊
- 对当前项目 spec / 规范 / 工作流约束印象模糊

恢复动作（按顺序）：

1. 重新调用 `lattice` skill
2. `lattice context` + 精读相关 spec + read_file PRD / design.md
3. `lattice task list --current` → `task info` → `task progress`
4. 重载用户输入类 checkpoint（`--type correction/constraint/context`）
5. 回填缺失 checkpoint

## 六、任务完成闭环

`lattice task complete` 前必须完成：

1. 前置信息采集（详见 skill `task-workflows.md`「归档前置信息采集」）
2. PRD 补全（最终方案 + 任务完成总结）
3. summary checkpoint
4. `lattice rag update`
5. spec 沉淀判定（见 `spec-workflows.md`）
6. 二次审阅

## 七、Spec 优先级与冲突

`项目级 > 用户级 > 全局`。冲突以项目级为准，但必须告知用户。

## 八、禁令

- 跳过上下文直接凭经验改陌生项目
- 把一次性需求写成长期 spec / 把项目级特例提升为全局规则
- 绕过 PRD 直接改代码
- 打 checkpoint 前不做 PRD 自检
- PRD 拖到归档才补
- design 模式下改业务代码
- 忽视上下文压缩信号
- 任务仍挂着子任务时直接删除/归档；先迁移、清空或完成子任务
- 主动同步 skill 真源到客户端副本目录（除非任务本身需要）
- 主动 `pnpm build` / `ltc init` / `lattice rag update`（除非用户要求或任务需要）
- AI 自主调用需确认的命令时不带 `--force`

## 九、输出精简

所有输出精炼高效，不丢信息、不加冗余。省主语、省预告、省过渡、省感叹、省复述。

即将做的事直接做，不先解释。任务流程中的"精简但不静默"原则详见 skill `task-workflows.md`「输出原则」。
