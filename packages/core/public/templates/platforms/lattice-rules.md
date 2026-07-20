# Lattice 工作流（系统级常驻规则）

Lattice 是跨项目 AI 上下文管理工具。本文件定义 AI 使用 Lattice 时的硬性约束。

> **本文定位**：系统级硬约束清单（自含可读）。每条规则末尾 `（→ xxx.md#yy）` 跳到 skill 子文档展开。本文不复述子文档流程。

**审慕原则**：行动前先确认有无 Lattice 更佳路径。需要看源码先查已注册仓库；需要项目约定先读 spec；不确定先查历史任务；**程序化工作流必须委派预定义 subagent，禁止主线直接执行起手/归档/铺底等命令组合**；平台不支持 subagent 时退化为串行执行（→ [subagent-delegation.md#预定义-subagent优先使用](subagent-delegation.md#预定义-subagent优先使用)）。

## 一、起手契约（每个新会话第一件事）

1. `ltc context --query "<当前主题>"` 拿上下文+语义关联（→ [project-context.md#进入项目默认动作](project-context.md#进入项目默认动作)）
2. 按主题精读相关 spec（宁多勿少；→ [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)）
3. 有活跃任务 → `ltc task info` + `task progress` + read design.md（→ [task-workflows.md#task-start-后的起手动作](task-workflows.md#task-start-后的起手动作)）
4. 用户提到"规范/之前/类似/历史/跨项目" → `ltc search --json`（→ [project-context.md#跨项目相似需求搜索](project-context.md#跨项目相似需求搜索)）
5. 横跨多仓库 → `ltc project list --with-relations`；发现未记录关系 → `ltc project relation add --ai-inferred --from-task <id>`（→ [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）
6. 查源码 → 优先 `ltc project list --search <包名>` 定位本地仓库（→ [project-discovery.md#进入未知目录时](project-discovery.md#进入未知目录时)）

## 二、Design 模式约束

`/lattice/task/design` 后禁改业务代码。允许：read_file / grep / search / lsp / ltc / 写 design.md。禁止：search_replace / create_file / delete_file / 有副作用终端命令。

退出：用户明确"开始实施"。记录义务：讨论追加 design.md；关键决策打 decision checkpoint；结论回写 prd.md。未显式 design 但出现方案讨论 → 追加 design.md。

（→ [task-workflows.md#任务模式design-vs-implementation](task-workflows.md#任务模式design-vs-implementation)）

## 三、实施期循环

`ltc task start` 后每轮：PRD 同步 → spec 精读 → 改代码 → 打 checkpoint。（→ [task-workflows.md#实施期多轮对话循环每轮用户输入到来时](task-workflows.md#实施期多轮对话循环每轮用户输入到来时)）

**强制规则**：

1. PRD 硬触发命中 → 先改 PRD 再改代码（→ [task-workflows.md#prd-同步硬触发清单t1t8](task-workflows.md#prd-同步硬触发清单t1t8)）
2. 写代码前/打 checkpoint 前/complete 前/推翻方案后各有必做动作（→ [task-workflows.md#写代码前的动作锚点](task-workflows.md#写代码前的动作锚点) / [task-workflows.md#打-checkpoint-前的-prd-自检](task-workflows.md#打-checkpoint-前的-prd-自检)）
3. 持续精读 spec——每轮检查，非一次性；宁多勿少（→ [task-workflows.md#spec-选读触发条件](task-workflows.md#spec-选读触发条件)）
4. 代码改完必须打 checkpoint（→ [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)）
5. 推翻方案 = pivot checkpoint（→ 同上）
6. 发现可复用内容 → 询问用户是否沉淀 spec（→ [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)）
7. 及时打 checkpoint 不延后（→ 同 4）
8. 单输入多语义 → 拆多条 checkpoint（→ 同 4）
9. 信息齐备再动手（→ [SKILL.md#自主信息获取](SKILL.md#自主信息获取)）

颗粒度兜底：连续 3 轮无 checkpoint → 补 `note`。

> **fast-start 例外**：不走实施期循环，但 spec 精读和沉淀判定仍适用（→ [fast-start-workflows.md](fast-start-workflows.md)）。

### 为什么不能跳

| 跳的是 | 后果 |
|---|---|
| PRD 同步 | 下轮压缩后认知偏差 → 改错代码 |
| spec 精读 | 缺项目规则 → 产出与约定冲突 → 返工 |
| checkpoint | 丢实施轨迹和关键决策 |
| 项目关联 | task.json 与实际不一致 → 后续误判 |

## 四、项目关联同步

任务进行中实时维护 `task.json` 的 `projects`/`scopePaths`/`referencedSpecs`（→ [task-workflows.md#项目关联同步](task-workflows.md#项目关联同步)）。发现新项目/新路径/新 spec 当轮同步。

**task.json 结构化字段是机器可读元数据唯一来源，PRD 自然语言不能替代 CLI 记录。**（命中 T8；→ [task-workflows.md#prd-同步硬触发清单t1t8](task-workflows.md#prd-同步硬触发清单t1t8)）

项目间关系同理：发现未记录关系 → `ltc project relation add --ai-inferred --from-task <id>`（→ [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)）。

## 五、上下文压缩失忆恢复

信号：出现 "summary"/"continued from previous" · 不记得会话开头 · 用户提"之前的方案"但印象模糊 · 对 spec/规范印象模糊。

恢复（必须委派 `lattice-task-handoff`；不支持 subagent 时串行执行）：

1. 重新调用 `lattice` skill（→ [SKILL.md#文档加载策略](SKILL.md#文档加载策略)）
2. `ltc context --query` + 精读 spec + read PRD/design.md
3. `ltc task list --current` → `task info` → `task progress`
4. 重载 `--type correction/constraint/context` checkpoint
5. 回填缺失 checkpoint

## 六、任务完成闭环

`ltc task complete` 前必须：

1. 前置信息采集（→ [task-workflows.md#任务归档前置信息采集](task-workflows.md#任务归档前置信息采集)）
2. PRD 补全（最终方案+完成总结）
3. summary checkpoint
4. `ltc rag update`
5. spec 沉淀判定（→ [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)）
6. 项目关系审查
7. 二次审阅（→ [task-workflows.md#归档后的二次审阅与-spec-沉淀判定](task-workflows.md#归档后的二次审阅与-spec-沉淀判定)）

> fast-start 归档：先创建任务 → start → 回填 PRD → 按上述闭环（→ [fast-start-workflows.md](fast-start-workflows.md)）。

## 七、Spec 优先级与冲突

`项目级 > 用户级 > 全局`。冲突以项目级为准，必须告知用户。（→ [spec-workflows.md#层级](spec-workflows.md#层级)）

## 八、禁令

**[起手]** 跳过上下文直接凭经验改陌生项目

**[实施]** 一次性需求写成长期 spec · 绕过 PRD 改代码 · 打 checkpoint 前不做 PRD 自检 · design 模式改业务代码 · 忽视压缩信号 · 编辑 spec 正文后不 `ltc spec migrate` · 对 Lattice 文档部分读取（必须全量）

**[归档]** PRD 拖到归档才补 · 有子任务时直接删除/归档

**[安全]** 正文记录敏感信息（应写 `~/.lattice/.cache/sensitive/`）· 主动同步真源到客户端副本 · 主动 build/init/rag update（除非任务需要）· 需确认命令不带 `--force`

## 九、输出精简

省主语、省预告、省过渡、省感叹、省复述。无依赖 ltc 命令用 `&&` 串联。即将做的事直接做，不先解释。（→ [task-workflows.md#输出原则精简但不静默](task-workflows.md#输出原则精简但不静默)）
