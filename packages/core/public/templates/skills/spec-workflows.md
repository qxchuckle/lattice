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
lattice spec show <相关文件>
```

## 冲突检测原则

`lattice spec conflicts` 只检测同名文件冲突，但真正的冲突往往是语义层面的。写入新 spec 前必须：

1. 读取目标层级及其他层级的相关 spec 内容
2. 判断新规则是否与已有规则存在矛盾（而不仅仅是同名）
3. 如有冲突，明确告知用户：冲突点、影响范围、建议处理方式（保留特例 / 合并规则 / 删除冗余）

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

## 模板与新建 spec

新建 spec 前应先检查是否有可参考的模板：

```bash
lattice spec template list
```

如果有匹配的模板（如 frontend、backend、api、conventions 等），参考其文件组织和内容结构再写入。不必完全照搬，但应保持一致性。

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

## 索引更新

新建或修改 spec 文件后，应运行：

```bash
lattice rag update
```

确保新写入的规范能被 `lattice search` 检索到。如果 `rag update` 报错，降级使用 `lattice rag rebuild`。
