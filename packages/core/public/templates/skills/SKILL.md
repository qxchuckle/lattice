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

跨项目上下文层：`projects` + `tasks` + `specs` + 搜索。数据根 `~/.lattice/`，CLI 别名 `ltc`。

## 何时使用

| 触发场景 | 作用域 |
|---|---|
| 进入/切换项目目录 | 项目身份与上下文 |
| 编码前确认规则；问"类似需求哪做过""有无可复用方案" | 项目认知 |
| 多仓库、共享组件、跨项目任务 | 跨项目协作 |
| 存在或将建立 lattice 任务 | 任务全周期 |
| 形成值得沉淀的规则/决策/概念/方法论 | 知识沉淀 |

## 文档加载

### 必读（首次 + 压缩后重读）

| 文档 | 职责 |
|---|---|
| [lattice-rules.md](lattice-rules.md) | 起手/实施期/失忆恢复/归档硬约束/回答闭合自检 |
| [project-context.md](project-context.md) | 进入项目动作、搜索、嵌套继承 |
| [spec-workflows.md](spec-workflows.md) | spec 读写、沉淀判定 |
| [task-workflows.md](task-workflows.md) | 任务全周期 |
| [subagent-delegation.md](subagent-delegation.md) | 委派判定、dispatch prompt 契约、返回格式 |

### 按需（执行对应动作前读取）

| 硬触发 | 文档 |
|---|---|
| 注册/识别项目 · 多路径判定 · AI 推断项目关系 · 非 cwd 路径首次出现 | [project-discovery.md](project-discovery.md) |
| 执行或索引 agent command · 不确定有哪些 slash command 可用 | [agent-commands.md](agent-commands.md) |
| 使用 fast-start 流程 · `ltc fast-start` 相关操作 | [fast-start-workflows.md](fast-start-workflows.md) |
| 使用不确定的 `ltc` 命令/参数/选项 · 需要确认完整参数格式 | [command-reference.md](command-reference.md) |
| `ltc` 命令程序性异常报错 · RAG 搜索结果异常 · 索引/数据不一致 | [troubleshooting.md](troubleshooting.md) |

## 自主信息获取

信息不足 → 主动调 ltc，不凭记忆行事。原则：齐备再动手 · 不确定先查 · 渐进获取 · 获取后简述结论

| 情况 | 命令 |
|---|---|
| 陌生模块/概念 | `ltc spec show <name>` → Read / `ltc spec list` |
| 技术选型/架构 | `ltc search "keyA keyB" --type task --json` → read PRD |
| 报错/兼容性 | `ltc search "<error>" --json` |
| "之前做过类似的" | `ltc search "<描述>" --json` |
| 不确定约定 | `ltc context --query "<主题>"` |
| 参考已完成任务 | `ltc task progress <id>` → read PRD |
| 查找项目/源码 | `ltc project list --search <kw>` |
| 当前目录项目 | `ltc project where .` / `ltc status` |
| 注册非 cwd 项目 | `ltc project register <paths...>` |
| 项目间关系 | `ltc project list --with-relations` |
| 活跃任务 | `ltc task list --current` |
| 索引异常 | `ltc doctor` / `ltc rag status` |
| 任务进展 | `ltc task progress <id> [--last N] [--type <type>]` |
| 跨用户 | `ltc search --json` / `ltc spec show <name> --user <u>` / `ltc task list --current --all-user` |

## 元数据维护（发现变化当轮同步）

| 变化 | 命令 |
|---|---|
| 新项目/路径 | `ltc task associate`（非 cwd 用 `--project <id>`） |
| 参照 spec | `ltc task ref-spec` |
| 未记录关系 | `ltc project relation add --ai-inferred` |

**task.json 是机器可读元数据唯一来源，PRD 自然语言不可替代。**

**回答闭合时**：逐项审查上表是否触发（→ [lattice-rules.md §十](lattice-rules.md#十回答闭合自检)）。

## 索引维护

spec/PRD/项目变更后 → `ltc rag update`；报错 → `ltc rag rebuild`。

## 终端输出读取

- **全量读取**：Lattice 文档（spec/PRD/design/progress/skill）、`ltc search`/`context`、排错、`ltc doctor`
- **可过滤**：git log、构建日志（`grep -nC 5`）、`git status --short`
- **自检**：截断/缺预期关键字 → 重跑全量
- 无依赖命令 `&&` 串联；能带 `--json` 就带

## --force

AI 调用必须带 `-f`：`init` / `unlink` / `project remove` / `project relation remove` / `task delete` / `user remove` / `fast-start log clear`。完整清单 → [command-reference.md](command-reference.md#通用约定-f---force-跳过二次确认)。
