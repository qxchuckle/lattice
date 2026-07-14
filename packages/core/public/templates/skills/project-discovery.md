# 项目查找、识别与关联

> **本文权威范围**：项目身份多 ID 模型 / 进入未知目录的 `project where` / `ltc link`（含 ID 匹配、嵌套自动检测、`--restore` / `--force-new`）/ lattice.json 指向失效的修复 / 任务的 `projects[]` 与 `scopePaths[]` / 项目关系（含 AI 推断）/ `ltc doctor` 数据完整性维护 / `project merge` 物理合并 / 手动扫描。
>
> 进入项目后的默认 `ltc context` 上下文铺底 / 跨项目相似需求搜索见 [project-context.md](project-context.md)；终端输出过滤规则见 [SKILL.md#终端输出读取原则](SKILL.md#终端输出读取原则)。
>
> **章节阅读约定**：每个一级 `##` 章节顶部以 `> 何时读 / 下一步` 一句话点题。

本文件聚焦"项目身份认知"：当 AI/Agent 操作多个仓库或多份 worktree 时，如何让 Lattice 把同一个项目识别成同一个、把任务正确关联到项目、并维护项目间的关系。

## 核心模型

> 何时读：第一次接触 Lattice 项目模型 / 不清楚项目 id 与多路径绑定语义时 → 下一步：再看具体命令章节。

- 每个项目有**多 ID**（`ids: string[]`），格式 `<prefix>:<content>`，任一 ID 匹配即视为同一项目。IDs 分两类：

  - **`legacy:` ID**（特殊）：来自 `lattice.json`，手动 `ltc link` 时生成。是唯一由用户行为产生的 ID，也是虚拟合并保护机制的判定依据。
  - **其他 ID 源**（自动采集）：从项目特征自动推导，当前包括：

| 前缀 | 生成方式 | 优先级 |
|---|---|---|
| `legacy:` | `lattice.json` 的 id | 1（最高） |
| `git:` | `git_first_commit` SHA 前 16 位 | 2 |
| `remote:` | `sha256(normalize(git_remote))` 前 16 位 | 3 |

  > 其他 ID 源未来可能增加（如 package name、monorepo 标识等），不影响现有逻辑——新增 ID 源只需扩展采集逻辑和优先级表。

- `selectPrimaryId(meta.ids)` 运行时按优先级动态计算主 ID，**不靠 ids 数组顺序**。
- 无任何 ID 源可采集（无 git 信息且无 lattice.json）的目录无法自动识别，需手动 `ltc link`。
- 一个项目可以同时绑定多个本地路径（worktree、不同机器同步、不同 clone）：`localPaths` 是数组。
- **虚拟合并**：IDs 有交集的项目在查询层（获取 spec、记录 spec、web 可视化）自动视为一组，零物理操作。各自保留独立 `project.json` / spec / task。有 `legacy:` ID 的项目虚拟合并只匹配 `legacy:` 交集（保护机制，防止自动采集的 ID 源误合并不同项目）。
- 项目关系（`forked-from` / `depends-on` / `shares-component` / `nested-in` / `related` / 自定义类型）以 `relations.json` 为真源，每条关系有唯一 id `rel_xxxxxxxx`。

## 进入未知目录时

> 何时读：进入一个不确定是否已注册到 Lattice 的目录、或 `ltc context` 报"未在 Lattice 中找到项目"时 → 下一步：根据输出三层判定走 `ltc link` 或 `--restore` / `--force-new`。

判断目录是否已注册：

```bash
ltc project where <path>          # 默认 .  支持精确匹配 + 父目录前缀 + ID 匹配
ltc project list --search <keyword> # 按关键词搜索已注册项目（名称/ID/路径/Git/包名/分组/标签）
```

输出包含三层：
1. **精确匹配**：`localPaths` 严格相等
2. **父目录前缀匹配**：`<path>` 是某个项目 `localPaths` 中某条的子目录
3. **ID 匹配**：采集路径的其他 ID 源（如 `git:` / `remote:`），与已注册项目的 `ids` 匹配

## 注册或恢复绑定（ltc link）

> 何时读：上一步 `project where` 已知目录未注册、或用户明确要求绑定 / 重新绑定 / 强制独立时 → 下一步：根据场景选择默认 `link` / `--restore` / `--force-new` / `--yes`。

`ltc link`（默认）通过绝对路径和 ID 匹配查找已注册项目，根据匹配结果走不同分支：

| 场景 | 行为 |
|---|---|
| 路径匹配到已有项目 + 有 `legacy:` ID | 幂等更新元数据，写 `lattice.json` |
| 路径匹配到已有项目 + 无 `legacy:` ID（通过其他 ID 源匹配） | **不修改原项目元数据**，新建项目（新 `legacy:` ID + 其他 ID 源），通过虚拟合并关联原项目的任务和 spec |
| 未找到 | 新建项目 + `lattice.json`（生成 `legacy:` ID，采集其他 ID 源如 `git:` / `remote:`） |

特殊场景：

```bash
ltc link --restore <id>      # 已知目标 id，直接重新绑定（不交互）
ltc link --force-new         # 跳过 ID 匹配，强制创建新项目
ltc link --yes               # 非交互模式：检测到候选时仅打印警告并创建新项目
```

> **嵌套项目自动检测**：link 完成后会自动向上查找父级 `lattice.json` 或 `.git`，若发现已注册的父项目，自动创建 `nested-in` 关系（`createdBy=auto`）。子项目运行 `ltc context` 时自动继承祖先项目的 spec。

判断使用哪个分支：
- 用户从备份/同步把项目放到新目录 → `--restore`（最快）
- 用户把同一仓库 clone 成两份做对比/playground，但希望分别独立 → `--force-new`
- 用户在迁移仓库或重新 clone 后绑定 → 默认 `ltc link`，让 ID 匹配决定
- 同一仓库多 clone 但希望共享任务/spec → 默认 `ltc link`，虚拟合并自动关联

## 当前 lattice.json 指向的 id 已不存在

> 何时读：`ltc context` / `ltc status` 报"项目 id 不存在"或类似异常时 → 下一步：从下面 3 个修复路径里挑一个。

`ltc context` / `ltc status` 检测到这种情况会主动报警。修复路径：

1. `ltc link --restore <id>`：如果你知道正确的项目 id（例如刚 unregister 又 link 回来）
2. `ltc link`：走 ID 匹配，若识别到原项目则恢复，否则创建新项目
3. `ltc link --force-new`：彻底切成新项目

## 任务的"项目集合"与"路径集合"

> 何时读：任务涉及未注册的额外仓库 / 共享组件 / 数据样本路径，或需要把任务关联 / 解绑到项目时 → 下一步：用 `ltc task associate` 调整 `projects[]` 或 `scopePaths[]`。本节也是 [task-workflows.md#项目关联同步](task-workflows.md#项目关联同步) 的权威实现。

任务关联两个层级：
- `projects[]`：已注册的项目 id 列表
- `scopePaths[]`：项目尚未覆盖、但任务确实涉及的额外路径（reference 仓、共享组件、数据样本等）

通用入口：

```bash
ltc task associate <task-id> --project <id>          # 直接关联已注册项目
ltc task associate <task-id> --current               # 关联当前目录对应的项目
ltc task associate <task-id> --paths /abs/p1 /abs/p2 # 多路径智能识别
ltc task associate <task-id> --paths /abs/p --note "shared component"
ltc task associate <task-id> --remove-path /abs/p
ltc task associate <task-id> --remove-project <id>
ltc task associate <task-id> --clear-paths
```

`--paths` 的智能行为：
- 命中已注册项目（high 置信度）→ 自动加进 `projects[]`
- 未命中或低置信度 → 加进 `scopePaths[]`，可选 `--note`

## 项目关系（含 AI 推断）

> 何时读：[project-context.md#项目关系](project-context.md#项目关系) 提示存在多项目 / 跨仓库依赖、或 AI 在 PRD / 项目数据里看到跨项目证据时 → 下一步：先列现有关系，确认无重复后再用 `--ai-inferred` 添加。

当工作涉及多个项目、共享组件或跨仓库依赖时，先查现有关系：

```bash
ltc project list --with-relations
ltc project relation list <id>
ltc project relation list           # 列出全部
```

CLI 仅提供"原子能力"，**关系类型与是否成立由 AI 自行判断**。常见判定指引（写给 AI 自己看）：

| 现象 | 建议关系类型 |
|------|-------------|
| 两项目共享 `git_first_commit` 或一个项目的 git remote 是另一个的 fork | `forked-from` |
| package.json 中 A 直接 `dependencies`/`peerDependencies` 引用 B 的 package | `depends-on` |
| 在多个项目里看到同一个 monorepo 包名 | `shares-component` |
| 子项目的目录位于父项目目录之内（目录层级嵌套） | `nested-in`（link 时自动创建） |
| 仅是同一个组织/团队的相邻仓库，无强证据 | `related`（不要随便升格） |
| 仅靠 basename 相同（如 `frontend` / `backend`）→ 不要建立关系 | — |

标记关系时**必须区分来源**，便于事后审计：

```bash
# 用户主动让你建立的关系
ltc project relation add <a> <b> --type forked-from --description "..."

# AI 自己根据项目数据/PRD 推断出的关系
ltc project relation add <a> <b> --type depends-on \
  --description "package.json 中 A 直接依赖 B 的 @org/foo 包" \
  --ai-inferred \
  --from-task <task-id>
```

`--ai-inferred` 会把 `createdBy` 标记为 `ai-inferred`；`--from-task` 记录推断来源任务。

删除关系按 id（id 见 `relation list`）：

```bash
ltc project relation remove <relation-id>
```

## 数据完整性维护

> 何时读：`ltc doctor` 报警 / 旧版数据迁移 / `project list --orphaned` 大量孤儿项目 / 需要物理合并重复项目时 → 下一步：按问题类型选 `--migrate` / `--rebuild-fingerprints` / `--recheck-scope-paths` / `project merge`。

迁移旧版数据 / 重建指纹 / 复核任务路径 / 物理合并：

```bash
ltc doctor --migrate                # 一次性升级旧 localPath/gitRemote 为数组并清理 legacy 字段
ltc doctor --rebuild-fingerprints   # 重新采集所有项目的指纹
ltc doctor --recheck-scope-paths    # 重新检查任务 scopePaths 是否升格为已注册项目
ltc project merge <from> <to>       # 物理合并两个项目（from → to，事务操作）
```

> **虚拟合并 vs 物理合并**：IDs 有交集的项目自动虚拟合并，通常无需 `merge`。仅在需要真正消除重复项目（如 `legacy:` ID 和其他 ID 源指向同一项目但虚拟合并不够时）使用 `project merge`。

发现以下问题时优先跑对应修复：
- `project list --orphaned` 列出大量项目 → 路径都失效，提示用户重新 scan / link
- `ltc context` 报"未在 Lattice 中找到项目" → 走 link 恢复路径
- 同一项目在不同机器上 path 不一致 → 在每台机器上 `ltc scan` 让 `localPaths` 自动累加
- 旧数据 `id` 字段未补 `legacy:` 前缀 → `normalizeProjectMeta()` 在读取时自动处理

## 手动扫描

> 何时读：需要批量发现和注册本地 git 项目时 → 下一步：`ltc init scan`。

```bash
ltc init scan            # 手动触发扫描
ltc init scan --dirs /path1,/path2  # 指定扫描目录
ltc init scan --auto     # 使用配置中的 scanDirs
```

- 扫描发现 `.git` 目录 → 采集其他 ID 源生成 IDs → 注册新项目或追加 `localPaths`
- 已注册项目通过虚拟合并自动关联，无需手动 merge

## 输出原则

> 何时读：本文涉及的命令执行后给用户输出时 → 下一步：以下原则决定输出形式。

- 在多项目场景下回答前，先用 `project where` / `project list --search` / `project list --with-relations` 把上下文摸清
- 推断关系时给出"证据来源"，不要凭名字相似就 add
- 凡是 AI 主动建立的关系都加 `--ai-inferred` 与 `--from-task`，让用户回头能审计
- 如果 ID 匹配无结果，优先建议用户 `--force-new`，不要随意复用别人的项目 id
