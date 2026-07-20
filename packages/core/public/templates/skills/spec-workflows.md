# Spec 工作流

> **本文权威范围**：spec 概念定义 / 层级与冲突 / 按任务主题精读 / 沉淀判定 / 写入流程。其他文档涉及"何时读 spec / 何时沉淀 / 沉淀到哪一层"时通过 `spec-workflows.md#xxx` 引用，不得复述判定表。
>
> **章节阅读约定**：每个一级 `##` 章节顶部以 `> 何时读 / 下一步` 一句话点题。

## spec 是什么

> 何时读：第一次接触 spec 概念、或不确定某条信息是否值得写成 spec 时 → 下一步：跳到「层级」选择写在哪一层。

spec 记录对理解项目、完成任务有益的可复用信息。

核心判定：**下次有人 / AI 进入这个项目，是否还需要这条信息？** 需要就写。

内容范围：

- 行为约束：编码规范、提交流程、架构边界、依赖方向、技术栈禁令
- 项目认知：系统架构、模块职责、目录结构、领域概念、设计动机
- 流程范式：完成某类任务的完整步骤
- 经验细节：API 映射、字段转换、配置开关、边界条件
- 试错积累：失败方案及否决理由、踩坑记录

spec 不是永远正确的。发现与实际代码矛盾时，做交叉验证，必要时询问用户以哪个为准，然后更新 spec 或修复代码。

## 层级

> 何时读：要写一条新 spec / 看到 spec 冲突告警 / 判断某规则属于"项目级 / 用户级 / 全局级"时 → 下一步：层级确定后跳到「沉淀判定」决定是不是要写、「写入流程」决定怎么写。

```
项目级 > [父项目级 > 祖先项目级 >] 用户级 > 全局级
```

| 层级 | 路径 | 适用 |
|---|---|---|
| 项目级 | `~/.lattice/users/<user>/projects/<id>/spec/` | 只对当前项目有效 |
| 用户级 | `~/.lattice/users/<user>/spec/` | 跨项目可复用 |
| 全局级 | `~/.lattice/spec/` | 多用户多项目通用 |

冲突处理：近覆盖远、项目级最优先；同名冲突必须告知用户。

user / global 必须包含 `## 适用范围`，声明适用于哪些项目 / 语言 / 框架。

