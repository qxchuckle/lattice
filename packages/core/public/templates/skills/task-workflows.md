# 任务工作流

本文件用于处理任务的创建、开始、完成和归档。

## 目标

- 让当前会话和任务状态保持一致
- 把任务上下文接入当前工作
- 在任务结束时判断是否需要沉淀新的 spec

## 常见流程

### 需要建立任务链路时

如果一个任务明显属于另一个任务的后续步骤，优先在创建时指定父任务，而不是只在 PRD 里靠文字描述关系。

- 创建子任务时使用：

```bash
lattice task create "<title>" --current --parent <parent-task-id>
```

- 需要查看当前任务在整条链路中的位置时，使用：

```bash
lattice task lineage <task-id>
lattice task tree <task-id>
lattice task tree <task-id> --descendants
```

- 需要修改任务归属时，使用：

```bash
lattice task update <task-id> --parent <parent-task-id>
lattice task update <task-id> --clear-parent
```

- 如果某个任务仍然挂着子任务，不要直接删除或忽略它的链路关系；先迁移、清空或完成这些子任务，再继续后续操作。

### 已有任务 ID

运行：

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

### 只有非 ID 参数

先结合命令参数和当前对话，总结出一个简洁、明确的任务标题。

- 不要直接把原始命令参数当作任务标题
- 尤其不要把文件路径、文件引用、长段描述或命令噪音原样塞进标题
- 如果命令参数只是线索，可以结合当前会话主题补全为更合适的标题

如果当前目录是已注册项目，运行：

```bash
lattice task list --current
lattice search "<总结出的任务标题>" --project <project-id> --type task --json
```

先判断当前项目中是否已有相似且状态为 `in_progress` 的任务。

- 如果有，先提醒用户是否其实要继续已有任务
- 只有在没有相似进行中任务，或用户明确要求新建时，才运行：

```bash
lattice task create "<总结出的任务标题>" --current
```

拿到任务 ID 后，再运行：

```bash
lattice task start <task-id>
lattice context --task <task-id>
```

开始任务后，应主动完善该任务的 `prd.md`。

- 不要停留在默认生成的空白标题
- 至少记录任务目标、约束、当前方案、关键待办和待确认点
- `prd.md` 可以只承担任务主入口职责，不必把所有细节都堆在一个文件里
- 当单个任务过大、`prd.md` 已经过长，或任务天然分成多个步骤时，可以把详细设计、计划、阶段记录、复盘等拆到该任务目录下的其他 Markdown 文件中，再由 `prd.md` 负责摘要、索引和跳转
- 这种“渐进式加载”尤其适合大任务、长周期任务，以及按 plan / phase / step 分阶段推进的任务
- 如果用户后续补充了设计、约束、边界条件、方案取舍或新的阶段结论，要自行判断是否需要同步更新 PRD
- 如果在任务执行过程中发现实际涉及的项目范围发生变化，例如新增了其他关联项目，或确认某些项目已经不再相关，也要同步更新任务元数据里的 `projects` 字段
- 如果 `prd.md` 变得过长，可以把详细内容拆到其他 Markdown 文件中渐进式加载；但 `prd.md` 仍必须是任务的主入口，负责摘要、结构索引和子文档链接
- 当任务理解发生变化时，优先更新 PRD，再继续后续实现或分析

### 任务完成时

归档前，先更新一次该任务的 `prd.md`。

- 补充最终采用的设计或执行方案
- 记录关键结果、主要取舍和仍待后续处理的问题
- 增加“任务完成总结”，明确这次任务实际交付了什么
- 如果 `prd.md` 过长，可以把详细复盘内容拆到其他 Markdown 文件中渐进式加载；但 `prd.md` 仍必须作为必要入口，负责摘要、索引和最终总结

先完成，再归档：

```bash
lattice task complete <task-id>
lattice task archive <task-id>
```

如果用户没有提供任务 ID，或提供的内容不是任务 ID，则先运行：

```bash
lattice task list --current
lattice search "<根据当前对话和命令参数总结出的任务标题或主题>" --project <project-id> --type task --json
```

先在当前项目中找出 `in_progress` 的候选任务，并结合当前对话判断哪个任务最可能是本次会话正在结束的任务。

- 如果能推断出明显候选，先向用户二次确认是否归档该任务
- 只有在用户确认后，才继续执行 `info`、`complete` 和 `archive`
- 如果没有明显候选，不要擅自归档，先把候选任务列给用户确认
- 如果当前没有匹配的可归档任务，也可以告诉用户：如果需要，可以根据当前对话先新建一个任务，补上必要描述和完成总结后再归档

## 归档前判断

在总结中补充：

- 本次任务是否形成了长期规则
- 这些规则更适合项目级、用户级还是全局级
- 是否需要更新对应 spec

## 相关命令

```bash
lattice task list
lattice task list --current
lattice task create "<title>" --current
lattice task create "<title>" --current --parent <task-id>
lattice task update <id> --add-project <project-id>
lattice task update <id> --parent <task-id>
lattice task update <id> --clear-parent
lattice task tree <id>
lattice task tree <id> --descendants
lattice task lineage <id>
lattice task start <id>
lattice task complete <id>
lattice task archive <id>
lattice task reopen <id>
lattice context --task <id>
```

## 输出要求

- 明确任务 ID、当前状态和关联项目
- 如果任务标题是根据非 ID 参数归纳出来的，明确告诉用户采用了什么标题
- 提炼任务最关键的约束与背景
- AI / Agent 调用 `lattice search` 查找候选任务时优先带上 `--json`，再根据结构化字段做判断
- 如果发现相似进行中任务，先提醒用户确认是否继续已有任务
- 如果任务执行中更新了关联项目，明确告诉用户 `projects` 字段已同步更新以及当前关联项目列表
- 开始任务后主动完善并持续维护该任务的 `prd.md`
- 即使拆分了 PRD，也保持 `prd.md` 作为必要入口
- 如果用户未提供归档目标，先确认当前会话对应的进行中任务，再执行归档
- 如果没有匹配的可归档任务，明确告诉用户当前没有候选，并补充可以根据当前对话先新建任务再归档
- 归档前先更新 `prd.md`，补上任务完成总结
- 即使归档时 PRD 已拆分，也通过 `prd.md` 回写最终总结和入口索引
- 结束任务时给出是否需要沉淀 spec 的判断
