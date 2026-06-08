# Lattice 工作流（系统级常驻规则）

Lattice 是跨项目的 AI 上下文管理工具。本规则定义 **AI 在使用 Lattice 时必须遵守的工作节奏**——硬性约束清单。每条规则的展开说明都引用到 lattice skill 子文档，不要在本文件重复定义。

> **跨文档引用约定**：本文件部署在客户端 rules 目录，与 skill 文档不在同一相对路径下。所有跨文档引用都不写相对路径，统一格式 `skill：<filename>.md 的「章节」`，AI 加载 lattice skill 后通过 `SKILL.md` 的渐进式加载导航即可定位。
>
> 子文档清单（均位于 lattice skill 目录）：`SKILL.md` / `project-context.md` / `spec-workflows.md` / `task-workflows.md` / `project-discovery.md` / `command-reference.md` / `agent-commands.md` / `subagent-delegation.md`。

## 一、起手契约（每个新会话第一件事）

进入工作目录、开始任何编码 / 分析 / 回答前**必须按顺序执行**：

1. `lattice context` —— 拿当前项目聚合上下文（spec / 活跃任务 / 关联项目）
2. **按当前主题精读相关 spec**：详见 skill `spec-workflows.md` 的「按任务主题精读相关 spec」。`lattice context` 输出只是标题列表，**看到标题不等于了解内容**
3. 输出显示有"活跃任务" → `lattice task info <id>` 看 PRD + `lattice task progress <id>` 看 checkpoint 历史 + 若 design.md 存在则 read_file
4. 用户提到"规范 / 之前 / 类似 / 历史 / 跨项目"等关键词 → 先 `lattice search <query> --json` 再作答
5. 需求横跨多个仓库 → 先 `lattice project list --with-relations`

**违反信号**：未拿上下文就改文件 / 未看活跃任务 PRD 就独立思考实现方案 / 只看 spec 标题就动手而未精读相关 spec 正文。

## 二、Design 模式约束

通过 `/lattice/task/design` 进入讨论模式后**严格禁止修改业务代码文件**：

- ✅ 允许：read_file / grep_code / search / lsp / lattice 命令 / 写入 `design.md`
- ❌ 禁止：search_replace / create_file / delete_file / 有副作用的 run_in_terminal

**退出条件**：用户明确说"开始实施" / "动手吧" / "按方案 X 来"，或执行 `/lattice/task/start`，或发出明确的代码修改指令。

**讨论中的记录义务**：讨论内容追加 `design.md`；关键决策达成时打 `checkpoint --type decision`；讨论收敛后将结论回写 `prd.md`。

**隐式触发**：未显式执行 `/lattice/task/design`，只要存在活跃任务且对话出现方案讨论 / 设计对比 / 架构决策，也应主动追加到 `design.md`。隐式触发不受"禁止改代码"约束，只负责记录设计信息。

## 三、实施期循环：PRD → spec → code → progress（每轮必做）

任务 `lattice task start` 后进入"实施期"。**任何用户新输入到来时**都要执行固定循环：

```
用户输入 → 是否影响目标 / 范围 / 约束 / 方案 / 取舍 / 文件清单 / 风险？
  ├─ 是：先 search_replace 改 prd.md + decision/pivot checkpoint
  └─ 否：跳过 PRD 修订
→ 涉及没读过的模块 / 概念？是 → read_file 精读相关 spec
→ 实际改代码 / 文件
→ 打 checkpoint 记录这一轮进展
```

**强制规则**（详见 skill `task-workflows.md` 的「实施期多轮对话循环」）：

1. **PRD 永远不能落后于代码**："嘴上答应了、代码改了、PRD 没动" = 失忆最大来源
2. **新主题先选读 spec**：不能凭"之前 lattice context 看过标题"就动手
3. **代码改完必须打 checkpoint**：连续 5 个小修改也至少 1 个 milestone/note checkpoint
4. **用户推翻方案 = 必须 pivot checkpoint**

**checkpoint 类型对照表 + 触发条件**：详见 skill `task-workflows.md` 的「checkpoint 类型与触发」。

**反模式**：连续 3+ 轮工具调用无 checkpoint = 失忆风险 / PRD 与代码漂移 / 任务过程中冒出长期可复用规则却推到归档时再考虑沉淀。

## 三.五、实际工作项目关联（实施期同步义务）

任务 `start` 后，AI 有义务**实时维护 `task.json` 的 `projects` / `scopePaths`**，使其始终反映实际工作范围。详见 skill `task-workflows.md` 的「项目关联同步（实施期同步义务）」。

**违反信号**：任务归档时 `projects` 中只有创建时的项目，但对话中实际操作了其他项目路径的文件。

## 四、上下文压缩失忆恢复（长会话保命）

检测到以下信号时**必须立即执行完整恢复流程**：

- 上下文出现 "summary" / "conversation summarized" / "continued from previous"
- 不记得当前会话开头做了什么
- 用户提到"刚才那个 / 之前的方案 / 上次说的"但印象模糊
- 对当前项目 spec / 规范 / 工作流约束印象模糊

**恢复动作**（按顺序，不可跳过）：

