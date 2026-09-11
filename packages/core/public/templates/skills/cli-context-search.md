# CLI 参数：上下文与检索

`ltc status` / `ltc context` / `ltc search` 参数。通用约定（`--force`/`--json`）见 [command-reference.md#通用约定]。

## `ltc status`

显示 Lattice 状态：默认输出当前项目（绑定路径 + spec 列表 + 活跃任务 + 嵌套祖先）；`--global` 输出全局概览（项目/任务计数 + DB 大小 + Git 开关 + 扫描目录）。

- `--global`：全局状态
- `--json`
- `--json-format`：JSON 输出格式化（默认压缩）

## `ltc context`

输出当前项目的聚合上下文（spec 列表 + 活跃任务 + `--query` 语义关联）。起手契约必调。

- `--task <id>`：按任务获取上下文
- `--project <id>`：按项目获取
- `--query <text>`：语义查询（**AI 必须带**，传入当前主题/意图）
- `--current-user`：仅当前用户
- `--json`

嵌套项目自动继承祖先 spec。级联：`当前 > 父级 > 祖先 > 用户级 > 全局`。

规范段每条 spec 输出含 **id**（markdown `- id：spec-xxxxxxxx` 行 / `--json` 的 `id` 字段），可直接用于 `task ref-spec`。

## `ltc search <query>`

跨 spec / 任务 / 项目 / 检查点 / 关系做语义检索。查历史方案、类似任务、可复用认知的主入口。

- `--type <type>`：`spec`/`task`/`project`/`checkpoint`/`relation`
- `--project <id>`
- `--users <names>`：逗号分隔
- `--current-user`
- `--limit <n>`：默认 10
- `--no-rerank`
- `--json`：AI 优先带上

`spec` 类结果输出含 **id**（普通输出 `id：spec-xxxxxxxx` 行 / `--json` 的 `meta.specId`），可直接用于 `task ref-spec`（依赖索引已含 id：加列后需跑过一次 `rag rebuild` 回填存量）。
