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
- 是否处于嵌套项目中（自动从祖先项目继承 spec）

**关键：spec 列表不等于 spec 内容**。`lattice context` 输出的是 spec 标题 + 路径 + 摘要（摘要常常是"[缺失摘要]"），**看到标题不等于了解内容**。spec 同时是行为约束和 AI 认识项目的稳定经验（项目结构、模块职责、领域概念、设计动机、方法论），必须按当前任务/请求主题挑选相关 spec read_file 精读：

- 认知类 spec（系统架构 / 模块边界 / 领域概念 / 项目结构 / 方法论）默认应读
- 约束类 spec（编码规范、提交流程）按本次会修改的代码范围决定是否读
- 摘要缺失或泛泛的，更必须读正文

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

## 嵌套项目继承

当前项目如果位于另一个已注册 Lattice 项目的子目录中，`lattice context` 会自动继承祖先项目的 spec。

- 继承规则：无需手动配置，`lattice link` 时自动向上检测并创建 `nested-in` 关系
- 级联优先级：`当前项目 > 直接父级 > 更远祖先 > 用户级 > 全局级`（就近优先覆盖）
- 只继承 spec，不继承任务
- `lattice status` 会显示嵌套继承层级信息

典型场景：monorepo 中子包（`packages/foo`）和根目录都注册为 Lattice 项目，子包自动继承根项目的规范。

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