冲突优先级硬约束见 [lattice-rules.md §七 Spec 优先级与冲突](lattice-rules.md#七spec-优先级与冲突)。

## 按任务主题精读相关 spec

> 何时读：任务起手（`ltc context` 之后、动手之前）、本轮涉及未读过的模块 / 概念、上下文压缩恢复后 → 下一步：精读完毕后回到 [task-workflows.md#task-start-后的起手动作](task-workflows.md#task-start-后的起手动作) 或 [task-workflows.md#spec-选读触发条件](task-workflows.md#spec-选读触发条件) 继续。
>
> 委派：当 spec 数量多或任务涉及不熟悉模块时，优先委派预定义 subagent `lattice-spec-digest` 执行精读并返回规则清单。

> **spec 精读是动态持续过程，不是一次性动作**：起手读一批后，任务推进中涉及新模块 / 新概念 / 新约束时，应持续评估是否有未读的 spec 相关并即时补读。已读 spec 集合随任务推进只增不减——宁多勿少适用于每一轮，不限于第一次。

场景说明：任务是编写一个页面，起手时页面不涉及表单，但存在一份「表单编写规范」 spec——起手选读时不应因“当前看来不相关”而跳过（宁多勿少）；即便起手未读，当任务推进中页面加上了搜索表单时，必须主动补读该 spec——“起手时不相关”不等于“永远不相关”，任务范围会扩展。

### 如何选

分两步，第一步快速筛选，第二步语义搜索补漏：

**第一步：从 context 列表选读**

- 根据 `ltc context` 输出的 spec 标题 + description 判断相关性
- 认知类 spec 默认应读；约束类按修改范围决定
- **宁多勿少**：不确定某条 spec 是否相关时，读而非跳过

**第二步：语义搜索补漏**

第一步只能按标题/描述筛选，会漏掉“标题不直观但内容相关”的 spec。用搜索补充：

```bash
ltc search "<任务关键词/涉及的模块/概念>" --json
```

- 从搜索结果中筛出高相关性的 spec 和历史任务 PRD
- 历史任务 PRD 提供的是“别人/之前怎么做的”参考，与 spec 的“应该怎么做”互补
- 搜索结果中发现新的相关 spec → `read_file` 精读

### 如何读

1. 必须 `read_file` 读正文——看到标题不等于了解内容。**禁止使用行范围参数、head/tail/grep 截取等任何部分读取方式，必须读取完整文件**（→ [SKILL.md#终端输出读取原则](SKILL.md#终端输出读取原则)）
2. 验证时效性——与当前代码矛盾时做交叉检查
3. 提炼对当前任务的具体约束和可复用经验

### 关联

实施时参照了某 spec → `ltc task ref-spec <task-id> <spec-name>`。

## 沉淀判定

> 何时读：发现可复用内容时（实施期 / 归档审阅时）、`correction` / `constraint` / `context` 类 checkpoint 出现时 → 下一步：判定为「必须写 / 建议写」时跳到「写入流程」；判定为「不写」时仅在对话中说明理由。

任何时候发现可沉淀的内容都应立即行动，不只是归档时。

### 总判定档位

| 档位 | 条件 |
|---|---|
| **必须写** | 用户显式指示行为规则 / 用户主动给出项目认知 |
| **建议写** | 满足核心判定（下次还需要这条信息吗？） |
| **不写** | 一次性需求 / 未验证猜测 / 纯任务级细节 |

### 基于 checkpoint 类型的沉淀规则

归档审阅时对用户输入类 checkpoint 做 spec 沉淀判定（→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）：

| checkpoint 类型 | 沉淀条件 | 目标层级 |
|---|---|---|
| `correction` | 纠正内容反映长期行为规范（含 AI 试错经验）→ 强制沉淀 | 项目级或用户级 |
| `constraint` | 同一 constraint 在 ≥2 个任务出现 → 强制沉淀；首次按"建议写" | 项目级 → 复现后升用户级 |
| `context` | 属于业务领域知识 / 架构背景 → 沉淀为认知类 spec | 项目级 |
| `assumption` | 被用户确认且具有通用性 → 上升为明确规则 | 视内容而定 |

AI 判断类、进程事件类不直接触发 spec 沉淀，但 `issue` + 解决方案 = 试错积累类 spec。

发现符合条件的内容时，主动询问用户是否沉淀。

## 写入流程

> 何时读：「沉淀判定」结果为「必须写 / 建议写」后 → 下一步：写完后 `ltc rag update`（→ [SKILL.md#索引维护](SKILL.md#索引维护)）。

1. **前置采集**：`ltc context` + `ltc spec list --scope <层级>` + 回顾任务进展和对话结论
2. **查已有 spec**：`ltc spec show <相关文件>`，优先补充而非重复创建
3. **冲突检测**：读取同层级及上下层级已有 spec，判断语义矛盾，发现冲突告知用户
4. **写入**：一个文件聚焦一个主题；写具体可执行的内容；包含完整操作步骤和经验细节；user / global 带 `## 适用范围`；**敏感信息（token/cookie/密钥等）不写入 spec/PRD 正文**，写入 `~/.lattice/.cache/sensitive/` 下的独立 txt/md 文件，正文只引用文件路径
5. **元数据刷新**：直接编辑 spec 正文后，运行 `ltc spec migrate` 刷新 frontmatter（自动补 `id`、刷新 `updated`）；仅改 frontmatter 字段时用 `ltc spec set <file> --title/--description/--add-tag`
6. **二次审阅**：对照 PRD + progress + 对话检查有无遗漏
7. **索引更新**：`ltc rag update`（→ [SKILL.md#索引维护](SKILL.md#索引维护)）

## 模板命令

> 何时读：需要查 spec 模板相关命令语法时 → 下一步：完整参数见 [command-reference.md](command-reference.md)。

```bash
ltc spec template list
ltc spec template apply <name>
ltc spec template pull <repo>
ltc spec template sync
ltc spec template registry list
```
