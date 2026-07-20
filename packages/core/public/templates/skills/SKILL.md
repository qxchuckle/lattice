---
name: lattice
description: >-
  通过 Lattice CLI 获取跨项目上下文、规范、任务和搜索能力。触发词包括：
  Lattice、spec、规范、约定、项目标准、项目认知、模块职责、领域知识、
  历史方案、类似项目、跨项目经验、当前任务、共享组件、跨仓库需求、
  ~/.lattice、lattice CLI。也应在以下工作流场景主动使用：第一次进入一个
  已注册项目时先获取上下文和分层 spec；编码前先确认项目级 / 用户级 / 全局级
  规则；用户询问"之前哪个项目做过类似需求""有没有可复用方案""当前项目有
  哪些约定"时先搜索和聚合上下文；需求涉及多个仓库、共享组件或跨项目任务时
  优先查看任务和关联项目；会话中形成新的长期规则、架构决策、模块职责、
  领域概念或开发方法论时，判断是否应沉淀为项目级、用户级或全局级 spec。
---

# Lattice

Lattice 是本机的跨项目上下文层，围绕 `projects`、`tasks`、`specs` 和搜索能力组织长期知识，默认数据根目录是 `~/.lattice/`。

> **命令别名**：CLI 注册了 `lattice` 和 `ltc` 两个命令名，本文档统一使用 `ltc`。

> **frontmatter `description` 与正文「何时使用」职责区分**：frontmatter 的 `description` 是 agent 加载本 skill 时的匹配元数据，保留触发关键词供平台调度；正文「何时使用」按概念化场景说明，不再重复枚举触发词。

## 何时使用

按「作用域 + 触发场景」概念化分类（避免触发词堆砌）：

| 作用域 | 触发场景 |
|---|---|
| 项目身份与上下文 | 进入一个已注册或可能已注册的项目 / 切换工作目录 |
| 项目认知（规则 / 历史 / 约定） | 编码或方案决策前需要确认项目级 / 用户级 / 全局级规则；用户询问"类似需求之前哪做过""有没有可复用方案" |
| 跨项目协作 | 当前需求涉及多仓库、共享组件、跨项目任务 |
| 任务全周期 | 当前会话存在或将要建立 lattice 任务，需要 PRD / checkpoint / 归档闭环；或需要轻量模式（fast-start）开始工作 |
| 知识沉淀 | 会话中形成值得长期沉淀的规则、架构决策、领域概念、方法论 |

## 文档加载策略

### 必读

首次加载本 skill 时立即读取 4 个文档；触发上下文压缩后需重新读取。

| 文档 | 为什么读 | 内容 |
|---|---|---|
| [lattice-rules.md](lattice-rules.md) | **做事节奏**：起手 / 实施期循环 / 失忆恢复 / 归档 4 类硬约束清单（自含可读，每条规则末尾有 skill 子文档 anchor 用于展开） | 系统级硬性规则 |
| [project-context.md](project-context.md) | **进入动作**：第一次进入项目 / 切换工作目录时的默认动作链路 | 进入项目默认动作、相似需求搜索、嵌套项目继承 |
| [spec-workflows.md](spec-workflows.md) | **spec 全周期**：spec 是什么、何时读、写在哪一层、何时沉淀 | spec 定义、读写流程、沉淀判定、主动沉淀行为 |
| [task-workflows.md](task-workflows.md) | **任务全周期**：创建 / 起手 / 实施期多轮对话循环 / checkpoint / 归档闭环 | 任务全流程 |

### 按需加载

遇到具体场景时读。

| 场景 | 为什么读 | 文档 |
|---|---|---|
| 项目识别、多路径绑定、ID 匹配、AI 推断与记录项目关系 | **身份与关系认知**：当前目录是不是已注册项目 / 应该绑哪个项目 / 项目间关系判定与记录 | [project-discovery.md](project-discovery.md) |
| 触发或解析 `/lattice/...` agent command | **命令索引**：从 agent command 跳到底层 skill 子文档的依赖矩阵 | [agent-commands.md](agent-commands.md) |
| 收到 `/lattice/task/fast-start` 或 `/lattice/task/fast-start/to-normal` | **轻量任务模式**：fast-start 启动 / 轻量日志 / 复杂度检测 / 转正常模式 / 归档 | [fast-start-workflows.md](fast-start-workflows.md) |
| 多命令并行 / 大输出场景下的 subagent 委派 | **委派判定**：预定义 subagent 优先调度 / 临时委派判定 / 禁止委派名单 | [subagent-delegation.md](subagent-delegation.md) |
| 查 CLI 参数 / 子命令语法 | **字典**：所有 lattice CLI 参数与功能详细参考 | [command-reference.md](command-reference.md) |
| Lattice 异常（命令报错、数据缺失、搜索无结果） | **排查流程**：doctor 诊断项速查、典型问题场景、AI 决策树 | [troubleshooting.md](troubleshooting.md) |

