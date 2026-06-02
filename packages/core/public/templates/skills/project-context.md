# 项目上下文与搜索

本文件用于“进入项目先看什么”和“如何搜索类似经验”。

## 进入项目时的默认动作

如果当前目录属于已注册项目，优先运行：

```bash
lattice context
lattice status
```

需要明确的关键信息：

- 当前项目有哪些项目级 spec
- 是否存在用户级 / 全局级补充规则
- 当前项目是否有关联任务
- 是否存在 spec 冲突或历史上下文

## 用户提到相似需求时

先运行：

```bash
lattice search "<查询词>" --json
```

如果结果和任务相关，再补：

```bash
lattice task list --current
lattice context --task <id>
```

## 项目关系

当工作涉及多个项目、共享组件或跨仓库依赖时，查看项目关系：

```bash
lattice project list --with-relations
lattice project relation list <id>
```

如果发现项目间存在未记录的依赖或协作关系，主动建议用户添加：

```bash
lattice project relation add <project-a> <project-b> --type <type>
```

## 跨用户聚合

`lattice context` 默认聚合所有用户为同一项目定义的 spec 和关系。当需要精确控制跨用户范围时：

```bash
# 关系：默认聚合所有用户，可精确指定
lattice project relation list <id> --user <users>    # 仅看指定用户的关系
lattice project relation list <id> --current-user    # 仅看当前用户的关系

# 任务：跨用户聚合需显式开启
lattice task list --current --all-user               # 聚合所有用户的任务
lattice task list --current --user <users>           # 仅看指定用户的任务

# Spec：查看其他用户的 spec
lattice spec show <file> --user <username> --detail
```

> **注意**：`--user` 中指定不存在的用户名会报错并列出可用用户列表。`--user` 与 `--current-user` / `--all-user` 互斥。

## 输出要求

- 不要直接转储整份上下文
- 优先提炼与当前请求最相关的规则、历史方案和风险
- AI / Agent 调用 `lattice search` 时优先带上 `--json`，先读取结构化结果再组织结论
- 如果当前目录不是 Lattice 项目，明确说明，并提示可先运行 `lattice link`

## 相关命令

```bash
lattice context
lattice context --task <id>
lattice status
lattice search <query> --json
lattice project list [--with-relations]
lattice project info <id>
lattice project relation list [id] [--current-user] [--user <users>]
lattice task list --current [--all-user] [--user <users>]
lattice spec show <file> [--user <username>] [--detail]
```
