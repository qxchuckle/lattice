# Spec 工作流

本文件用于处理 spec 的读取、冲突判断、模板应用和规则沉淀。

## 层级优先级

spec 读取顺序：

1. `~/.lattice/users/<username>/projects/<id>/spec/`
2. `~/.lattice/users/<username>/spec/`
3. `~/.lattice/spec/`

同名文件冲突时：

- 项目级优先
- 用户级覆盖全局级
- 需要明确告诉用户覆盖关系，而不是静默忽略

## 先读再改

涉及规范、约定、历史方案时，优先运行：

```bash
lattice context
lattice spec list
lattice spec conflicts
```

## 何时写入 spec

适合沉淀：

- 多次重复出现的约定
- 架构边界、目录规范、协作流程
- 已验证有效的排错或交付流程

不适合沉淀：

- 一次性临时需求
- 只对当前任务有效的 workaround
- 仍未确认的猜测

## 如何选择写入层级

- 只对当前项目长期有效：项目级
- 跨多个项目可复用，但仍属于当前用户/团队习惯：用户级
- 对多用户、多项目都成立的默认规则：全局级

## 模板相关命令

```bash
lattice spec template list
lattice spec template apply <name>
lattice spec template pull <repo>
lattice spec template sync
lattice spec template registry list
```

## 输出要求

- 说明你读取或更新了哪个 spec 文件
- 提炼核心规则，不要只罗列文件名
- 如果发现更合适的层级，明确给出建议
