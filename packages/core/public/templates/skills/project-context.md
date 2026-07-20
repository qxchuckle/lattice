# 项目上下文与搜索

> **本文权威范围**：进入项目默认动作 / 跨项目相似需求搜索 / 嵌套项目继承 / 跨用户聚合。项目身份识别 / 多路径绑定 / 项目关系推断见 [project-discovery.md](project-discovery.md)；spec 概念 / 选读 / 沉淀见 [spec-workflows.md](spec-workflows.md)。
>
> 本文**不复述** lattice CLI 输出过滤规则（→ [SKILL.md#终端输出读取原则](SKILL.md#终端输出读取原则)）。
>
> **章节阅读约定**：每个一级 `##` 章节顶部以 `> 何时读 / 下一步` 一句话点题。

## 进入项目默认动作

> 何时读：会话开始、进入一个项目、切换工作目录后，或上下文压缩恢复后 → 下一步：拿到上下文后跳到 [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec) 选读 spec。
>
> 委派：此流程优先委派预定义 subagent `lattice-context` 执行，主线只等摘要结论。

```bash
ltc context --query "<当前任务主题/用户意图关键词>"
ltc status
```

> **强制**：AI 调用 `ltc context` 时必须带 `--query`，传入当前任务主题、用户意图或任务描述。输出会自动携带「语义关联」节（相关 spec、参考任务、项目，已去重），减少额外 search 调用。

需要明确的关键信息：

- 项目级 / 用户级 / 全局级 spec 列表
- 当前项目的活跃任务
- 是否存在 spec 冲突或历史上下文
- 是否处于嵌套项目中（自动从祖先继承 spec）

> ⚠️ **spec 列表 ≠ spec 内容**：`ltc context` 输出只是标题 + 路径 + 摘要（摘要常缺失）。必须按当前主题精读相关 spec——详见 [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)。
>
> ⚠️ **宁多勿少**：不确定某条 spec 是否相关时，读而非跳过。漏读代价远高于多读。
>
> ⚠️ **持续补读**：spec 精读不是起手一次性动作。任务推进中涉及新模块 / 新概念时，回看 spec 列表补读相关项。
>
> ⚠️ **源码查找优先级**：需要查看某个依赖包/模块/组件的源码时，优先 `ltc project list --search <包名>` 定位本地源码仓库，而不是直接翻 `node_modules`/`dist`。源码找不到或需要确认构建产物差异时，再看产物作为补充。

如果当前目录不是 Lattice 项目，明确告知用户，建议用户自行执行 `ltc link`（非 Git 项目）或 `ltc scan`（Git 项目）。AI 不得代劳执行 `ltc link`（详见 [project-discovery.md#注册或恢复绑定ltc-link](project-discovery.md#注册或恢复绑定ltc-link)）。

## 跨项目相似需求搜索

> 何时读：用户提到“类似需求之前哪做过”“有没有可复用方案”“之前那个项目怎么做的”时 → 下一步：根据 search 结果决定是否进一步 `ltc spec show` / `read_file PRD`。
>
> 委派：此流程优先委派预定义 subagent `lattice-search` 执行，主线只等 top-K 结果与相关性判断。

```bash
ltc search "<查询词>" --json
```

> **AI 调用 search 时优先带 `--json`**，便于读取结构化结果（类型 / 分数 / 路径 / meta）后再推理与筛选。

如果结果与任务相关，再补：

```bash
ltc task list --current
ltc context --task <id>
```

## 嵌套项目继承

> 何时读：进入一个位于其它项目子目录下的项目时，或 `ltc status` 提示嵌套继承层级时 → 下一步：明晰 spec 来源后繼续作业。

当前项目位于另一个已注册 Lattice 项目的子目录时，`ltc context` 自动继承祖先项目的 spec。

- **自动检测**：`ltc link` 时自动向上检测并创建 `nested-in` 关系（`createdBy=auto`）
- **级联优先级**：`当前项目 > 直接父级 > 更远祖先 > 用户级 > 全局级`（就近优先覆盖）
- **只继承 spec，不继承任务**
- `ltc status` 显示嵌套继承层级信息

典型场景：monorepo 中子包（`packages/foo`）和根目录都注册为 Lattice 项目，子包自动继承根项目规范。

## 项目关系

> 何时读：工作涉及多个项目 / 共享组件 / 跨仓库依赖时，或 `ltc context` 输出“关联项目”段为空但有多个已注册项目时 → 下一步：发现未记录的依赖 / 协作 → 跳到 [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断) 记录关系。

工作涉及多个项目、共享组件或跨仓库依赖时：

```bash
ltc project list --search <keyword>   # 按关键词查找已注册项目
ltc project list --with-relations    # 列出全部项目并附带关系
ltc project relation list <id>
```

发现项目间存在未记录的依赖或协作关系时，**必须记录**，不要仅“建议添加”：

```bash
ltc project relation add <a> <b> --type <type> \
  --description "证据描述" --ai-inferred --from-task <task-id>
```

典型触发场景：

- 任务关联了多个项目（`task.json` 的 `projects` 有多个）
- 在 PRD / 项目数据里看到跨项目证据（共享 git first commit、package.json 依赖、monorepo 包名）
- `ltc context` 输出“关联项目”段为空但本地有多个已注册项目

关系类型判定指引详见 [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)。

## 跨用户聚合

> 何时读：同一项目被多个本机用户同时使用 / 需要看到其他用户的 spec / 跨用户任务聚合时 → 下一步：按需加 `--user` / `--current-user` 参数。

`ltc context` 默认聚合所有用户为同一项目定义的 spec 和关系。`ltc search` 默认搜索所有用户内容。需要精确控制时：

```bash
# 搜索：默认搜索所有用户
ltc search "关键词" --current-user             # 仅当前用户
ltc search "关键词" --users user1,user2         # 指定用户

# 关系：默认聚合所有用户
ltc project relation list <id> --user <users>    # 仅指定用户
ltc project relation list <id> --current-user    # 仅当前用户

# 任务：跨用户聚合需显式开启
ltc task list --current --all-user               # 聚合所有用户
ltc task list --current --user <users>           # 仅指定用户

# Spec：查看其他用户的 spec
ltc spec show <file> --user <username> --detail
```

> `--user` 中指定不存在的用户名会报错并列出可用用户。`--user` 与 `--current-user` / `--all-user` 互斥。

## 输出要求

> 何时读：任何状态下调用本文描述的各类命令后给用户输出时 → 下一步：以下原则决定输出体量与内容。

- 不要直接转储整份上下文，提炼与当前请求最相关的规则、历史方案和风险
- AI 调用 `ltc search` 优先带 `--json`
- 当前目录不是 Lattice 项目时明确告知用户，建议用户自行执行 `ltc link` 或 `ltc scan`（AI 不得代劳执行）
