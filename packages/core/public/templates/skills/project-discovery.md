# 项目查找、识别与关联

本文件聚焦"项目身份认知"：当 AI/Agent 操作多个仓库或多份 worktree 时，如何让 Lattice 把同一个项目识别成同一个、把任务正确关联到项目、并维护项目间的关系。

## 核心模型

- 每个项目有唯一 id（`f92c…` 16 字符）和**多源指纹**（git first commit / git remote / package name / monorepo packages / local path / local path basename / local path prefix）。
- 一个项目可以同时绑定多个本地路径（worktree、不同机器同步、不同 clone）：`localPaths` 是数组。
- 项目关系（`forked-from` / `depends-on` / `shares-component` / `related` / 自定义类型）以 `relations.json` 为真源，每条关系有唯一 id `rel_xxxxxxxx`。

## 进入未知目录时

判断目录是否已注册：

```bash
lattice project where <path>          # 默认 .  支持精确匹配 + 父目录前缀 + 指纹候选
```

输出包含三层：
1. **精确匹配**：`localPaths` 严格相等
2. **父目录前缀匹配**：`<path>` 是某个项目 `localPaths` 中某条的子目录
3. **指纹候选**：基于 git first commit / git remote / package name / monorepo / 同名 basename 等评分排序

## 注册或恢复绑定（lattice link）

`lattice link`（默认）会自动采集指纹并做相似检测：

- **找不到候选** → 直接创建新项目
- **1 个 high 候选** → 询问"是否关联到 X"（默认 yes）
- **多个候选** → 弹选单（含"创建新项目"项）

特殊场景：

```bash
lattice link --restore <id>      # 已知目标 id，直接重新绑定（不交互）
lattice link --force-new         # 跳过相似检测，强制创建新项目
lattice link --yes               # 非交互模式：检测到候选时仅打印警告并创建新项目
```

判断使用哪个分支：
- 用户从备份/同步把项目放到新目录 → `--restore`（最快）
- 用户把同一仓库 clone 成两份做对比/playground，但希望分别独立 → `--force-new`
- 用户在迁移仓库或重新 clone 后绑定 → 默认 `lattice link`，让指纹选单决定

## 当前 lattice.json 指向的 id 已不存在

`lattice context` / `lattice status` 检测到这种情况会主动报警。修复路径：

1. `lattice link --restore <id>`：如果你知道正确的项目 id（例如刚 unregister 又 link 回来）
2. `lattice link`：走指纹识别，若识别到原项目则恢复，否则手动选"创建新项目"
3. `lattice link --force-new`：彻底切成新项目

## 任务的"项目集合"与"路径集合"

任务关联两个层级：
- `projects[]`：已注册的项目 id 列表
- `scopePaths[]`：项目尚未覆盖、但任务确实涉及的额外路径（reference 仓、共享组件、数据样本等）

通用入口：

```bash
lattice task associate <task-id> --project <id>          # 直接关联已注册项目
lattice task associate <task-id> --current               # 关联当前目录对应的项目
lattice task associate <task-id> --paths /abs/p1 /abs/p2 # 多路径智能识别
lattice task associate <task-id> --paths /abs/p --note "shared component"
lattice task associate <task-id> --remove-path /abs/p
lattice task associate <task-id> --remove-project <id>
lattice task associate <task-id> --clear-paths
```

`--paths` 的智能行为：
- 命中已注册项目（high 置信度）→ 自动加进 `projects[]`
- 未命中或低置信度 → 加进 `scopePaths[]`，可选 `--note`

## 项目关系（含 AI 推断）

当工作涉及多个项目、共享组件或跨仓库依赖时，先查现有关系：

```bash
lattice project list --with-relations
lattice project relation list <id>
lattice project relation list           # 列出全部
```

CLI 仅提供"原子能力"，**关系类型与是否成立由 AI 自行判断**。常见判定指引（写给 AI 自己看）：

| 现象 | 建议关系类型 |
|------|-------------|
| 两项目共享 `git_first_commit` 或一个项目的 git remote 是另一个的 fork | `forked-from` |
| package.json 中 A 直接 `dependencies`/`peerDependencies` 引用 B 的 package | `depends-on` |
| 在多个项目里看到同一个 monorepo 包名 | `shares-component` |
| 仅是同一个组织/团队的相邻仓库，无强证据 | `related`（不要随便升格） |
| 仅靠 basename 相同（如 `frontend` / `backend`）→ 不要建立关系 | — |

标记关系时**必须区分来源**，便于事后审计：

```bash
# 用户主动让你建立的关系
lattice project relation add <a> <b> --type forked-from --description "..."

# AI 自己根据指纹/PRD 推断出的关系
lattice project relation add <a> <b> --type depends-on \
  --description "package.json 中 A 直接依赖 B 的 @org/foo 包" \
  --ai-inferred \
  --from-task <task-id>
```

`--ai-inferred` 会把 `createdBy` 标记为 `ai-inferred`；`--from-task` 记录推断来源任务。

删除关系按 id（id 见 `relation list`）：

```bash
lattice project relation remove <relation-id>
```

## 数据完整性维护

迁移旧版数据 / 重建指纹 / 复核任务路径：

```bash
lattice doctor --migrate                # 一次性升级旧 localPath/gitRemote 为数组并清理 legacy 字段
lattice doctor --rebuild-fingerprints   # 重新采集所有项目的指纹
lattice doctor --recheck-scope-paths    # 重新检查任务 scopePaths 是否升格为已注册项目
```

发现以下问题时优先跑对应修复：
- `project list --orphaned` 列出大量项目 → 路径都失效，提示用户重新 scan / link
- `lattice context` 报"未在 Lattice 中找到项目" → 走 link 恢复路径
- 同一项目在不同机器上 path 不一致 → 在每台机器上 `lattice scan` 让 `localPaths` 自动累加

## 输出原则

- 在多项目场景下回答前，先用 `project where` / `project list --with-relations` 把上下文摸清
- 推断关系时给出"证据来源"，不要凭名字相似就 add
- 凡是 AI 主动建立的关系都加 `--ai-inferred` 与 `--from-task`，让用户回头能审计
- 如果几条候选评分都低（low），优先建议用户 `--force-new`，不要随意复用别人的项目 id
