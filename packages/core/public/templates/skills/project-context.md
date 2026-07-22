# 项目上下文与搜索

进入项目动作、跨项目搜索、嵌套继承、跨用户聚合。项目身份/关系见 [project-discovery.md](project-discovery.md)。

## 进入项目默认动作

> 必须委派 `lattice-context` subagent（不支持时退化串行）。

```bash
ltc context --query "<主题>" && ltc status
```

**必须带 `--query`**，输出含语义关联（相关 spec/任务/项目）。

需明确：spec 列表 · 活跃任务 · spec 冲突 · 是否嵌套。

> ⚠️ spec 列表 ≠ 内容，必须全文读取（→ [spec-workflows.md](spec-workflows.md#按任务主题全文读取相关-spec)）。宁多勿少 · 持续补读。
>
> ⚠️ 查源码 → `ltc project list --search <包名>`，未找到再看 node_modules。

无 ID 源（非 git 无 lattice.json）→ 告知用户 `ltc link`（AI 不得代劳）。Git 由守卫自动注册。

## 跨项目搜索

> 必须委派 `lattice-search` subagent（不支持时退化串行）。

```bash
ltc search "<查询词>" --json
```

结果相关再补：`ltc context --task <id>` / read PRD。

## 嵌套继承

当前项目位于另一已注册项目子目录 → `ltc context` 自动继承祖先 spec。

- `ltc link` 自动检测创建 `nested-in` 关系
- 级联：`当前 > 父 > 祖先 > 用户 > 全局`
- 只继承 spec，不继承任务

## 项目关系

```bash
ltc project list --search <kw> / --with-relations
ltc project relation list <id>
```

发现未记录关系 → 必须记录（→ [project-discovery.md](project-discovery.md#项目关系含-ai-推断)）。

## 跨用户聚合

`ltc context`/`search` 默认聚合所有用户。精确控制：

```bash
ltc search "..." --current-user / --users u1,u2
ltc task list --current --all-user / --user <users>
ltc spec show <file> --user <username>
```

`--user` 与 `--current-user`/`--all-user` 互斥。
