# Fast-start 工作流

fast-start 是 `task/start` 的轻量变体：获取上下文和精读 spec，但不创建任务/PRD/checkpoint。正常任务流见 [task-workflows.md](task-workflows.md)。

## 适用场景

**适用**：确定性轻量任务（改 bug、加小功能、调配置）· 不想被记录的任务 · 用户明确知道简单

**不适用**（用 `/lattice/task/start`）：需求不明确 · 多文件多模块 · 需方案设计和决策记录

## 启动流程

1. `ltc context`
2. 精读相关 spec（→ [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)）
3. 输出简短确认（2~3 行）
4. 直接开始工作

## 与正常模式的差异

| | fast-start | task/start |
|---|---|---|
| 上下文 + spec 精读 | ✓ | ✓ |
| 任务/PRD/checkpoint | ✗ | ✓ |
| 实施期 4 步循环 | ✗ | ✓ |
| 轻量日志 | ✓ | — |
| spec 沉淀 | ✓ | ✓ |
| 复杂度检测+转正常 | ✓ | — |

不走 [lattice-rules.md](lattice-rules.md) §三和§六。

## 工作中约束

- spec 精读仍必做（fast-start 只省任务记录，不省项目认知）
- 不创建任务/PRD/checkpoint
- spec 沉淀仍适用（→ [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)）
- 当前目录非已注册项目 → 提示用户

## 轻量日志

存储在 `~/.lattice/users/<u>/fast-tasks/` YAML 文件中。可选记录，不强制。

```bash
ltc fast-start log add "标题" -m "内容" [--files ...]
ltc fast-start log list [--last N] [--project <id>] [--current] [--json]
ltc fast-start log search <关键词> [--last N] [--project <id>] [--current]
ltc fast-start log show <id>
ltc fast-start log stats
ltc fast-start log clear [--force]
```

与 checkpoint 区别：不依赖任务 · 无类型分类 · 无 PRD 联动 · 粗粒度。

## 复杂度检测

出现以下信号 → 提示用户转正常模式：需求模糊多次澄清 · 多轮仍未完成 · 需复杂方案讨论 · 需跨项目协作

提示：`⚠ 复杂度较高（原因）。建议转入正常模式。可使用 /lattice/task/fast-start/to-normal。`

用户选择继续 → 不再重复同一信号。

## 转正常模式（to-normal）

前置：当前处于 fast-start + 对话已有实质工作。

1. 归纳标题+查重（→ [task-workflows.md#命令参数不是任务 ID 时标题归纳与查重](task-workflows.md#命令参数不是任务-id-时标题归纳与查重)）
2. `ltc task create "<标题>" --current` + `ltc task start <id>` + `ltc context --task <id>`
3. 回填 PRD（完整目标 + 已完成工作 + 剩余方案 + 文件索引 + 约束）
4. `ltc task associate <id> --current`
5. 此后按正常实施期循环执行

约束：转换单向 · 不遗漏已完成工作 · 有决策/纠错则补打 checkpoint。

## 归档

fast-start 下执行 `/lattice/task/archive`：

1. 归纳标题 → `ltc task create` + `ltc task start`
2. 回填 PRD（目标/最终方案/文件索引/完成总结）
3. `ltc task associate <id> --current`
4. 按正常归档流程（→ [task-workflows.md#归档流程](task-workflows.md#归档流程)）
