# 故障排查

> 委派：必须委派 `lattice-health` subagent（不支持时退化串行）。只诊断不修复。

## 快速诊断

```bash
ltc doctor              # 全面检查（只读）
ltc doctor --fix        # 检查+自动修复安全项
ltc doctor --migrate    # legacy 字段迁移+DB 回填
```

## doctor 诊断项速查

| 检查项 | 修复 |
|---|---|
| 磁盘/数据库一致性 | `doctor --fix` |
| 重复项目检测 | `project remove <多余ID> -f` |
| lattice.json 引用一致性 | 确认保留哪个 ID 后修复 |
| 数据库字段同步 | `doctor --fix` |
| 任务关联项目有效性 | `doctor --fix` 或 `task update` |
| 任务父子链有效性 | `doctor --fix` |
| 项目关系有效性 | `doctor --fix` |
| 项目索引（路径失效） | `ltc scan` 或清理 |
| RAG/FTS 索引 | `ltc rag rebuild` |

## 典型场景

| 场景 | 诊断 | 修复 |
|---|---|---|
| 项目数缺失（DB 重建后） | `ltc doctor` 看磁盘/DB 一致性 | `doctor --fix` / `--migrate` |
| 同项目多条记录 | `ltc doctor` 看重复检测 | 确认保留 ID → `project remove <多余> -f` |
| lattice.json 与注册 ID 不匹配 | `cat lattice.json` + `project list --json` | 编辑 lattice.json 或 `unlink -f && link` |
| 搜索无结果/不全 | `ltc rag status` + `ltc doctor` | `ltc rag rebuild` |
| 数据库损坏 | 任何命令报 SQLite 错误 | 删 `~/.lattice/.cache/lattice.db*` → `doctor --fix` → `rag rebuild` |

## AI 排查决策树

1. `ltc doctor`（全量输出）
2. 看 stale/error 项：磁盘/DB → `--fix` · 重复/引用 → 报告用户 · RAG/FTS → `rag rebuild` · 项目索引 → 询问用户
3. 修复后再跑 `ltc doctor` 验证全绿
4. doctor 本身报错 → 走数据库损坏流程
