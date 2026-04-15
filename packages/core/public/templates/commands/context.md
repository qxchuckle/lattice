# /lattice/context

目标：快速获取当前项目或当前任务的高信号上下文，作为后续实现和分析的起点。

## 执行步骤

1. 如果当前目录属于已注册项目，先运行：

```bash
lattice context
lattice status
```

2. 如果用户在命令后提供了任务 ID，再额外运行：

```bash
lattice context --task <task-id>
```

3. 总结输出时优先说明：

- 当前项目最重要的 spec 规则
- 当前活跃任务及其状态
- 是否存在多层级 spec 冲突
- 是否有值得参考的关联项目

## 输出要求

- 不要直接转储整份上下文
- 优先提炼与当前用户请求最相关的规则和风险
- 如果当前目录不是 Lattice 项目，明确告诉用户，并建议先运行 `lattice link`
