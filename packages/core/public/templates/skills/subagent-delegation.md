# Subagent 委派

当平台支持 subagent 时，把 lattice 中**重 IO、多路并行**的信息收集流程交给 subagent 执行。信息提供型 subagent 读取并筛选相关 spec 与任务，返回经过滤的目录（路径 + ID + 元信息 + 相关性说明）；**主线凭目录 Read 所需文档全文，并可自主调用 `ltc search` / `ltc context` 补全信息**。Read 无截断限制，主线拥有完整对话上下文，比 subagent 更能判断全文读取范围。

**硬约束：以下场景必须委派，禁止主线直接执行对应命令组合。** 平台不支持 subagent 时退化为串行执行（按同样命令清单顺序跑，主动收缩输出）。

| 场景 | 必须委派的 subagent | 禁止主线直接执行的命令 |
|------|---------------------|------------------------|
| 任务起手信息收集 | `lattice-task-start` | `ltc context --task` + `ltc search` + `ltc spec show` + Read 组合 |
| 任务归档 | `lattice-task-archive` | `ltc task progress` + PRD 补全 + checkpoint + archive 组合 |
| 项目上下文铺底 | `lattice-context` | `ltc context` + `ltc status` + `ltc spec list` 组合 |
| 跨项目搜索 | `lattice-search` | 多路 `ltc search --json` 并行 |
| 失忆恢复 | `lattice-task-handoff` | 恢复流程全部命令 |
| 规范全文读取 | `lattice-spec-digest` | `ltc context` + 批量 `ltc spec show` + Read |
| 变更影响分析 | `lattice-impact` | context + search + grep 组合 |
| 健康巡检 | `lattice-health` | `ltc doctor` + `rag status` + `spec conflicts` 组合 |

## 预定义 subagent（优先使用）

| name | 职责 | 触发场景 |
|---|---|---|
| `lattice-task-start` | 任务起手信息收集 | 开始新任务 |
| `lattice-task-archive` | 归档前置采集+执行归档 | 归档任务 |
| `lattice-context` | 项目上下文铺底 | 进入新项目/会话开始 |
| `lattice-search` | 跨项目搜索 | "之前做过类似的吗" |
| `lattice-health` | 健康巡检（只诊断不修复） | 排查异常 |
| `lattice-task-handoff` | 失忆恢复/上下文重建 | 上下文压缩后 |
| `lattice-spec-digest` | 规范摘要 | 涉及不熟悉模块/spec 多 |
| `lattice-impact` | 变更影响分析 | 较大变更/跨模块修改前 |

**调度规则**：场景匹配上表 → 必须委派预定义 subagent；不覆盖 → 按下方临时委派判定。`lattice-task-archive` 是唯一涉及写操作的预定义 subagent（只写 lattice 元数据）。

## 临时委派判定

同时满足才启用：1. 平台支持 subagent 2. 命令属读类 3. 输出体量大或需并行 4. 主线只需索引或结论。任一不满足 → 主线串行。

## 适合临时委派的 6 类场景

| # | 场景 | 命令示例 | 回报格式 |
|---|---|---|---|
| 1 | 进入新项目上下文铺底 | `ltc context` + `status` + `task list --current` + `spec list` | 项目名+spec 路径索引+活跃任务+冲突 |
| 2 | 跨项目相似经验调研 | 多关键字 `ltc search --json` 并行 | `{path,score,type,title}` 列表 + 相关性判断 |
| 3 | 多任务并行梳理 | 对 N 个 task 并行 `context --task` / `progress` | 按 id 分组 `{title,status,last_checkpoint,blockers}` |
| 4 | 跨多项目元信息汇总 | `project list --with-relations` + 并行 `project info` | `{projectId,name,mainPath,relations}` 列表 |
| 5 | 健康巡检 | `doctor` + `rag status` + `spec conflicts` + `project list --orphaned` | 每项#健康/警告/错误+ 待修复数 |
| 6 | link 候选 ID 调研 | 对候选并行 `project info` / `project where` | 候选对比表 |

## 禁止委派

- 任何**写操作**（例外：预定义 `lattice-task-archive`）
- `ltc link`（用户手动命令，AI 不得调用）
- 需用户交互确认的命令
- 单条快速查询（并行无收益）
- 与当前编辑强耦合的小范围查询

## 主线与 subagent 契约

1. 命令带 `--json`
2. 信息提供型（context / task-start / spec-digest / task-handoff / search / impact）：读取并筛选相关 spec 与任务，返回经过滤的目录（路径 + ID + 元信息 + 相关性说明），**不返回文档全文**；返回的路径必须完整可用（绝对路径、确认存在、取自命令输出）
3. **主线收到目录后必须 Read 相关文档全文**（spec / PRD / design.md）——这是硬义务，不是可选动作；跳过 Read = 在没有规范约束的情况下工作
4. 信息提供型 subagent 的 dispatch prompt **只提供输入参数**（任务 ID、主题、工作目录），执行步骤和返回格式由 subagent 定义文件控制——禁止在 prompt 中要求"返回全文 / 返回完整内容"或重复指定执行流程；违反 = 以 prompt 覆盖 subagent 定义中的"不返回全文"硬约束
5. 主线可自主调用 `ltc search` / `ltc context` 等方法补全信息——不被 subagent 目录限制；`ltc search` 单次用空格隔开多个相关关键词形成关键词组，多次用不同关键词组，直到信息充分
6. 分析型（health）：返回诊断结论与修复建议
7. 执行型（task-archive）：返回执行报告
8. 不递归委派
9. 失败回退：subagent 报信息不足 → 主线自己跑全量再判断

## 不支持 subagent 时

串行执行同样命令，主动收缩输出：带 `--json` · 合并查询 · 健康巡检只跑 `ltc doctor`。
