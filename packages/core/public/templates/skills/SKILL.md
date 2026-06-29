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

> **frontmatter `description` 与正文「何时使用」职责区分**：frontmatter 的 `description` 是 agent 加载本 skill 时的匹配元数据，保留触发关键词供平台调度；正文「何时使用」按概念化场景说明，不再重复枚举触发词。

## 何时使用

按「作用域 + 触发场景」概念化分类（避免触发词堆砌）：

| 作用域 | 触发场景 |
|---|---|
| 项目身份与上下文 | 进入一个已注册或可能已注册的项目 / 切换工作目录 |
| 项目认知（规则 / 历史 / 约定） | 编码或方案决策前需要确认项目级 / 用户级 / 全局级规则；用户询问"类似需求之前哪做过""有没有可复用方案" |
| 跨项目协作 | 当前需求涉及多仓库、共享组件、跨项目任务 |
| 任务全周期 | 当前会话存在或将要建立 lattice 任务，需要 PRD / checkpoint / 归档闭环 |
| 知识沉淀 | 会话中形成值得长期沉淀的规则、架构决策、领域概念、方法论 |

## 文档加载策略

### 必读

首次加载本 skill 时立即读取；触发上下文压缩后需重新读取。

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
| 项目识别、多路径绑定、指纹选单、AI 推断与记录项目关系 | **身份与关系认知**：当前目录是不是已注册项目 / 应该绑哪个项目 / 项目间关系判定与记录 | [project-discovery.md](project-discovery.md) |
| 触发或解析 `/lattice/...` agent command | **命令索引**：从 agent command 跳到底层 skill 子文档的依赖矩阵 | [agent-commands.md](agent-commands.md) |
| 多命令并行 / 大输出场景下的 subagent 委派 | **委派判定**：什么时候该把工作拆给 subagent 而不是自己一把梭 | [subagent-delegation.md](subagent-delegation.md) |
| 查 CLI 参数 / 子命令语法 | **字典**：所有 lattice CLI 参数与功能详细参考 | [command-reference.md](command-reference.md) |
| Lattice 异常（命令报错、数据缺失、搜索无结果） | **排查流程**：doctor 诊断项速查、典型问题场景、AI 决策树 | [troubleshooting.md](troubleshooting.md) |

## 索引维护

> **本文权威范围**：索引相关命令（`lattice rag update / rebuild / status`）的使用规则。其他文档涉及索引操作时通过 `SKILL.md#索引维护` 引用，不得复述。

新建或修改 spec / 任务 PRD / 项目注册后，运行 `lattice rag update` 让搜索索引最新：

```bash
lattice rag update    # 增量更新（首选，只处理变更文档）
lattice rag rebuild   # 全量重建（rag update 报错或搜索结果明显不对时降级使用）
lattice rag status    # 查看索引状态
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

- **第一次跑某条 lattice 命令** / 不熟悉输出结构 → 先全量看再决定
- **从 `lattice search` / `lattice context` 判断"是否有相关 spec / 相似案例"** → 需看到所有候选才能下结论
- **排查错误、构建 / 测试 / `lattice doctor` 失败** → 错误可能在任意位置
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
- 能带 `--json` 就带（`lattice search --json` 等），结构化抽取比字符串过滤可靠

## --force 跳过二次确认

> **本文权威范围**：AI / Agent 自主调用 lattice CLI 时何时必须带 `-f` / `--force` 的硬约束。其他文档涉及 --force 时通过 `SKILL.md#--force-跳过二次确认` 引用，不得复述判定逻辑。

AI / Agent 自主调用以下命令时**必须**带 `-f` / `--force`，否则会阻塞等待用户输入：`lattice init` / `unlink` / `project remove` / `project relation remove` / `task delete` / `user remove`。

完整命令清单与参数细节见 [command-reference.md#通用约定-f---force-跳过二次确认](command-reference.md#通用约定-f---force-跳过二次确认)。