1. **重新加载 Lattice skill**：用 Skill 工具重新调用 `lattice` skill，让 SKILL.md 和本文件重新进入上下文
2. **重新获取项目上下文**：`lattice context`，按主题重新挑选相关 spec read_file 精读（见 skill `spec-workflows.md` 的「按任务主题精读相关 spec」）。如有 PRD / design.md 也重新 read_file
3. **恢复任务状态**：`lattice task list --current --status in_progress` → `lattice task info <id>` → `lattice task progress <id>` → 若有 `design.md` 则 read_file
4. **回填缺失 checkpoint**：自上一个 checkpoint 后已做改动但未记录 → 立即补 checkpoint

**关键原则**：上下文压缩后的恢复等价于"起手契约"重新执行。仅恢复任务进度而丢失 skill 规则和项目规范认知 = 后续操作很可能违反工作流约束。

## 五、任务完成闭环

`lattice task complete` 前**必须完成**：

0. **前置信息采集（先读后写）**：详见 skill `task-workflows.md` 的「归档前置信息采集（强制，先读后写）」。**禁止跳过**：未读 PRD + progress + design.md 就写总结 = 必然遗漏关键信息
1. **PRD 补全**：基于完整认知，把"实施完成情况"和"任务完成总结"段落补到 PRD 末尾
2. **summary checkpoint**：`--type summary` 写最终成果
3. **rag update**：`lattice rag update` 让本次产出可被未来搜索（详见 skill `SKILL.md` 的「索引维护」）
4. **spec 沉淀**（条件性强制）：判定标准统一见 skill `spec-workflows.md` 的「沉淀判定（统一标准）」，写入流程统一见 skill `spec-workflows.md` 的「spec 写入流程（先读后写 + 二次审阅）」
5. （可选）**archive**：完成且确认无后续 → `lattice task archive`
6. **二次审阅**：详见 skill `task-workflows.md` 的「归档后二次审阅（强制）」；发现遗漏立即补充并再次 `rag update`

跳过前置采集 / PRD 补全 / summary / 二次审阅 / rag update = 任务记忆不完整。

## 六、Spec 优先级与冲突

`项目级 > 用户级 > 全局`。同名冲突 → **以项目级为准**，但要在回答中明确告知用户存在冲突。`lattice spec conflicts` 主动检测语义冲突，不要默默吞掉差异。

层级与嵌套继承详见 skill `spec-workflows.md` 的「层级优先级」。

## 七、禁令（红线）

- ❌ 跳过上下文直接凭经验改陌生项目
- ❌ 把一次性临时需求写成长期 spec
- ❌ 把项目级特例直接提升为全局规则
- ❌ 连续多轮改动而不打 checkpoint
- ❌ 在 task complete 前跳过 PRD 补全或 summary
- ❌ 忽视上下文压缩信号而盲目继续
- ❌ 用户提出新想法 / 修改方案后绕过 PRD 直接改代码（违反第三节循环）
- ❌ 主动同步 skill / command 真源到 `~/.qoder/`、`~/.claude/`、`~/.cursor/` 等本地客户端副本目录——那是与源码无关的本地环境操作，应留给用户手工执行（除非当前任务本身就是验证副本同步流程）
- ❌ 主动 `pnpm build`、`ltc init`、`lattice rag update`，除非用户明确要求或当前任务确实需要
- ❌ 在 design 模式下修改业务代码文件
- ❌ AI 自主调用需二次确认的命令时不带 `-f` / `--force`（详见 skill `SKILL.md` 的「--force 跳过二次确认（核心约束）」）

## 八、输出语言精简（节省 token）

所有文本输出必须精炼高效：**不丢信息、不加冗余**。任务流程相关的"精简但不静默"原则详见 skill `task-workflows.md` 的「输出原则：精简但不静默」。

### 核心原则

| 原则 | 说明 |
|---|---|
| 省主语 | 默认主语是 AI，无需"我现在…" / "让我来…" |
| 省预告 | 即将做的事直接做，不先解释一遍 |
| 省过渡 | 删去"接下来" / "然后" / "现在"等无信息量连接词 |
| 省感叹 | 不用"好的！" / "太好了！" / "完美！"开头 |
| 省复述 | 用户刚说过的不重复，除非需要消歧 |

### 典型冗余 → 精简

| 冗余 | 精简 |
|---|---|
| 现在我对实现细节有完整了解了。让我编写 PRD 并开始实现 | 已了解实现细节，编写 PRD 开始实现 |
| 让我先运行一下测试看看是否通过 | *（直接运行，不预告）* |
| 我已经成功地完成了所有必要的更改 | 所有修改已完成 |
| 根据我的分析，我认为最好的方案是使用 X | 分析结论：用 X |
| 好的，我现在来帮你处理这个问题 | *（直接处理）* |
| 我注意到这个文件中有一个问题需要修复 | 发现问题：… |

### 格式精简

- 操作序列用动宾短语串联：「读取 PRD → 分析依赖 → 修改入口」
- 状态报告用最短完整表达：「3 文件已改，测试通过」
- 发现 / 结论类用标签前缀：「发现：X 依赖 Y」「结论：方案 B」

### 允许展开

- 解释复杂技术决策的理由
- 用户明确要求详细说明
- 方案对比（信息密度本身就高，不算冗余）
- 存在歧义需要澄清

### 反模式

- ❌ 每个工具调用前写一段"我现在要做 X"
- ❌ 完成后写"太好了，X 已经成功完成了"
- ❌ 对用户指令先复述一遍再开始
- ❌ 用多个短句重复表达同一个意思
- ❌ 在技术内容前后包裹非技术性"社交"句子
