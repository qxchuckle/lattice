# Agent Commands

Lattice 会向支持 commands 的 agent 注入一组工作流命令。它们是 agent 入口，**不等同于 CLI 子命令本身**。

## 命令清单与用途

| 命令 | 何时使用 | 详细说明所在文件（位于 lattice commands 目录） |
|---|---|---|
| `/lattice/context` | 快速拿到项目或任务上下文 | `context.md` |
| `/lattice/keep` | 保持 Lattice 工作流的轻量提示器，可在单窗口连续对话时频繁使用；快速核对任务身份 / 工作流约束 / spec 清单 / PRD 范围 / 漂移；默认一行简报；参数可附加用户后续请求 | `keep.md` |
| `/lattice/task/query` | 查询项目情况 / 任务进展 / 历史完成情况（**只读**） | `task/query.md` |
| `/lattice/task/design` | 讨论方案 / 分析设计而不动代码 | `task/design.md` |
| `/lattice/task/start` | 开始实施任务并同步上下文 | `task/start.md` |
| `/lattice/task/checkpoint` | 记录任务关键进展 | `task/checkpoint.md` |
| `/lattice/task/archive` | 结束任务并判断是否沉淀规则 | `task/archive.md` |
| `/lattice/spec/update/project` | 沉淀当前项目特有规则 / 认知 | `spec/update/project.md` |
| `/lattice/spec/update/user` | 沉淀跨项目可复用、属于当前用户的规则 / 认知 | `spec/update/user.md` |
| `/lattice/spec/update/global` | 沉淀多用户多项目共享的默认规则 | `spec/update/global.md` |

> **说明**：commands 文件部署在客户端 `commands/lattice/` 目录下，与本 skill 不在同一相对路径。AI 接收 `/lattice/...` 命令时，agent 客户端会自动加载对应 commands 文件，本表只用于查找文件名。

## 层级判断（spec/update/*）

层级判定标准统一见 [spec-workflows.md → 选择写入层级](spec-workflows.md#选择写入层级)。

## 与 CLI 的关系

- **Agent Commands 负责组织 workflow**（按动词组织：进入上下文 / 查询 / 讨论 / 开始 / 归档 / 沉淀）
- **CLI 负责真正执行**（读写、搜索、列举、状态更新）
- 输出时总结关键结论，不机械回显命令结果
