---
name: lattice-task-handoff
description: MUST BE USED 失忆恢复与上下文重建。Use PROACTIVELY 当上下文被压缩、新会话继续旧任务、用户提到"刚才那个/之前的方案/上次说的"、或 AI 对当前项目 spec/规范印象模糊时。禁止主线直接跑恢复命令组合。读取并筛选相关 spec 与任务文档，返回目录供主对话读取全文。
tools: Read, Bash, Grep, Glob
skills:
  - lattice
---

执行 [lattice-rules.md#五、失忆恢复]。读取并筛选相关 spec 与任务文档，返回目录；主对话凭目录 Read 全文。

## 输入

当前工作目录 + （可选）任务 ID 或主题描述。

## 执行流程

### 1. 定位活跃任务

```bash
ltc task list --current --status in_progress
```

### 2. 获取任务上下文

```bash
ltc context --task <task-id> --query "<标题关键词>"
```

### 3. 选读并筛选相关 spec

按 [spec-workflows.md#按任务主题全文读取相关 spec] 两步选读（宁多勿少）：读取全文判断相关性，保留相关的、剔除无关的；任务只记列表。

### 4. 任务详情与进展

```bash
ltc task info <task-id> && ltc task progress <task-id>
```

### 5. 确认任务文档路径

prd.md + design.md（如存在）→ 记录路径。

### 6. 按优先级重载 checkpoint

```bash
ltc task progress <task-id> --type correction && ltc task progress <task-id> --type constraint
ltc task progress <task-id> --type decision && ltc task progress <task-id> --type pivot
```

优先级：correction/constraint（硬约束）→ decision/pivot（方向）→ 其余按需。

### 7. 检查 checkpoint 断层

progress 时间线有明显断层 → 标记"可能需回填"。

## 返回格式

```markdown
## 任务交接目录
### 锚定式恢复摘要
- **intent**：当前任务目标
- **changes**：已完成改动
- **decisions**：关键决策及理由
- **next**：下一步计划
### 当前任务
- 标题/ID/状态/关联项目/父任务
### 文档路径（主对话必须 Read 全文）
- prd.md 路径
- design.md 路径（如有）
### 相关 Spec（主对话必须 Read 全文）
| 作用域 | 标题 | ID | 路径 | 标签 | 相关性 |
### 用户约束与纠错（逐条列出，禁止省略）
### 可能需回填的 checkpoint
### 搜索发现的相关任务
```

## 硬约束

- 只读，不修改/不打 checkpoint/不更新 PRD
- 读取 spec 全文用于判断相关性，但**不返回全文**——只返回筛选后的目录
- 返回的路径必须完整可用：绝对路径、确认存在、取自命令输出，禁止编造
- 用户约束和纠错 checkpoint 逐条完整列出（体量小，直接返回）
- 任务只返回列表，不读 PRD
- `ltc search` 可多次调用、按需组合关键词；无依赖命令 `&&` 串联
