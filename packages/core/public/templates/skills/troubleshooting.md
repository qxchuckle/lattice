# 故障排查

> 何时读：Lattice CLI 行为异常（命令报错、数据不符预期、项目/任务消失、搜索无结果）时 → 按本文流程定位并修复。

## 快速诊断入口

```bash
ltc doctor              # 全面健康检查（只读，不修改）
ltc doctor --fix        # 检查 + 自动修复安全项
ltc doctor --migrate    # legacy 字段迁移 + DB 回填（等价于 --fix 的子集 + 字段升级）
```

## doctor 诊断项速查

| 检查项 | 含义 | 常见触发场景 | 修复方式 |
|---|---|---|---|
| 磁盘/数据库一致性 | 磁盘 project.json 存在但 DB 无记录；或 DB 有记录但磁盘已无 | DB schema 升级重建后丢失数据 | `doctor --fix`（自动回填/清理） |
| 重复项目检测 | 同一 localPath 被多个项目 ID 引用 | 重复 `ltc link`、手动创建 lattice.json | `ltc project remove <多余ID> -f` |
| lattice.json 引用一致性 | 项目 localPath 下的 lattice.json id 与注册 ID 不匹配 | 项目被重新注册但旧 lattice.json 未更新；或重复项目清理后未同步 | 确认保留哪个 ID：保留 lattice.json 中的 → `project remove <注册ID> -f`；保留注册的 → 修改 lattice.json |
| 数据库字段同步 | DB 记录字段（name/paths/git 等）与 project.json 真源不一致 | 直接编辑了 project.json 但未触发 sync | `doctor --fix`（从真源刷新 DB） |
| 任务关联项目有效性 | 任务的 projects 字段引用了已删除/不存在的项目 ID | 重复项目清理后任务未同步；项目被移除但任务未更新 | `doctor --fix`（自动移除失效关联）或 `task update <id> --project <新ID>` |
| 任务父子链有效性 | parentTaskId 指向已删除的任务 | 父任务被 delete/purge 后子任务未同步 | `doctor --fix`（清除悬空 parentTaskId） |
| 项目关系有效性 | relations.json 中引用了已不存在的项目 ID | 手动删除项目目录而非通过 CLI 注销 | `doctor --fix`（清理涉及已删除项目的关系） |
| 任务目录完整性 | 任务目录存在但 task.json 缺失 | 手动移动/损坏了任务文件 | 手动检查并清理无效目录 |
| 项目索引 | localPaths 指向的目录不存在 | 项目文件夹被移动/删除 | `ltc scan` 重新扫描，或 `project list --orphaned` 查看并清理 |
| RAG 索引 | 向量/FTS 索引状态异常 | 首次初始化未 rebuild、spec 大量变更后未更新 | `ltc rag rebuild` |
| FTS 索引版本 | 全文索引版本过旧（中文检索失效） | 系统升级但未重建索引 | `ltc rag rebuild` |

## 典型问题场景

### 场景 1：`project list` 项目数量异常（缺失项目）

**症状**：`ltc project list` 显示的项目数远少于预期。

**根因**：DB schema 版本升级（如 v1→v2 改为复合主键）时会删除旧数据库重建。重建后 DB 为空，只有新注册的项目才会出现。磁盘上的 `~/.lattice/users/<username>/projects/*/project.json` 仍完好。

**诊断**：
```bash
ltc doctor
# 看"磁盘/数据库一致性"是否报 stale
```

**修复**：
```bash
ltc doctor --fix
# 或
ltc doctor --migrate
```

### 场景 2：同一项目出现多条记录

**症状**：`project list` 中同一路径或同一名称出现两次，ID 不同。

**根因**：
- 在同一目录多次执行 `ltc link`（每次生成不同 ID）
- lattice.json 被覆盖后又重新 link

**诊断**：
```bash
ltc doctor
# 看"重复项目检测"是否报 stale
```

**修复**：
1. 确认哪个 ID 是正确的（查看 `lattice.json` 中的 id、`project.json` 中的元数据完整性）
2. 移除多余的：`ltc project remove <多余ID> -f`
3. 如有必要，修改 `lattice.json` 中的 id 指向保留的 ID

### 场景 3：lattice.json 与注册 ID 不匹配

**症状**：`ltc context` 或 `ltc link` 识别的项目与预期不同。

**根因**：lattice.json 中的 id 指向一个旧的或已删除的项目记录。

**诊断**：
```bash
ltc doctor
# 看"lattice.json 引用一致性"
cat <project-dir>/lattice.json  # 确认当前 id
ltc project list --json | grep <id>
```

**修复**：
- 编辑 `<project-dir>/lattice.json` 将 id 改为正确值
- 或 `ltc unlink -f && ltc link`（重新注册会生成新 ID）

### 场景 4：搜索无结果或结果明显不全

**症状**：`ltc search` 找不到已知存在的 spec/任务。

**诊断**：
```bash
ltc rag status     # 查看索引文档数
ltc doctor         # 看 RAG 索引和 FTS 版本
```

**修复**：
```bash
ltc rag rebuild    # 全量重建索引
```

### 场景 5：数据库损坏或无法打开

**症状**：任何命令报 `数据库未初始化` 或 SQLite 错误。

**修复**：
```bash
# 删除数据库文件让系统重建（数据不丢失，project.json 是真源）
rm ~/.lattice/.cache/lattice.db*
ltc doctor --fix   # 重建 DB 并从磁盘回填所有项目
ltc rag rebuild    # 重建搜索索引
```

## AI 排查决策树

遇到 Lattice 异常时按以下顺序操作：

1. **先跑 `ltc doctor`**（全量输出，不过滤）
2. **看报告中 stale / error 项**：
   - 有 `磁盘/数据库一致性` stale → `doctor --fix`
   - 有 `重复项目` / `lattice.json 引用` stale → 报告给用户，需确认保留哪个
   - 有 `数据库字段同步` stale → `doctor --fix`
   - 有 `RAG 索引` / `FTS 版本` stale → `ltc rag rebuild`
   - 有 `项目索引` stale → 询问用户是否清理或重新 scan
3. **修复后再跑一次 `ltc doctor` 验证全绿**
4. **如果 doctor 本身报错** → 数据库可能损坏，走场景 5 流程
