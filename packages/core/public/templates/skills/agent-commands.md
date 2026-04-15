# Agent Commands

Lattice 会向支持 commands 的 agent 注入一组工作流命令。它们是 agent 入口，不等同于 CLI 子命令本身。

## 可用命令

- `/lattice/context`
- `/lattice/task/start`
- `/lattice/task/archive`
- `/lattice/spec/update/project`
- `/lattice/spec/update/user`
- `/lattice/spec/update/global`

## 使用原则

- 需要快速拿到项目或任务上下文时，用 `/lattice/context`
- 需要开始一个任务并同步上下文时，用 `/lattice/task/start`
- 需要结束任务并判断是否沉淀规则时，用 `/lattice/task/archive`
- 需要把会话经验写成长期规范时，用 `/lattice/spec/update/*`

## 层级判断

- 当前项目特有规则：`/lattice/spec/update/project`
- 当前用户或团队跨项目可复用规则：`/lattice/spec/update/user`
- 多用户、多项目共享的默认规则：`/lattice/spec/update/global`

## 与 CLI 的关系

- Agent Commands 负责组织 workflow
- CLI 负责真正执行读写、搜索、列举和状态更新
- 输出时要总结关键结论，不要机械回显命令结果
