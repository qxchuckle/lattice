# 项目查找、识别与关联

项目身份认知：多 ID 模型、`project where`、`ltc link`、任务关联、项目关系（含 AI 推断）、数据完整性。进入项目后的上下文铺底见 [project-context.md](project-context.md)。

## 核心模型

- 每个项目有**多 ID**（`ids: string[]`），格式 `<prefix>:<content>`，任一匹配即同一项目

| 前缀 | 生成方式 | 优先级 |
|---|---|---|
| `legacy:` | `lattice.json` 的 id（唯一用户行为产生） | 1（最高） |
| `git:` | `git_first_commit` SHA 前 16 位 | 2 |
| `remote:` | `sha256(normalize(git_remote))` 前 16 位 | 3 |

- `selectPrimaryId` 按优先级动态计算，不靠数组顺序
- 无 ID 源的目录需手动 `ltc link`
- `localPaths` 是数组（多路径绑定：worktree、不同 clone）
- **虚拟合并**：IDs 有交集 → 查询层自动视为一组（零物理操作）。有 `legacy:` ID 的只匹配 `legacy:` 交集（保护机制）
- 项目关系以 `relations.json` 为真源，每条有唯一 `rel_xxxxxxxx` id

## 进入未知目录时

```bash
ltc project where <path>            # 精确+父目录前缀+ID 匹配
ltc project list --search <keyword> # 关键词搜索
```

## 注册或恢复绑定（ltc link）

> ⚠️ **AI 禁止自动调用**。发现未注册 → 告知用户自行 `ltc link` 或 `ltc scan`。

| 场景 | 行为 |
|---|---|
| 路径匹配+有 `legacy:` ID | 幂等更新，写 `lattice.json` |
| 路径匹配+无 `legacy:`（其他 ID 匹配） | 新建项目（新 `legacy:` ID），虚拟合并关联原项目 |
| 未找到 | 新建项目+`lattice.json` |

```bash
ltc link --restore <id>    # 已知 id 直接绑定
ltc link --force-new       # 跳过匹配强制新建
ltc link --yes             # 非交互（候选仅警告并新建）
```

嵌套自动检测：link 后向上查找父级 → 自动创建 `nested-in` 关系。

## lattice.json 指向 id 不存在

修复：`ltc link --restore <id>` / `ltc link`（走 ID 匹配）/ `ltc link --force-new`

## 任务的"项目集合"与"路径集合"

- `projects[]`：已注册项目 id
- `scopePaths[]`：任务涉及但未注册的额外路径

```bash
ltc task associate <id> --project <pid>
ltc task associate <id> --current
ltc task associate <id> --paths /p1 /p2 [--note "..."]
ltc task associate <id> --remove-path /p / --remove-project <pid> / --clear-paths
```

`--paths` 智能行为：命中已注册项目（high 置信度）→ 进 `projects[]`；否则进 `scopePaths[]`。

## 项目关系（含 AI 推断）

先查现有：`ltc project list --with-relations` / `ltc project relation list [id]`

| 现象 | 类型 |
|------|------|
| 共享 git first commit / fork | `forked-from` |
| A 的 dependencies 引用 B | `depends-on` |
| 共用同一 monorepo 包 | `shares-component` |
| 目录嵌套 | `nested-in`（link 自动） |
| 同组织无强证据 | `related` |
| 仅 basename 相同 | 不建立 |

```bash
# 用户指示
ltc project relation add <a> <b> --type <type> --description "..."
# AI 推断
ltc project relation add <a> <b> --type <type> --description "证据" --ai-inferred --from-task <task-id>
```

删除：`ltc project relation remove <relation-id>`

## 数据完整性维护

```bash
ltc doctor --migrate              # 旧字段升级+DB 回填
ltc doctor --rebuild-fingerprints # 重采指纹
ltc doctor --recheck-scope-paths  # scopePaths 升格检查
ltc project merge <from> <to>     # 物理合并（事务）
```

虚拟合并通常够用，`merge` 仅用于需真正消除重复。

## 手动扫描

```bash
ltc init scan [--dirs /p1,/p2] [--auto]
```

扫描发现 `.git` → 采集 ID → 注册或追加 `localPaths`。
