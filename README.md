# Lattice

**Lattice** 是一个跨项目的 AI 上下文管理工具。它把分散在多个仓库中的规范、任务、项目关系和可复用经验统一管理在 `~/.lattice/` 中，并通过 CLI 提供给开发者和 AI 编码工具，帮助你在不同项目之间复用规则、延续上下文，并更快找到可参考的历史方案。

它适合这些场景：

- 进入一个陌生仓库时，先拿到当前项目的规范和上下文
- 多个项目并行推进时，持续维护任务状态和关联关系
- 遇到相似需求时，搜索之前做过的方案、规则和决策
- 希望让 AI / Agent 在编码前先对齐项目约定，而不是每次从零开始

## 文档入口

- 想了解 spec 模板仓库应该如何组织、如何被拉取和导入：[`docs/spec-template-registry.md`](docs/spec-template-registry.md)
- 想查看仓库内置的公共模板、命令文档和平台规则：[`packages/core/public/templates/`](packages/core/public/templates/)
- 想快速查阅 CLI 命令参数：[`packages/core/public/templates/skills/command-reference.md`](packages/core/public/templates/skills/command-reference.md)
- 想了解给 AI / Agent 使用的技能入口与工作流：[`packages/core/public/templates/skills/SKILL.md`](packages/core/public/templates/skills/SKILL.md)