---
description: Lattice 跨项目上下文工作流
globs:
alwaysApply: true
---

# Lattice 集成

你可以通过 Lattice CLI 获取跨项目的上下文、规范和任务信息。  
Lattice 的核心目标不是替代当前仓库的规则，而是在进入会话时帮你更快拿到「这个项目应该怎么做」以及「相关项目以前是怎么做的」。

## 什么时候优先使用 Lattice

1. 刚进入一个陌生仓库，需要先理解项目规范和历史决策
2. 用户提到“规范”“约定”“之前哪个项目做过”“类似项目怎么处理”
3. 一个需求涉及多个仓库、多个任务，或者需要跨项目复用经验
4. 当前会话沉淀出了新的长期规则，需要写回 spec

## 推荐命令

- `lattice context`：获取当前项目的聚合上下文
- `lattice context --task <id>`：获取任务关联的上下文
- `lattice status`：查看当前项目状态、Spec 和活跃任务
- `lattice task list --current`：查看当前项目相关任务
- `lattice search <query>`：跨项目搜索经验、任务和 Spec
- `lattice spec conflicts`：检查多层级 spec 冲突

## 建议工作流

1. 开始编码前先运行 `lattice context`
2. 涉及当前任务时，再运行 `lattice task list` 或 `lattice context --task <id>`
3. 修改代码前先遵守项目 spec；项目没有写清楚时，再参考用户级和全局 spec
4. 发现可复用的新规则时，优先考虑是否应该沉淀为 spec，而不是只留在当前对话里
5. 如果不同层级存在同名 spec，以项目级为准，但要提醒用户存在冲突

## 不要这样做

- 不要跳过上下文直接凭经验修改陌生项目
- 不要把一次性的临时需求写成长期规范
- 不要把项目级特例直接提升成全局规则
