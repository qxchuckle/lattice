# Subagent 委派

本文件用于：当所在 agent 平台支持 subagent（如 Claude Code 的 Task、Cursor 的 background agent、Qoder 的 Search Agent 等并行子代理）时，把 lattice 中**重 IO、大输出、只取结论**的流程交给 subagent 并行执行，避免原始命令输出塞满主上下文。

## 判定是否启用 subagent

仅在同时满足以下条件时启用：

1. 当前 agent 平台支持 subagent / Task / background worker
2. 即将执行的 lattice 命令属于「读类」（不会改写 db / 文件 / 任务状态）
3. 命令组合预计**输出体量大**或**需要并行多个调用**
4. 主线只需要**结论 / top-K 路径 / 一句话概览**，不需要原始全文

任一条件不满足 → 主线直接串行执行。

## 适合委派给 subagent 的 lattice 流程

### 1. 进入新项目时的"上下文铺底"

**主线动作**：派一个 subagent 并行跑这些读命令，自己只等结论。

```bash
lattice context             # 项目级 / 用户级 / 全局级 spec 全量
lattice status              # 全局活跃任务与索引状态
lattice task list --current # 当前未完成任务
lattice spec list           # 分层 spec 清单
```

**subagent 回报格式**（≤ 20 行）：当前项目名 + 关键 spec 摘要 + 活跃任务 id 与标题 + 是否存在 spec 冲突。

### 2. 跨项目相似经验调研

用户问"之前在哪做过类似需求 / 有没有可复用方案"时，多关键字 × 多 type 适合**多个 subagent 并行**：

```bash
lattice search "<关键词A>" --json
lattice search "<关键词B>" --json
lattice search "<关键词A>" --type checkpoint --json
lattice search "<关键词A>" --type relation --json
```

**subagent 回报格式**：top-K（≤ 5）的 `{path, score, type, title}` + 一句话相关性判断；主线仅基于此决定是否再 `lattice spec show` / 读 PRD。

### 3. 多任务并行梳理

需要同时了解多个任务的进度（如归档前批量审视、跨任务 PRD 汇总）：

```bash
# 对 N 个 task id 并行
lattice context --task <id1>
lattice task progress <id2> --last 10
lattice spec show <task-prd>
```

**subagent 回报格式**：按任务 id 分组的 `{title, status, last_checkpoint, blockers}` 表。

### 4. 跨多项目元信息汇总

涉及多仓库 / 共享组件时：

```bash
lattice project list --with-relations
# 对每个候选项目并行
lattice project info <id>
lattice project relation list <id>
```

**subagent 回报格式**：`{projectId, name, mainPath, relations: [...]}` 列表。

### 5. 健康巡检 / 一次性体检

多个独立诊断命令彼此无依赖，适合并行：

```bash
lattice doctor
lattice rag status
lattice spec conflicts
lattice project list --orphaned
```

**subagent 回报格式**：每项「健康 / 警告 / 错误」+ 具体待修复项数量；主线仅在有红项时再深入。

### 6. link 候选指纹调研

`lattice link` 给出多个候选项目时，对每个候选并行查详情：

```bash
lattice project info <候选1>
lattice project info <候选2>
lattice project where <path>
```

**subagent 回报格式**：候选对比表（id / name / lastUpdated / 路径匹配度）。

## 禁止委派给 subagent 的流程

以下流程必须由主线串行执行，subagent 无法保证写顺序、用户交互与上下文一致性：

- 任何**写操作**：`lattice task create/update/checkpoint/complete/archive/delete`、`lattice link/unlink`、`lattice spec` 写入、`lattice project relation add/remove`、`lattice rag rebuild/update`
- 需要**用户交互确认**的命令（即使加 `--force` 也保留可见性）
- 单条快速查询（如 `lattice project where <path>` 单次）—— 并行无收益
- 与当前正在编辑的文件**强耦合的小范围查询** —— 拆给 subagent 易丢主线上下文

## 主线与 subagent 的契约

1. **命令必须带 `--json`**（支持的命令），subagent 解析后再总结，避免双层字符串处理
2. **subagent 只返回结论，不返回原始输出**；如果主线需要原文，再单独读特定文件
3. **subagent 报告体量上限**：单次 ≤ 30 行 markdown 或等价 JSON，超出说明需要拆分任务
4. **不递归委派**：subagent 不再派子 subagent，避免上下文风暴
5. **失败回退**：subagent 报"信息不足 / 命令失败"时，主线应自己跑一次全量再判断，不要直接下"不存在"结论

## 不支持 subagent 时

按上面同样的命令清单**串行**执行，但要主动收缩输出（参考 [SKILL.md#终端输出读取原则](SKILL.md#终端输出读取原则)）：

- 单次调用就带 `--json` 字段过滤
- 多关键字 search 改为合并查询或分两次执行
- 健康巡检可只跑 `lattice doctor`（自身已聚合多项指标），其余按需补充
