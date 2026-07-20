# 项目上下文与搜索

进入项目默认动作、跨项目搜索、嵌套继承、跨用户聚合。项目身份/关系推断见 [project-discovery.md](project-discovery.md)。

## 进入项目默认动作

> 委派：必须委派 `lattice-context` subagent（不支持时退化串行）。

```bash
ltc context --query "<当前主题/意图>"
ltc status
```

**AI 必须带 `--query`**，输出自动携带语义关联（相关 spec/任务/项目，已去重）。

需明确：spec 列表 · 活跃任务 · spec 冲突 · 是否嵌套项目。

> ⚠️ spec 列表 ≠ 内容，必须精读（→ [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)）。宁多勿少 · 持续补读。
>
> ⚠️ 查源码优先 `ltc project list --search <包名>` 定位本地仓库，未找到再看 node_modules/dist。

当前目录非 Lattice 项目 → 告知用户自行 `ltc link`/`ltc scan`（AI 不得代劳）。

## 跨项目相似需求搜索

> 委派：必须委派 `lattice-search` subagent（不支持时退化串行）。

```bash
ltc search "<查询词>" --json
```

结果相关再补：`ltc context --task <id>` / read PRD。

## 嵌套项目继承

当前项目位于另一已注册项目子目录时，`ltc context` 自动继承祖先 spec。

- `ltc link` 时自动检测并创建 `nested-in` 关系
- 级联：`当前 > 父级 > 祖先 > 用户级 > 全局`
- 只继承 spec，不继承任务

## 项目关系

涉及多项目/共享组件/跨仓库时：

```bash
ltc project list --search <keyword>
ltc project list --with-relations
ltc project relation list <id>
```

发现未记录的关系 → **必须记录**（→ [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）。

## 跨用户聚合

`ltc context`/`ltc search` 默认聚合所有用户。精确控制：

```bash
ltc search "..." --current-user / --users u1,u2
ltc project relation list <id> --current-user / --user <users>
ltc task list --current --all-user / --user <users>
ltc spec show <file> --user <username> --detail
```

`--user` 与 `--current-user`/`--all-user` 互斥。
