# Lattice 工作流（系统级常驻规则）

Lattice 是跨项目的 AI 上下文管理工具。本文件定义 AI 使用 Lattice 时的硬性约束。

> **本文定位**：本文是系统级硬约束**清单**（自含可读）——每条规则读完即可决定「该不该做 / 何时做 / 不做会怎么样」；需要拿到具体执行流程 / 判定细节 / 输出格式时，跟随每条规则末尾的 `（→ xxx.md#yy）` anchor 跳到 skill 子文档展开。
>
> 本文**不复述**子文档里的流程、判定表、输出格式。

## 一、起手契约（每个新会话第一件事）

1. `ltc context` —— 拿当前项目聚合上下文（→ [project-context.md#进入项目默认动作](project-context.md#进入项目默认动作)）
2. 按当前主题精读相关 spec（`ltc context` 输出只是标题列表，看到标题不等于了解内容；→ [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)）
3. 有活跃任务 → `ltc task info <id>` + `ltc task progress <id>` + read_file design.md（如存在；→ [task-workflows.md#task-start-后的起手动作](task-workflows.md#task-start-后的起手动作)）
4. 用户提到"规范/之前/类似/历史/跨项目" → 先 `ltc search <query> --json`（→ [project-context.md#跨项目相似需求搜索](project-context.md#跨项目相似需求搜索)）
5. 需求横跨多仓库 → `ltc project list --with-relations` 查看现有关系；发现未记录的依赖 / 协作关系 → 用 `ltc project relation add --ai-inferred --from-task <task-id>` 记录（→ [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）

## 二、Design 模式约束

`/lattice/task/design` 后严格禁止修改业务代码文件。

- 允许：read_file / grep_code / search / lsp / ltc 命令 / 写入 design.md
- 禁止：search_replace / create_file / delete_file / 有副作用的 run_in_terminal

退出条件：用户明确说"开始实施"或发出代码修改指令。

记录义务：讨论追加 design.md；关键决策打 decision checkpoint；结论回写 prd.md。

未显式进入 design 但出现方案讨论时，主动追加到 design.md。

（→ [task-workflows.md#任务模式design-vs-implementation](task-workflows.md#任务模式design-vs-implementation)）

## 三、实施期循环

`ltc task start` 后，每轮执行固定循环：PRD 同步 → spec 精读 → 改代码 → 打 checkpoint。

完整 4 步详见 [task-workflows.md#实施期多轮对话循环每轮用户输入到来时](task-workflows.md#实施期多轮对话循环每轮用户输入到来时)。

**强制规则**：

1. PRD 硬触发清单命中 → 先改 PRD 再改代码（→ [task-workflows.md#prd-同步硬触发清单t1t8](task-workflows.md#prd-同步硬触发清单t1t8)）
2. 写代码前 / 打 checkpoint 前 / complete 前 / 用户推翻方案后，各有必做动作（→ [task-workflows.md#写代码前的动作锚点](task-workflows.md#写代码前的动作锚点) / [task-workflows.md#打-checkpoint-前的-prd-自检](task-workflows.md#打-checkpoint-前的-prd-自检)）
3. 新主题先精读相关 spec（→ [task-workflows.md#spec-选读触发条件](task-workflows.md#spec-选读触发条件)）
4. 代码改完必须打 checkpoint（→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）
5. 用户推翻方案 = pivot checkpoint（→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）
6. 发现可复用内容 → 立即询问用户是否沉淀为 spec（→ [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)）
7. 及时打 checkpoint，不得延后（→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）
8. 单输入含多语义 → 拆为多条不同类型 checkpoint（→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）
9. 信息齐备再动手：对话中任何时候发现信息不足，主动调用 ltc 获取（spec / 搜索 / 任务 / 项目 / 历史），不要凭猜测行事（→ [SKILL.md#自主信息获取](SKILL.md#自主信息获取)）

颗粒度兜底：连续 3 轮未产生 checkpoint → 补 `note`。

### 为什么这 4 步不能跳（后果锚点）

跳过其中任一步会触发以下可机械识别的后果，本轮未做到哪项、下一轮就会被哪项后果护栏拦住：

| 跳的是 | 后果 |
|---|---|
| PRD 同步 | PRD 落后于代码 → 下一轮上下文压缩后读 PRD 出现认知偏差 → 改错代码 |
| spec 精读 | 本轮决策缺项目级 / 用户级规则 → 产出与项目约定冲突 → 返工 |
| 打 checkpoint | progress.yaml 丢实施轨迹 → 连续 3 轮未打点触发 note 兜底 → 仍然丢关键决策 |
| 项目关联同步 | task.json 的 projects/scopePaths 与实际修改范围不一致 → 后续 `task list --current` / `ltc context` 误判 |

## 四、项目关联同步

任务start 后，及后续进行中，自主按实际情况，实时维护 `task.json` 的 `projects` / `scopePaths` / `referencedSpecs`（→ [task-workflows.md#项目关联同步](task-workflows.md#项目关联同步)）。不限于 start 时或归档前——发现任务涉及新项目 / 新路径 / 参照了新 spec 时，当轮用 `ltc task associate` / `ltc task ref-spec` 同步。

**task.json 的结构化字段是机器可读元数据的唯一来源，PRD 中的自然语言描述不能替代 CLI 记录。** 在 PRD 中写入了项目路径 / 包名 / spec 引用时，必须同时用 CLI 记录到 task.json（命中 PRD 同步硬触发 T8；→ [task-workflows.md#prd-同步硬触发清单t1t8](task-workflows.md#prd-同步硬触发清单t1t8)）。

同样自主维护项目间关系（`relations.json`）：任务中发现未记录的 fork / 依赖 / 共享组件等关系 → 用 `ltc project relation add --ai-inferred --from-task <task-id>` 记录（→ [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）。

## 五、上下文压缩失忆恢复

检测到以下任一信号时立即执行恢复：

- 上下文出现 "summary" / "conversation summarized" / "continued from previous"
- 不记得当前会话开头做了什么
- 用户提到"刚才那个/之前的方案/上次说的"但印象模糊
- 对当前项目 spec / 规范 / 工作流约束印象模糊

恢复动作（按顺序）：

1. 重新调用 `lattice` skill（→ [SKILL.md#文档加载策略](SKILL.md#文档加载策略)）
2. `ltc context` + 精读相关 spec + read_file PRD / design.md（→ [project-context.md#进入项目默认动作](project-context.md#进入项目默认动作)）
3. `ltc task list --current` → `task info` → `task progress`（→ [task-workflows.md#task-start-后的起手动作](task-workflows.md#task-start-后的起手动作)）
4. 重载用户输入类 checkpoint（`--type correction/constraint/context`；→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）
5. 回填缺失 checkpoint（→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）

## 六、任务完成闭环

`ltc task complete` 前必须完成：

1. 前置信息采集（→ [task-workflows.md#任务归档前置信息采集](task-workflows.md#任务归档前置信息采集)）
2. PRD 补全（最终方案 + 任务完成总结；→ [task-workflows.md#任务归档前置信息采集](task-workflows.md#任务归档前置信息采集)）
3. summary checkpoint（→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）
4. `ltc rag update`（→ [SKILL.md#索引维护](SKILL.md#索引维护)）
5. spec 沉淀判定（→ [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)）
6. 项目关系审查：任务中是否发现了未记录的项目间关系 → 补充 `ltc project relation add`（→ [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）
7. 二次审阅（→ [task-workflows.md#归档后的二次审阅与-spec-沉淀判定](task-workflows.md#归档后的二次审阅与-spec-沉淀判定)）

## 七、Spec 优先级与冲突

`项目级 > 用户级 > 全局`。冲突以项目级为准，但必须告知用户。

（→ [spec-workflows.md#层级](spec-workflows.md#层级)）

## 八、禁令

**[起手]**

- 跳过上下文直接凭经验改陌生项目

**[实施]**

- 把一次性需求写成长期 spec / 把项目级特例提升为全局规则
- 绕过 PRD 直接改代码
- 打 checkpoint 前不做 PRD 自检
- design 模式下改业务代码
- 忽视上下文压缩信号
- 编辑 spec 正文后不刷新 frontmatter（应运行 `ltc spec migrate`，→ [spec-workflows.md#写入流程](spec-workflows.md#写入流程)）

**[归档]**

- PRD 拖到归档才补
- 任务仍挂着子任务时直接删除/归档；先迁移、清空或完成子任务

**[安全]**

- 主动同步 skill 真源到客户端副本目录（除非任务本身需要）
- 主动 `pnpm build` / `ltc init` / `ltc rag update`（除非用户要求或任务需要）
- AI 自主调用需确认的命令时不带 `--force`（→ [SKILL.md#--force-跳过二次确认](SKILL.md#--force-跳过二次确认)）

## 九、输出精简

所有输出精炼高效，不丢信息、不加冗余。省主语、省预告、省过渡、省感叹、省复述。

无依赖的连续 ltc 命令用 `&&` 串联执行，减少请求轮次、节省 token（→ [SKILL.md#命令执行效率](SKILL.md#命令执行效率)）。

即将做的事直接做，不先解释。任务流程中的"精简但不静默"原则详见 [task-workflows.md#输出原则精简但不静默](task-workflows.md#输出原则精简但不静默)。
