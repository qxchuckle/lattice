# /lattice/context

**[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**[依赖文档]**：
- project-context.md：进入项目默认动作 / 嵌套继承 / 跨用户聚合
- spec-workflows.md：按任务主题全文读取相关 spec
- project-discovery.md（按需）：当前目录未注册时如何走 `ltc link`
- subagent-delegation.md：委派判定 / dispatch prompt 契约（铺底委派 `lattice-context`，搜索委派 `lattice-search`）

**目标**：快速获取当前项目或当前任务的高信号上下文，作为后续实现和分析的起点。

## 执行步骤

1. 当前目录属于已注册项目时：

   ```bash
   ltc context
   ltc status
   ```

2. 用户在命令后提供了任务 ID 时额外运行：

   ```bash
   ltc context --task <task-id>
   ```

3. **按当前请求 / 任务主题全文读取相关 spec**（必做）：→ spec-workflows.md「按任务主题全文读取相关 spec」。`ltc context` 输出只是 spec 标题列表，**摘要常缺失，看标题不等于了解内容**。

## 输出要求

- 不要直接转储整份上下文，提炼与当前请求最相关的规则与风险
- 总结时优先说明：当前项目最关键的 spec 规则（read_file 全文读取后的提炼，不是标题罗列）/ 当前活跃任务及状态 / 是否存在多层级 spec 冲突 / 是否有可参考的关联项目
- 当前目录不是 Lattice 项目时，明确告知用户并建议用户自行执行 `ltc link`（非 Git 项目）或 `ltc scan`（Git 项目），AI 不得代劳执行
