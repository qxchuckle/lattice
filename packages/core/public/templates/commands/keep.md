# /lattice/keep

保持 Lattice 工作流的轻量提示器。可在连续对话中频繁使用。

默认不跑多条 CLI、不写文件、不输出长表格。仅在自检发现真实漂移时按需补救。

**[依赖文档]**（本命令期间按需 read，不要全量加载）：
- SKILL.md：导航 + 起手契约（默认必读）
- lattice-rules.md：实施期循环 / checkpoint 时机 / spec 更新硬规则 / 回答闭合自检（#十、回答闭合自检）
- task-workflows.md：任务身份不明 / 实施期循环模糊 / checkpoint 触发条件不明
- spec-workflows.md：spec 清单不记得 / spec 层级与冲突不明

## 用法

- 裸用 `/lattice/keep`：仅自检并简报
- 带请求 `/lattice/keep <用户请求>`：先自检（一行简报），再处理请求

## 自检清单（按顺序，失败按括号补救）

**前置**：必读 lattice skill 的 `SKILL.md`（导航 + 起手契约）。下列各步发现认知缺失时，按 `SKILL.md` 渐进式加载导航**只读对应子文档**，不要全量加载。

1. **任务身份**：活跃任务 ID + 标题是否在当前上下文中明确可述？
   - 否 → `ltc task list --current --status in_progress`；多条无法判断 → 列候选请用户确认，不硬猜；如任务创建 / 进展 / 归档流程也模糊 → 读 task-workflows.md
2. **工作流约束**：lattice-rules.md 实施期循环（PRD → spec → code → progress）/ checkpoint 时机 / spec 更新规则是否在当前上下文中明确可述？
   - 否 → 读 SKILL.md + lattice-rules.md；实施期循环 / checkpoint 时机 模糊 → 加读 task-workflows.md；spec 更新规则模糊 → 加读 spec-workflows.md
3. **Spec 清单**：当前项目可用 spec 列表（项目级 / 用户级 / 全局级各有哪些主题）是否在当前上下文中明确可列？
   - 否 → `ltc context` 重新拉取上下文与 spec 列表（仅清单层，不展开全文读取）；如对 spec 层级 / 冲突 / 模板机制也模糊 → 加读 spec-workflows.md
4. **PRD 范围**：当前请求落在活跃任务 PRD 目标 / 范围 / 约束内？
   - 否 → 提示用户走 `/lattice/task/start` 新建任务，不默默扩范围
5. **漂移盘点**：上次 checkpoint 后有未记录改动？对话已确定的目标 / 范围 / 约束 / 方案变更已同步 PRD？
   - 未记录改动 → `ltc task checkpoint` 立即补打
   - PRD 漂移 → `search_replace` 同步 PRD + 补 `decision` / `pivot` checkpoint
   - checkpoint 类型 / 触发条件不确定 → 读 [task-workflows.md#checkpoint 类型]
6. **回答闭合**：按 [lattice-rules.md#十、回答闭合自检] 条件表审查本轮是否有遗漏的元数据维护动作（ref-spec / 项目注册 / 关系 / associate / rag update）
   - 信息不足 → 主动调 `ltc search` / `ltc context` / `ltc project list` 核实（[SKILL.md#自主信息获取]）
   - 命中 → 立即执行对应闭合动作

本命令仅校验 spec **清单**是否记得；spec **内容**认知丢失到无法判断行为合规性，属严重漂移，走升级路径。

## 输出（必须极简）

- 无漂移：`✓ 工作流仍在轨：[任务 ID 简写]-[任务标题]。`（一行）
- 已纠偏：`✓ 已纠偏：补打 N 个 checkpoint / 同步 PRD x 处。`（一行）
- 带附加请求：上面一行后直接接续处理请求，不分段
- 严重漂移：见下节

禁止：默认输出表格 / 多段标题 / 罗列 CLI 原始输出。

## 严重漂移升级

任一条命中即严重漂移：

- ≥3 个 checkpoint 缺失且跨多个工作单元
- PRD 与实际代码段落级漂移
- 当前对话主题与活跃任务 PRD 主题完全不同
- 关键 spec 认知丢失到无法判断行为合规性

处理：输出 `⚠ 发现 N 处严重漂移：xxx；转入完整重对齐。` 一行，随即按 [lattice-rules.md#五、失忆恢复] 流程执行，不交用户决策；附加请求顺延到重对齐完成后再处理。

## 约束

- 无漂移不无中生有打 checkpoint / 改 PRD
- 仅允许写入：`ltc task checkpoint` / `ltc task associate` / `search_replace` 同 PRD / §十 闭合动作（ref-spec / register / relation add / spec migrate / rag update）
- 不在 Lattice 项目目录 → 仅做 skill 与对话级保持，告知用户后继续
- 无活跃任务 → 跳过 1 / 4 / 5 / 6 步，仅核对工作流约束与 spec 清单
- 不替代常规 checkpoint：实施期循环该打的照打，不堆到本命令集中触发
