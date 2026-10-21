# 核心概念

> [English](./concepts.md) | 简体中文

Lattice 把研发上下文组织成四类资产：规范、任务、checkpoint 与项目关系。它们以纯文件形式存放在 `~/.lattice`，因此能跨会话、跨仓库、跨 Agent 持续存在。

## 规范分层

Lattice 按三个层级解析规范：

1. **全局级** — 组织范围内、与具体用户无关的约定。
2. **用户级** — 跟随某个人跨项目生效的规则。
3. **项目级** — 某个仓库的架构、边界与约定。

层级越近优先级越高：项目级高于用户级，用户级高于全局级。`ltc context` 返回带来源的合并视图，Agent 能看出某条规则来自哪一层。嵌套项目还会继承祖先项目的规范。

## 任务承载意图

任务是工作单位，不是记忆单位。它维护三个文件：

| 文件 | 回答什么 |
|---|---|
| `prd.md` | 当前应该是什么样 |
| `progress.yaml` | 发生了什么，以带类型的 checkpoint 记录 |
| `design.md` | 方案如何讨论而来，包含被否决的选项 |

任务状态依次为 `planning`、`in_progress`、`completed`、`archived`。一个任务可以关联多个项目、携带注册仓库之外的路径，也可以拆成子任务。

归档不是删除：它把已完成的任务蒸馏成可复用的经验。

## Checkpoint 承载决策

Lattice 记录 checkpoint，而不是聊天记录。11 种类型覆盖三类来源：

| 来源 | 类型 |
|---|---|
| 用户输入 | `context`、`correction`、`constraint` |
| AI 判断 | `assumption`、`followup`、`note` |
| 过程事件 | `decision`、`pivot`、`milestone`、`issue`、`summary` |

只有会改变后续工作的内容才值得写 checkpoint。如果它只是重复任务标题，就不用记。

## 项目构成关系图

项目之间的关系是显式记录的：

- `depends-on` — 一个项目消费另一个项目。
- `shares-component` — 两边共用同一个包或模块。
- `forked-from` — 共享首次提交或 fork 来源。
- `related` — 同一组织，但还没有更强证据。
- `nested-in` — 一个项目位于另一个 Git 仓库内部。

有了这张图，改动一个仓库时才能带出另一个仓库的上下文。

## 搜索在本地完成

Lattice 为本地文件建立索引，支持关键词与语义检索。索引只是缓存，不是真源：删除索引不应该删除你的记忆。

## 同步是可选项

本地文件是主存储。`ltc sync` 在你的多台机器之间同步同一套结构；同步域则把选定的经验分享给其他人。不依赖任何云服务，也没有遥测。

## 下一步

- [快速开始](./quick-start.zh-CN.md) — 安装并初始化 Lattice。
- [Web 工作台](./web-workbench.zh-CN.md) — 在浏览器里看同一套模型。
- [技术架构](./architecture.zh-CN.md) — 分层是如何构建的。
