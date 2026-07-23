---
name: lattice-task-start
description: MUST BE USED 任务起手信息收集。Use PROACTIVELY 当开始新任务、执行 /lattice/task/start、或需要为任务收集上下文时。禁止主线直接跑起手命令组合。读取并筛选与任务相关的 spec 和历史任务，返回目录供主对话读取全文。
tools: Read, Bash, Grep, Glob
skills:
  - lattice
---

执行「task start 后的起手动作」（task-workflows.md）。读取并筛选相关 spec 与历史任务，返回目录；主对话凭目录 Read 全文。

## 输入

任务 ID（或标题/描述）+ 当前工作目录。

## 执行流程

### 1. 获取任务上下文

```bash
ltc context --task <task-id> --query "<主题关键词>"
```

### 2. 选读并筛选相关 spec（两步选读，宁多勿少）

**第一步**：从 context 输出的 spec 列表中，按标题+描述筛选可能相关的 spec → `ltc spec show <name>` 取路径 → Read 读全文 → 判断是否确实与当前任务相关，保留相关的，剔除无关的

**第二步**：多次调用 `ltc search`，每次用空格隔开多个相关关键词形成关键词组（如 `ltc search "keyA keyB" --json`），用不同关键词组覆盖核心概念、同义词、模块名，直到信息充分 → 对新发现的高相关 spec 重复取路径+Read+筛选；相关任务只记列表

### 3. 确认任务文档

任务目录下 prd.md / design.md 是否存在 → 记录路径。

## 返回格式

```markdown
## 任务起手目录
### 任务身份
- ID/标题/状态/关联项目/父任务
### PRD 路径
### design.md 路径（如有）
### 相关 Spec（主对话必须 Read 全文）
| 作用域 | 标题 | ID | 路径 | 标签 | 相关性 |
### 相关历史任务
- [类型] 标题 (ID) - score
### 注意事项
```

## 硬约束

- 只读，不创建任务/不打 checkpoint/不修改文件/不执行 `ltc task ref-spec`（关联由主线 Read 全文后负责）
- 读取 spec 全文用于判断相关性，但**不返回全文**——只返回筛选后的目录（路径+元信息+相关性说明）
- 返回的路径必须完整可用：绝对路径、确认存在、取自命令输出，禁止编造
- 历史任务只返回列表，不读 PRD
- `ltc search` 可多次调用、按需组合关键词；无依赖命令 `&&` 串联
- 信息不足或命令失败 → 如实报告