## 自主信息获取

> **本文权威范围**：AI 在对话过程中自主调用 ltc 命令获取信息的原则。各子文档定义的具体触发条件不在此复述。

AI 不限于在起手或特定步骤才调用 ltc 命令。对话过程中任何时候发现信息不足，都应主动获取，不要凭记忆或猜测行事。

### 核心原则

- **信息齐备再动手**：开始写代码 / 做决策前，确保上下文中已有足够信息（项目约定、相关 spec、历史方案、修改文件范围）。信息缺口 = 返工风险。宁可多查一次，不要猜了再改
- **不确定就先查**：对某个模块 / 概念 / 规范 / 历史方案不确定时，先查再做事
- **渐进式获取**：不需要一开始全量加载，按当前需要获取；随着对话深入发现新信息需求时主动补充
- **获取后不静默**：多轮信息获取可全部执行完后统一简述结论（查了什么 + 得到什么关键信息），单次获取则查完即简述

### 常见场景

| 对话中出现的情况 | 获取什么 | 命令 |
|---|---|---|
| 涉及不熟悉的模块 / 概念 | 相关 spec | `ltc spec show` / `ltc spec list` |
| 技术选型 / 架构决策 | 历史决策记录 | `ltc search "<关键词>" --type task --json` → read_file PRD |
| 遇到报错 / 兼容性问题 | 类似踩坑经验 | `ltc search "<错误关键词>" --json` |
| 用户说"之前做过类似的" | 相似需求的方案 | `ltc search "<需求描述>" --json`（→ [project-context.md#跨项目相似需求搜索](project-context.md#跨项目相似需求搜索)） |
| 不确定当前项目约定 | 项目规范 | `ltc context --query "<主题>"` / `ltc spec list` |
| 需要参考已完成任务的经验 | 任务 PRD + progress | `ltc task progress <id>` → read_file PRD |
| 不确定本地有哪些项目 | 已注册项目清单 | `ltc project list --search <keyword>` / `ltc project list --with-relations` |
| 当前目录属于哪个项目 | 项目身份 | `ltc project where .` / `ltc status` |
| 不确定项目间依赖 / 关系 | 项目关系 | `ltc project relation list` / `ltc project list --with-relations` |
| 任务关联了哪些项目 | 任务的项目集合 | `ltc task info <id>` |
| 查看当前有哪些活跃任务 | 进行中任务 | `ltc task list --current`（与当前目录无关时用 `--project <id>`） |
| 数据 / 索引可能有问题 | 健康状态 | `ltc doctor` / `ltc rag status` |
| 不确定某条 spec 的完整内容 | spec 正文 | `ltc spec show <name> --detail` |
| 检查 spec 是否有层级冲突 | 冲突检测 | `ltc spec conflicts` |
| 查看任务的父子链路 / 子任务树 | 任务谱系 | `ltc task lineage <id>` / `ltc task tree <id>` |
| 不确定任务当前进展 | 最近 checkpoint | `ltc task progress <id> --last 5` |
| 查看某次纠错 / 约束的来龙去脉 | 特定类型 checkpoint | `ltc task progress <id> --type correction` / `--type constraint` |
| 不确定删除了什么能否恢复 | 垃圾桶内容 | `ltc trash list` |
| 搜索结果不准 / 索引过旧 | 索引状态 | `ltc rag status` → `ltc rag update` / `ltc rag rebuild` |
| 配置项不确定 / 需要确认默认值 | 当前配置 | `ltc config show` / `ltc config get <key>` |
| 跨用户协作 / 需要看其他用户的 spec | 其他用户数据 | `ltc search "<关键词>" --json`（默认搜全部用户）/ `ltc spec show <name> --user <username>` / `ltc task list --current --all-user` |
| 需要查看某个包/依赖/模块的源码实现 | 源码仓库 | `ltc project list --search <包名/模块名>` → 找到则 read 源码；未找到时才看 `node_modules`/`dist` 作为补充 |

> 各场景的具体触发条件与流程见对应子文档（[spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec) / [project-context.md#跨项目相似需求搜索](project-context.md#跨项目相似需求搜索) / [task-workflows.md#spec-选读触发条件](task-workflows.md#spec-选读触发条件)）。本节仅声明"可以随时自主获取"的原则。

## 自主元数据维护

> **本文权威范围**：AI 在任务进行中自主维护 task.json 元数据与项目关系的原则。具体命令与流程见 [lattice-rules.md §四](lattice-rules.md#四项目关联同步) 与 [task-workflows.md#项目关联同步](task-workflows.md#项目关联同步)。

任务进行中发现实际情况变化时，当轮同步到 task.json，不拖到归档：

| 发现的变化 | 同步动作 | 命令 |
|---|---|---|
| 任务涉及新项目 / 新路径 | 更新 `projects` / `scopePaths` | `ltc task associate`（与当前目录无关时用 `--project <id>`） |
| 参照了某 spec | 更新 `referencedSpecs` | `ltc task ref-spec` |
| 发现未记录的项目间关系 | 写入 `relations.json` | `ltc project relation add --ai-inferred` |

> **原则**：task.json 的结构化字段是机器可读元数据的唯一来源，PRD 中的自然语言描述不能替代 CLI 记录。

## 索引维护

> **本文权威范围**：索引相关命令（`ltc rag update / rebuild / status`）的使用规则。其他文档涉及索引操作时通过 `SKILL.md#索引维护` 引用，不得复述。

新建或修改 spec / 任务 PRD / 项目注册后，运行 `ltc rag update` 让搜索索引最新：

```bash
ltc rag update    # 增量更新（首选，只处理变更文档）
ltc rag rebuild   # 全量重建（rag update 报错或搜索结果明显不对时降级使用）
ltc rag status    # 查看索引状态
```

## 终端输出读取原则

> **本文权威范围**：lattice CLI 输出（context / search / spec list / project list / task progress 等）的过滤、截断、自检规则。其他文档涉及"何时可以 head/grep / 何时必须全量"时通过 `SKILL.md#终端输出读取原则` 引用，不得复述。
>
> lattice CLI 输出往往是判断依据的唯一来源，对其使用 `head` / `tail` / `grep` 等过滤手段时遵守以下规则。

### 何时可以过滤

- 已知输出体量大且关心位置固定（如 `git log -5`、构建日志末尾错误）
- 已知目标关键字 → `grep -nC 5 <keyword>` 而非盲 `head/tail`
- 输出格式稳定且领域已知（如 `git status --short`）

### 何时禁止过滤 / 必须全量

- **Lattice 管理的文档（spec、PRD、design.md、progress.yaml、skill 文档）** → 始终全量读取，禁止指定行范围、head/tail/grep 截取。这些文档每一段都可能包含关键约束或经验，部分读取 = 遗漏信息 = 返工风险
- **第一次跑某条 lattice 命令** / 不熟悉输出结构 → 先全量看再决定
- **从 `ltc search` / `ltc context` 判断"是否有相关 spec / 相似案例"** → 需看到所有候选才能下结论
- **排查错误、构建 / 测试 / `ltc doctor` 失败** → 错误可能在任意位置
- **判断"有无遗漏"类语义**（残留引用、`spec conflicts`、`project list --orphaned`）→ 必须全量或先 `wc -l` 探体量
- **输出可能 stderr/stdout 交错** → 先 `2>&1` 再考虑过滤

### 过滤后必须自检

- 看到结尾被截断 → **重跑去掉过滤或加大 N**
- 过滤后看不到预期关键字 / 行数明显少 → **重跑全量再判断**，不要直接下"不存在"结论
- 同一命令需要看多段 → `2>&1 | tee` 暂存或分两次执行

### 推荐替代

- `wc -l` 先看体量再决定要不要过滤
- `grep -nC 5 <keyword>` 替代盲截
- `awk '/起始模式/,/结束模式/'` 截取语义段落
- 能带 `--json` 就带（`ltc search --json` 等），结构化抽取比字符串过滤可靠

## 命令执行效率

多条无依赖的 ltc 命令用 `&&` 串联一次性执行，减少请求轮次、节省 token。有依赖的（如先查 ID 再用 ID 查详情）仍需分步。

```bash
# 无依赖：串联执行
ltc context --query "<当前主题>" && ltc task list --current && ltc spec list

# 有依赖：分步执行
ltc task list --current          # 先拿到 task-id
ltc task progress <task-id>      # 再用 task-id 查进度
```

## --force 跳过二次确认

> **本文权威范围**：AI / Agent 自主调用 lattice CLI 时何时必须带 `-f` / `--force` 的硬约束。其他文档涉及 --force 时通过 `SKILL.md#--force-跳过二次确认` 引用，不得复述判定逻辑。

AI / Agent 自主调用以下命令时**必须**带 `-f` / `--force`，否则会阻塞等待用户输入：`ltc init` / `unlink` / `project remove` / `project relation remove` / `task delete` / `user remove`。

完整命令清单与参数细节见 [command-reference.md#通用约定-f---force-跳过二次确认](command-reference.md#通用约定-f---force-跳过二次确认)。
