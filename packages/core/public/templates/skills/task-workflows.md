# 任务工作流

任务全生命周期：创建/起手/实施期循环/checkpoint/归档。硬约束见 [lattice-rules.md]；spec 见 [spec-workflows.md]。

## 任务目录结构

```
~/.lattice/users/<username>/tasks/<task-id>/
├── task.json       # 元数据唯一来源（id/title/status/projects/scopePaths）
├── prd.md          # 当前最佳认知快照，边做边修订（无 YAML frontmatter）
├── progress.yaml   # 追加型过程日志（11 类 checkpoint）
└── design.md       # 方案讨论档案（被否决方案的唯一承载点）
```

PRD 管"应该是什么"，progress 管"发生了什么"，design 管"怎么讨论出来的"。

## 任务模式：design vs implementation

`design（讨论）→ start（实施）→ design（中途）→ 实施 → archive`

- **design**：只读+分析，禁改业务代码，讨论写入 design.md
- **implementation**：start 后默认
- 未显式 design 但出现方案讨论 → 主动追加 design.md
- design 退出时 → 结论段精简为核心决策（[lattice-rules.md#二、Design 模式约束]）

## 是否新建任务：轻量改动挂既有任务

改动同时满足下表三条 → **不新建任务**，直接改，改完记入**最近一个主题相关的任务**（archived 也可追加）：

| 条件 | 判定 |
|---|---|
| 范围 | 单一主题、无方案设计、无需多轮决策（文案/注释修正、删除已收敛的副本、补一条文档规则） |
| 归属 | 存在主题相关的既有任务，其 PRD 能自然容纳这次改动（同一模块 / 同一问题的延续） |
| 记录 | 改动仍进 PRD + checkpoint——**不是**绕过记录，只是不新建任务壳 |

任一不满足 → 走 [task-workflows.md#命令参数非任务 ID 时：标题归纳与查重] 新建。

**挂既有任务的必做动作**：

1. PRD 追加一节（本轮目标 / 改动 / 验收 / 与既有轮次的关系），并同步「修改文件索引」与「遗留事项」
2. `ltc task checkpoint <id> --type <type>`——拍板用 `decision`，推翻既有判定用 `correction`，验证通过用 `milestone`
3. 任务已 archived 且其 summary checkpoint 写于本轮之前 → **必须补一条覆盖全部轮次的 summary**（旧口径已过期，`ltc search` / `task progress` 读到的会是不完整总结）
4. `ltc rag update`

**违规识别**：改动进了代码，但既没新建任务、也没挂进任何 PRD → 命中 [lattice-rules.md#八、禁令] 的「绕过 PRD 改代码」。「不新建任务」只免除任务壳，不免除记录。

## 命令参数非任务 ID 时：标题归纳与查重

0. **项目定位（必做）**：有路径 → `ltc project where <path>`；有语义 → `ltc project list --search <kw>`；与 `ltc task list --current` 用 `&&` 一次串联；定位到 → `--project <id>`，无 → `--current`
1. 归纳简洁标题
2. 查重补漏：`ltc search "<标题>" --type task --json`
3. 有相似 in_progress → 列候选给用户确认
4. `ID=$(ltc task create "<标题>" [--current | --project <id>] [--parent <id>] -q) && ltc task start "$ID"`

## 父子任务

```bash
ltc task create "<title>" --parent <parent-id>
ltc task lineage <id> / ltc task tree <id> [--descendants]
ltc task update <id> --parent <id> / --clear-parent
```

## task start 后的起手动作

**必须委派 `lattice-task-start` subagent（不支持时退化串行）；免委派客观条件见 [subagent-delegation.md#条件委派原则]。**

```bash
ltc task start <task-id>
```

信息收集（`ltc context --task <task-id> --query "<主题>"` + spec 选读）由被委派 subagent 执行；[subagent-delegation.md#条件委派原则] 免委派时主线串行执行同一清单。

1. 按主题全文读取 spec（[spec-workflows.md#按任务主题全文读取相关 spec]）：context 列表选读 + `ltc search` 补漏。读完全文后 → `ltc task ref-spec <task-id> <spec-id>` 关联（subagent 只读不关联，主线负责）
2. 参考近似历史任务 PRD（按复杂性选读相关的）
3. 完善 PRD（目标、约束、方案、文件索引、风险）；有 design.md → 先 read。不要停留在默认空白标题，只记录当前最佳认知
4. 输出 PRD 规模摘要（覆盖了哪几个关键段落）
5. 同步项目关联（[task-workflows.md#项目关联同步]）：新路径 `--paths`，新已注册项目 `--project <id>`
6. 输出整体确认（ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束）

## 实施期循环

每轮用户输入到来时循环：

```
用户输入 → 1.PRD硬触发？→ 2.spec选读？→ 3.写代码 → 4.checkpoint → 5.回答闭合自检（[lattice-rules.md#十、回答闭合自检]）
```

### 1. PRD 硬触发（T1~T8）

命中 → 先 `read_file prd.md` → 修订对应段落 → decision/pivot checkpoint → 才继续。未命中 → 跳过。

| # | 触发条件 |
|---|----------|
| T1 | 新需求/修改需求/推翻方案 |
| T2 | 采用/否决技术方案 |
| T3 | 新增/移除修改文件 |
| T4 | 单轮改 ≥3 业务文件 |
| T5 | 意外兼容性/边界/迁移问题 |
| T6 | 新依赖/模块边界/跨包调用 |
| T7 | 准备打 milestone |
| T8 | PRD 写入路径/包名/spec 但 task.json 未同步 |

### 2. spec 选读 + 历史任务参考（每轮必检）

触发条件（任一）：本轮主题词首次出现 · 用户提"规范/约定/历史/类似/跨项目" · 涉及层级判定 · 未涉及的模块边界/跨包 · 实现困难需查历史

发现：`ltc context` 标题列表选读 + `ltc search "<关键词>" --json` 补漏 → read_file 全文读取。实现困难或需先例 → `ltc search "<描述>" --type task --json` 查历史任务，相关则 read 其 PRD。

### 3. 写代码前锚点

改 ≥3 业务文件 → 先 `read_file prd.md` 校对文件索引。缺失 → T3 先改 PRD。

### 4. checkpoint 前 PRD 自检

确认：改动文件在索引中 · 决策写入"当前方案"段 · 无未同步硬触发。未过 → 先改 PRD。

### 5. 回答闭合自检

按 [lattice-rules.md#十、回答闭合自检] 条件表逐项审查，命中则执行闭合动作。信息不足 → 主动调 `ltc search` / `ltc context` 核实。

## checkpoint 类型

```bash
ltc task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

| type | 触发 | 格式 |
|---|---|---|
| `context` | 用户给出背景/规则/约束 | 原样或概述+引言 |
| `correction` | AI 犯错（用户指出/自发现） | **三段**：做错什么·为何错·正确做法 |
| `constraint` | 用户施加硬约束 | 明确"必须/不要" |
| `assumption` | AI 关键假设 | 推断内容 + 被推翻影响 |
| `followup` | 应做但延后 | 为何现在不做 |
| `note` | 客观事实 / 3 轮无 checkpoint 兜底 | 注明来源 |
| `decision` | 拍板选项 | 决策+理由 |
| `pivot` | 方向整体推翻 | 旧→新+原因 |
| `milestone` | 阶段成果验证通过 | — |
| `issue` | 非 AI 错误（环境/依赖） | — |
| `summary` | 归档前总结 | — |

**选型**：用户开口 → 用户输入类；AI 推断 → AI 判断类；客观事件 → 进程事件类；多语义 → 拆多条。

被否决方案 → design.md。查看：`ltc task progress <id> [--last N] [--type <type>]`

## 项目关联同步

| 场景 | 命令 |
|---|---|
| 当前目录项目 | `ltc task associate <id> --current` |
| 其他已注册项目 | `ltc task associate <id> --project <pid>` |
| 非注册路径 | `ltc task associate <id> --paths <path>` |

定位项目 ID：`ltc project where <path>` / `ltc project list --search <kw>`。发现新路径/项目当轮执行。

### spec 引用 + 元数据一致性

```bash
ltc task ref-spec <task-id> <spec-id>
ltc task unref-spec <task-id> <spec-id>
```

task.json 结构化字段是机器可读元数据唯一来源。PRD 写入路径/项目/spec → 同时 CLI 记录（T8）。

### 项目间关系

```bash
ltc project relation add <a> <b> --type <type> --description "证据" --ai-inferred --from-task <task-id>
```

| 现象 | 类型 |
|------|------|
| 共享 first commit / fork | `forked-from` |
| dependencies 引用 | `depends-on` |
| 共用 monorepo 包 | `shares-component` |
| 同组织无强证据 | `related` |

## 归档

**必须委派 `lattice-task-archive` subagent（不支持时退化串行）；免委派客观条件见 [subagent-delegation.md#条件委派原则]。**

### 前置采集

**必做**——未读 PRD + progress + design.md 就写归档总结 = 必然遗漏关键决策。

```bash
ltc task info <id> && ltc task progress <id>
```

progress 全量已含所有 checkpoint，重点扫 correction/constraint/context 类供核对与沉淀判定。另需：read prd.md + design.md + `git diff --stat`。

**提交核实**：确认改动是否已提交看 `git log --oneline` / `git status`。出现非自己执行的 commit 或暂存变化属正常——可能有人在并行操作同一仓库，不纠结归属，确认改动已落地即可。

### 流程

```bash
# 1. 前置采集 → 2. 核对+补 PRD（最终方案+总结+遗留）→ 3. summary checkpoint
ltc task checkpoint <id> --type summary --title "..." -m "..."
# 4. complete + archive + rag update
ltc task complete <id> && ltc task archive <id> && ltc rag update
```

### 核对

写 PRD 总结前对照 progress 核对：决策全在 PRD/checkpoint · 无遗漏改动 · 经验沉淀（[spec-workflows.md#沉淀判定]） · 项目关系补记。遗漏 → 先补再继续。

### 空参数归档推断

`ltc task list --current` + `ltc search "<主题>" --type task --json`。in_progress 仅 1 个且匹配 → 直接归档；多候选 → 列给用户。

## 输出原则

**精简**：不复述 CLI 输出、不罗列命令、不贴 JSON。

**不静默**：关键节点立即输出——创建后（标题+ID+项目）· 状态切换 · 关联变化 · 相似任务（列候选）· 归档完成（结果+要点）。

进入实施前补整体确认：ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束。
