# /lattice/context

> **[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**目标**：快速获取当前项目或当前任务的高信号上下文，作为后续实现和分析的起点。

## 执行步骤

1. 当前目录属于已注册项目时：

   ```bash
   lattice context
   lattice status
   ```

2. 用户在命令后提供了任务 ID 时额外运行：

   ```bash
   lattice context --task <task-id>
   ```

3. **按当前请求 / 任务主题精读相关 spec**（必做）：详见 skill `spec-workflows.md` 的「按任务主题精读相关 spec」。`lattice context` 输出只是 spec 标题列表，**摘要常缺失，看标题不等于了解内容**。

## 输出要求

详见 skill `project-context.md` 的「输出要求」。重点：

- 不要直接转储整份上下文，提炼与当前请求最相关的规则与风险
- 总结时优先说明：当前项目最关键的 spec 规则（read_file 精读后的提炼，不是标题罗列）/ 当前活跃任务及状态 / 是否存在多层级 spec 冲突 / 是否有可参考的关联项目
- 当前目录不是 Lattice 项目时，明确告知并建议先 `lattice link`
