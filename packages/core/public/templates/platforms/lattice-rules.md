# Lattice 工作流（系统级常驻规则）

跨项目 AI 上下文管理硬约束。每条 `（→ xxx.md）` 跳子文档展开，本文不复述流程。

**行动前必过**：

1. 看源码 → `ltc project list --search <包名>`
2. 项目约定 → 读 spec
3. 不确定 → 查历史任务
4. 程序化工作流（起手/归档/铺底/搜索/体检/失忆恢复/规范摘要/影响分析）→ 必须委派 subagent；不支持时退化串行（→ subagent-delegation.md）
5. 非 cwd 路径且不执行 ltc → `ltc project register <paths...>`（→ project-discovery.md「自动注册守卫」）

ltc 命令自动从 cwd 向上注册。将在该路径执行 ltc → 无需手动 register。

## 一、起手契约（新会话第一件事）

1. `ltc context --query "<主题>"`（→ project-context.md「进入项目默认动作」）
2. 按主题全文读取 spec，宁多勿少（→ spec-workflows.md「按任务主题全文读取相关 spec」）
3. 有活跃任务 → `task info` + `task progress` + read design.md（→ task-workflows.md「task start 后的起手动作」）
4. 用户提"规范/之前/类似/历史/跨项目" → `ltc search --json`
5. 多仓库 → `ltc project list --with-relations`；未记录关系 → `relation add --ai-inferred`
6. 查源码 → `ltc project list --search <包名>`

## 二、Design 模式约束

design 后禁改业务代码。允许：read / grep / search / lsp / ltc / 写 design.md。禁止：search_replace / create_file / delete_file / 有副作用命令。

退出：用户明确"开始实施"。记录：讨论 → design.md；决策 → checkpoint；结论 → prd.md。未显式 design 但出现方案讨论 → 追加 design.md。

## 三、实施期循环

每轮：PRD 同步 → spec 选读 → 改代码 → checkpoint → 回答闭合自检。（→ task-workflows.md「实施期循环」）

1. PRD 硬触发命中 → 先改 PRD（→ task-workflows.md「① PRD 硬触发」）
2. 写代码前/checkpoint 前/complete 前/推翻方案后各有必做动作
3. spec 每轮检查，非一次性
4. 代码改完 → checkpoint；推翻方案 → pivot
5. 可复用内容 → 询问用户沉淀 spec（→ spec-workflows.md「沉淀判定」）
6. 单输入多语义 → 拆多条 checkpoint
7. 信息齐备再动手

兜底：3 轮无 checkpoint → 补 `note`。fast-start 不走循环，但 spec 全文读取和沉淀仍适用。

## 四、项目关联同步

实时维护 task.json `projects`/`scopePaths`/`referencedSpecs`。发现新项目/路径/spec 当轮同步（→ task-workflows.md「项目关联同步」）。

**task.json 是机器可读元数据唯一来源，PRD 不可替代。**（T8）

## 五、失忆恢复

信号：出现 "summary"/"continued from previous" · 不记得会话开头 · 对 spec/规范印象模糊。

恢复（必须委派 `lattice-task-handoff`；不支持时串行）：

1. 重载 lattice skill
2. `ltc context --query` + 全文读取 spec + read PRD/design.md
3. `task list --current` → `task info` → `task progress`
4. 按优先级重载 checkpoint：correction/constraint（硬约束）→ decision/pivot（方向）→ 其余按需
5. 构建锚定式恢复摘要（4 字段）：
   - **intent**：当前任务目标（from PRD）
   - **changes**：已完成改动（from milestone/decision）
   - **decisions**：关键决策及理由
   - **next**：下一步计划
6. 回填缺失 checkpoint

## 六、任务完成闭环

`task complete` 前：

1. 前置采集（→ task-workflows.md「归档」）
2. PRD 补全（最终方案+总结）
3. summary checkpoint
4. `ltc rag update`
5. spec 沉淀判定
6. 项目关系审查
7. 二次审阅

fast-start 归档：创建任务 → start → 回填 PRD → 按上述闭环。

## 七、Spec 优先级

`项目级 > 用户级 > 全局`。冲突以项目级为准，告知用户。

## 八、禁令

**[起手]** 跳过上下文凭经验改陌生项目

**[实施]** 一次性需求写长期 spec · 绕过 PRD 改代码 · checkpoint 前不做 PRD 自检 · design 改业务代码 · 忽视压缩信号 · 编辑 spec 后不 `ltc spec migrate` · Lattice 文档部分读取（必须全量）

**[归档]** PRD 拖到归档才补 · 有子任务时直接删除/归档

**[安全]** 正文记录敏感信息（→ `~/.lattice/.cache/sensitive/`）· 主动同步真源到副本 · 主动 build/init/rag update（除非任务需要）· 需确认命令不带 `--force`

## 九、输出精简

省主语、省预告、省过渡、省复述。无依赖命令 `&&` 串联。直接做，不先解释。

## 十、回答闭合自检

有活跃任务时，每轮回答发出前逐项审查（命中才执行，未命中跳过）：

1. 读取/参照了新 spec → `ltc task ref-spec <task-id> <spec-name>`
2. 出现非 cwd 新路径（未注册） → `ltc project register <paths...>`
3. 发现项目间未记录关系 → `ltc project relation add <a> <b> --type <t> --description "证据" --ai-inferred --from-task <id>`
4. 涉及新项目/路径（任务未关联） → `ltc task associate <task-id> --project <pid>` / `--paths <p>`
5. PRD 写入了路径/包名/spec 但 task.json 未同步 → CLI 同步（T8）
6. 代码改动完成但本轮无 checkpoint → `ltc task checkpoint <task-id> --type <type> --title "..." -m "..."`
7. 推翻/变更了方案方向 → checkpoint `--type pivot`
8. 产生可复用认知/规则 → 询问用户是否沉淀 spec
9. 编辑了 spec 正文 → `ltc spec migrate`
10. spec/PRD/项目结构变更 → `ltc rag update`

无活跃任务 → 整段跳过。
