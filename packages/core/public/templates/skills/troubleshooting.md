# 故障排查

**必须委派 `lattice-health` subagent（不支持时退化串行）。只诊断不修复。**

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
| Git 忽略配置（.gitignore 缺段） | `doctor --fix` 自动补段或 `ltc init` |
| Git 跟踪文件（已入库的应忽略文件，如 .trash） | `git -C ~/.lattice rm -r --cached <目录>` 后 commit；彻底清历史需 filter-repo |
| 域同步健康（镜像缺失/rebase 残留） | `ltc sync` 拉取重建；顽固的 `sync domain unlink` 后重新 join |
| 孤儿域镜像（目录在配置无） | 确认废弃后 `rm -rf ~/.lattice/.sync-domains/<hash>`（镜像可再生） |
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
| 域 pull 冲突 | `ltc sync` 输出 pull-conflict + 冲突清单（已自动 abort 保镜像现状） | 手动解决 `~/.lattice/.sync-domains/<hash>` 内冲突后重新 sync；或 unlink 重 join |
| 域内容不生效/看不见 | `sync domain list` 看 use 档与镜像状态 | use=off 改档；镜像缺失重 sync；检索需 `rag update` 后生效 |
| 误推内容进域 | 检查域 routes 匹配范围 | `route remove` 收窄 + 本地删除 + `ltc sync`（退出传播自动撤回我的贡献） |

## AI 排查决策树

1. `ltc doctor`（全量输出）
2. 看 stale/error 项：磁盘/DB → `--fix` · 重复/引用 → 报告用户 · RAG/FTS → `rag rebuild` · 项目索引 → 询问用户
3. 修复后再跑 `ltc doctor` 验证全绿
4. doctor 本身报错 → 走数据库损坏流程
