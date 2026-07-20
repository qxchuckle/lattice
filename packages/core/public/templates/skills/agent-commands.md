# Agent Commands

> **本文权威范围**：agent 平台注入的 `/lattice/...` 工作流命令清单 + 它们对应的 commands 文件路径。
>
> 本文**不讲命令背后的工作流**：收到 `/lattice/task/start` 后该做什么 → [task-workflows.md](task-workflows.md)；收到 `/lattice/spec/update/...` 后该做什么 → [spec-workflows.md](spec-workflows.md)；收到 `/lattice/context` 后该做什么 → [project-context.md](project-context.md)。
>
> 本文也**不等于 CLI 子命令**：agent commands 是 agent 入口，CLI 子命令参数字典见 [command-reference.md](command-reference.md)。

Lattice 会向支持 commands 的 agent 注入一组工作流命令。它们是 agent 入口，**不等同于 CLI 子命令本身**。

## 命令清单与用途

> 何时读：收到以 `/lattice/` 开头的命令 / 需要查某个命令对应的 commands 文件名时 → 下一步：agent 客户端会自动加载对应 commands 文件，本表只用于查阅。

| 命令 | 何时使用 | 背后依赖的 skill 子文档 | commands 文件 |
|---|---|---|---|
| `/lattice/context` | 快速拿到项目或任务上下文 | [project-context.md](project-context.md) | `context.md` |
| `/lattice/keep` | 保持 Lattice 工作流的轻量提示器，可在单窗口连续对话时频繁使用；快速核对任务身份 / 工作流约束 / spec 清单 / PRD 范围 / 漂移；默认一行简报；参数可附加用户后续请求 | [SKILL.md](SKILL.md) + [lattice-rules.md](lattice-rules.md) | `keep.md` |
| `/lattice/task/query` | 查询项目情况 / 任务进展 / 历史完成情况（**只读**） | [project-context.md](project-context.md) + [task-workflows.md](task-workflows.md) | `task/query.md` |
| `/lattice/task/design` | 讨论方案 / 分析设计而不动代码 | [task-workflows.md](task-workflows.md)（design 模式） | `task/design.md` |
| `/lattice/task/start` | 开始实施任务并同步上下文 | [task-workflows.md](task-workflows.md) + [spec-workflows.md](spec-workflows.md) + [project-context.md](project-context.md) | `task/start.md` |
| `/lattice/task/fast-start` | 以轻量模式开始工作（获取上下文和 spec，不创建任务 / PRD / checkpoint） | [fast-start-workflows.md](fast-start-workflows.md) + [project-context.md](project-context.md) + [spec-workflows.md](spec-workflows.md) | `task/fast-start.md` |
| `/lattice/task/fast-start/to-normal` | 将 fast-start 会话转入正常任务模式 | [fast-start-workflows.md](fast-start-workflows.md) + [task-workflows.md](task-workflows.md) | `task/fast-start/to-normal.md` |
| `/lattice/task/checkpoint` | 记录任务关键进展 | [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件) | `task/checkpoint.md` |
| `/lattice/task/archive` | 结束任务并判断是否沉淀规则 | [task-workflows.md#归档流程](task-workflows.md#归档流程) + [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定) | `task/archive.md` |
| `/lattice/task/delete` | 删除任务（自然语言匹配 / 删除当前任务 / 风险确认） | [task-workflows.md](task-workflows.md) + [command-reference.md](command-reference.md) | `task/delete.md` |
| `/lattice/spec/update/project` | 沉淀当前项目特有规则 / 认知 | [spec-workflows.md#写入流程](spec-workflows.md#写入流程) | `spec/update/project.md` |
| `/lattice/spec/update/user` | 沉淀跨项目可复用、属于当前用户的规则 / 认知 | [spec-workflows.md#写入流程](spec-workflows.md#写入流程) | `spec/update/user.md` |
| `/lattice/spec/update/global` | 沉淀多用户多项目共享的默认规则 | [spec-workflows.md#写入流程](spec-workflows.md#写入流程) | `spec/update/global.md` |
| `/lattice/spec/sediment` | AI 自主识别可沉淀内容并判定层级，用户确认后批量写入 | [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定) + [spec-workflows.md#写入流程](spec-workflows.md#写入流程) | `spec/sediment.md` |
| `/lattice/project/profile` | 为项目生成/更新智能画像（summary.md + tags），支持增量 | [command-reference.md](command-reference.md) | `project/profile.md` |

> **说明**：commands 文件部署在客户端 `commands/lattice/` 目录下，与本 skill 不在同一相对路径。AI 接收 `/lattice/...` 命令时，agent 客户端会自动加载对应 commands 文件，本表只用于查找文件名与背后依赖的 skill 子文档。

## 层级判断（spec/update/*）

> 何时读：收到 `/lattice/spec/update/{project|user|global}` 任一变体、或 AI 主动拟沉淀规则但不确定层级时 → 下一步：按 [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定) 的梯子选层，不要默认写 global。

层级判定标准统一见 [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)。

## 与 CLI 的关系

> 何时读：考虑"agent commands与 CLI 是什么关系"或决定输出详略时 → 下一步：按以下分工拼装响应。

- **Agent Commands 负责组织 workflow**（按动词组织：进入上下文 / 查询 / 讨论 / 开始 / 归档 / 沉淀）
- **CLI 负责真正执行**（读写、搜索、列举、状态更新）——参数详见 [command-reference.md](command-reference.md)
- 输出时总结关键结论，不机械回显命令结果（详见 [SKILL.md#终端输出读取原则](SKILL.md#终端输出读取原则)）
