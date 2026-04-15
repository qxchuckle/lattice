## Lattice 集成

通过 `lattice` CLI 获取跨项目上下文、规范和任务信息。

### 推荐命令

- `lattice context`
- `lattice context --task <id>`
- `lattice status`
- `lattice task list --current`
- `lattice search <query>`

### 建议工作流

1. 开始会话先运行 `lattice context`，再开始分析或修改代码
2. 如果用户提到规范、历史方案、类似项目、跨项目需求，优先使用 `lattice search`
3. 如果正在处理任务，优先拿到任务上下文而不是只看当前仓库
4. 会话中出现新规则、新约定、新架构决策时，考虑沉淀为 spec

### Spec 优先级

项目级 spec > 用户级 spec > 全局 spec

同名 spec 冲突时，提醒用户项目级优先，并说明冲突点。
