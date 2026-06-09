# 项目上下文与搜索

> **本文权威范围**：进入项目默认动作 / 跨项目相似需求搜索 / 嵌套项目继承 / 跨用户聚合。项目身份识别 / 多路径绑定 / 项目关系推断见 [project-discovery.md](project-discovery.md)；spec 概念 / 选读 / 沉淀见 [spec-workflows.md](spec-workflows.md)。
>
> 本文**不复述** lattice CLI 输出过滤规则（→ [SKILL.md#终端输出读取原则](SKILL.md#终端输出读取原则)）。
>
> **章节阅读约定**：每个一级 `##` 章节顶部以 `> 何时读 / 下一步` 一句话点题。

## 进入项目默认动作

> 何时读：会话开始、进入一个项目、切换工作目录后，或上下文压缩恢复后 → 下一步：拿到上下文后跳到 [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec) 选读 spec。

```bash
lattice context
lattice status
```

需要明确的关键信息：

- 项目级 / 用户级 / 全局级 spec 列表
- 当前项目的活跃任务
- 是否存在 spec 冲突或历史上下文
- 是否处于嵌套项目中（自动从祖先继承 spec）

> ⚠️ **spec 列表 ≠ spec 内容**：`lattice context` 输出只是标题 + 路径 + 摘要（摘要常缺失）。必须按当前主题精读相关 spec——详见 [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)。

如果当前目录不是 Lattice 项目，明确告诉用户，提示先 `lattice link`（详见 [project-discovery.md](project-discovery.md)）。

## 跨项目相似需求搜索

> 何时读：用户提到"类似需求之前哪做过""有没有可复用方案""之前那个项目怎么做的"时 → 下一步：根据 search 结果决定是否进一步 `lattice spec show` / `read_file PRD`。

```bash
lattice search "<查询词>" --json
```

> **AI 调用 search 时优先带 `--json`**，便于读取结构化结果（类型 / 分数 / 路径 / meta）后再推理与筛选。

如果结果与任务相关，再补：

```bash
lattice task list --current
lattice context --task <id>
```

## 嵌套项目继承

> 何时读：进入一个位于其它项目子目录下的项目时，或 `lattice status` 提示嵌套继承层级时 → 下一步：明晰 spec 来源后繼续作业。

当前项目位于另一个已注册 Lattice 项目的子目录时，`lattice context` 自动继承祖先项目的 spec。

- **自动检测**：`lattice link` 时自动向上检测并创建 `nested-in` 关系（`createdBy=auto`）
- **级联优先级**：`当前项目 > 直接父级 > 更远祖先 > 用户级 > 全局级`（就近优先覆盖）
- **只继承 spec，不继承任务**
- `lattice status` 显示嵌套继承层级信息

典型场景：monorepo 中子包（`packages/foo`）和根目录都注册为 Lattice 项目，子包自动继承根项目规范。

## 项目关系

> 何时读：工作涉及多个项目 / 共享组件 / 跨仓库依赖时 → 下一步：发现未记录的依赖 / 协作 → 跳到 [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断) 看如何主动补充关系。

工作涉及多个项目、共享组件或跨仓库依赖时：

```bash
lattice project list --with-relations
lattice project relation list <id>
```

如果发现项目间存在未记录的依赖或协作关系，主动建议添加（详见 [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）。

## 跨用户聚合

> 何时读：同一项目被多个本机用户同时使用 / 需要看到其他用户的 spec / 跨用户任务聚合时 → 下一步：按需加 `--user` / `--all-user` / `--current-user` 参数。

`lattice context` 默认聚合所有用户为同一项目定义的 spec 和关系。需要精确控制时：

```bash
# 关系：默认聚合所有用户
lattice project relation list <id> --user <users>    # 仅指定用户
lattice project relation list <id> --current-user    # 仅当前用户

# 任务：跨用户聚合需显式开启
lattice task list --current --all-user               # 聚合所有用户
lattice task list --current --user <users>           # 仅指定用户

# Spec：查看其他用户的 spec
lattice spec show <file> --user <username> --detail
```

> `--user` 中指定不存在的用户名会报错并列出可用用户。`--user` 与 `--current-user` / `--all-user` 互斥。

## 输出要求

> 何时读：任何状态下调用本文描述的各类命令后给用户输出时 → 下一步：以下原则决定输出体量与内容。

- 不要直接转储整份上下文，提炼与当前请求最相关的规则、历史方案和风险
- AI 调用 `lattice search` 优先带 `--json`
- 当前目录不是 Lattice 项目时明确说明，并提示 `lattice link`
