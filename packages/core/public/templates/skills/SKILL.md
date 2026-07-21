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

本机跨项目上下文层，围绕 `projects`、`tasks`、`specs` 和搜索能力组织长期知识，数据根 `~/.lattice/`。CLI 别名 `lattice` / `ltc`，本文统一用 `ltc`。

## 何时使用

| 作用域 | 触发场景 |
|---|---|
| 项目身份与上下文 | 进入已注册/可能已注册的项目 / 切换工作目录 |
| 项目认知 | 编码或方案决策前确认规则；用户问"类似需求之前哪做过""有无可复用方案" |
| 跨项目协作 | 需求涉及多仓库、共享组件、跨项目任务 |
| 任务全周期 | 会话存在或将建立 lattice 任务；或需轻量模式（fast-start） |
| 知识沉淀 | 会话中形成值得长期沉淀的规则、架构决策、领域概念、方法论 |

## 文档加载策略

### 必读（首次加载 + 上下文压缩后重读）

| 文档 | 职责 |
|---|---|
| [lattice-rules.md](lattice-rules.md) | 做事节奏：起手/实施期/失忆恢复/归档硬约束清单 |
| [project-context.md](project-context.md) | 进入项目默认动作、相似需求搜索、嵌套继承 |
| [spec-workflows.md](spec-workflows.md) | spec 定义、读写流程、沉淀判定 |
| [task-workflows.md](task-workflows.md) | 任务全周期：创建/起手/实施期循环/checkpoint/归档 |

### 按需加载

| 场景 | 文档 |
|---|---|
| 项目识别、多路径绑定、AI 推断项目关系 | [project-discovery.md](project-discovery.md) |
| `/lattice/...` agent command 索引 | [agent-commands.md](agent-commands.md) |
| fast-start 轻量模式 | [fast-start-workflows.md](fast-start-workflows.md) |
| subagent 委派判定 | [subagent-delegation.md](subagent-delegation.md) |
| CLI 参数字典 | [command-reference.md](command-reference.md) |
| Lattice 异常排查 | [troubleshooting.md](troubleshooting.md) |

## 自主信息获取

对话中任何时候信息不足都应主动调用 ltc 获取，不凭记忆或猜测行事。

**核心原则**：信息齐备再动手 · 不确定就先查 · 渐进式获取 · 获取后简述结论

| 情况 | 命令 |
|---|---|
| 涉及不熟悉的模块/概念 | `ltc spec show <name>` 取路径 → Read 全文 / `ltc spec list` |
| 技术选型/架构决策 | `ltc search "<关键词>" --type task --json` → read PRD |
| 报错/兼容性问题 | `ltc search "<错误关键词>" --json` |
| 用户说"之前做过类似的" | `ltc search "<需求描述>" --json` |
| 不确定项目约定 | `ltc context --query "<主题>"` |
| 参考已完成任务 | `ltc task progress <id>` → read PRD |
| 查找本地项目/源码 | `ltc project list --search <keyword>` |
| 当前目录属于哪个项目 | `ltc project where .` / `ltc status` |
| 项目间关系 | `ltc project relation list` / `ltc project list --with-relations` |
| 活跃任务 | `ltc task list --current` |
| 索引/数据异常 | `ltc doctor` / `ltc rag status` |
| 任务进展/checkpoint | `ltc task progress <id> [--last N] [--type <type>]` |
| 查看包/依赖源码 | `ltc project list --search <包名>` → 读源码；未找到再看 node_modules/dist |
| 跨用户协作/查看其他用户数据 | `ltc search --json`（默认搜全部用户）/ `ltc spec show <name> --user <username>` / `ltc task list --current --all-user` |

## 自主元数据维护

任务进行中发现变化时当轮同步到 task.json，不拖到归档：

| 变化 | 命令 |
|---|---|
| 涉及新项目/新路径 | `ltc task associate`（与当前目录无关用 `--project <id>`） |
| 参照了某 spec | `ltc task ref-spec` |
| 发现未记录的项目间关系 | `ltc project relation add --ai-inferred` |

> task.json 结构化字段是机器可读元数据唯一来源，PRD 自然语言不能替代 CLI 记录。

## 索引维护

新建/修改 spec、PRD、项目注册后运行 `ltc rag update`（增量）；报错时降级 `ltc rag rebuild`（全量）。`ltc rag status` 查状态。

## 终端输出读取原则

**必须全量读取**（禁止行范围/head/tail/grep 截取）：Lattice 管理的文档（spec、PRD、design.md、progress.yaml、skill 文档）、`ltc search`/`ltc context` 判断有无相关项、排查错误、`ltc doctor`。

**可过滤**：已知体量大且位置固定（git log、构建日志末尾）、已知关键字用 `grep -nC 5`、格式稳定（git status --short）。

**过滤后自检**：结尾截断 → 重跑全量；看不到预期关键字 → 重跑全量再判断。

**推荐**：`wc -l` 探体量 · `grep -nC 5` 替代盲截 · 能带 `--json` 就带。

## 命令执行效率

无依赖 ltc 命令用 `&&` 串联；有依赖的分步。

```bash
ltc context --query "<主题>" && ltc task list --current && ltc spec list
```

## --force 跳过二次确认

AI 调用以下命令**必须**带 `-f`/`--force`：`ltc init` / `unlink` / `project remove` / `project relation remove` / `task delete` / `user remove` / `fast-start log clear`。

完整清单见 [command-reference.md#通用约定-f---force-跳过二次确认](command-reference.md#通用约定-f---force-跳过二次确认)。
