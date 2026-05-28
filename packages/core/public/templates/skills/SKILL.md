---
name: lattice
description: >-
  通过 Lattice CLI 获取跨项目上下文、规范、任务和搜索能力。触发词包括：
  Lattice、spec、规范、约定、项目标准、历史方案、类似项目、跨项目经验、
  当前任务、共享组件、跨仓库需求、~/.lattice、lattice CLI。也应在以下工作流
  场景主动使用：第一次进入一个已注册项目时先获取上下文和分层 spec；编码前先确认
  项目级 / 用户级 / 全局级规则；用户询问“之前哪个项目做过类似需求”“有没有可复用
  方案”“当前项目有哪些约定”时先搜索和聚合上下文；需求涉及多个仓库、共享组件或
  跨项目任务时优先查看任务和关联项目；会话中形成新的长期规则、架构决策或开发流程
  时，判断是否应沉淀为项目级、用户级或全局级 spec。
---

# Lattice

Lattice 是本机的跨项目上下文层，围绕 `projects`、`tasks`、`specs` 和搜索能力组织长期知识，默认数据根目录是 `~/.lattice/`。

## 何时使用

在以下场景主动使用 Lattice：

1. 第一次进入一个已注册项目
2. 用户提到项目规范、历史约定、团队标准、架构规则
3. 用户问“类似需求之前在哪做过”或“有没有可复用方案”
4. 当前工作涉及多个项目、共享组件或跨仓库任务
5. 会话中形成了值得长期沉淀的规则、流程或架构决策

## 默认入口工作流

### 进入项目时

先运行：

```bash
lattice context
lattice status
```

目标：

- 识别项目级、用户级、全局级 spec
- 确认当前是否存在活跃任务
- 判断是否已有相关历史上下文可复用

### 需要找相似经验时

优先运行：

```bash
lattice search "<查询词>" --json
```

对 AI / Agent：

- 调用 `lattice search` 时优先带上 `--json`，以便拿到结果类型、分数、路径和元数据，支持后续推理与筛选

必要时继续补充：

```bash
lattice task list --current
lattice context --task <id>
```

## 配套命令速查

```bash
# 上下文与搜索
lattice context
lattice context --task <id>
lattice status
lattice search <query> --json
lattice search <query> --type checkpoint --json
lattice search <query> --type relation --json

# 项目
lattice link
lattice link --restore <id>
lattice link --force-new
lattice unlink
lattice unlink --remove-data
lattice project list [--has-git] [--orphaned] [--with-relations]
lattice project info <id>
lattice project where <path>
lattice project relation list [id]
lattice project relation add <a> <b> [--type <type>] [--from-task <taskId>] [--ai-inferred]
lattice project relation remove <relation-id>

# 任务
lattice task list
lattice task create "<title>" --current
lattice task update <id> --add-project <project-id>
lattice task associate <id> --paths <p1> <p2> --note <note>
lattice task associate <id> --project <project-id>
lattice task start <id>
lattice task checkpoint <id> --type <type> --title "..." -m "..."
lattice task progress <id>
lattice task progress <id> --last <n>
lattice task complete <id>
lattice task archive <id>
lattice task reopen <id>
lattice task delete <id>

# Spec
lattice spec list
lattice spec show <file>
lattice spec conflicts
lattice spec template list
lattice spec template apply <name>

# 索引维护
lattice rag status
lattice rag update
lattice rag rebuild
lattice doctor
lattice doctor --migrate
lattice doctor --rebuild-fingerprints
lattice doctor --recheck-scope-paths
```

## 索引维护原则

以下操作会产生新内容，完成后应运行 `lattice rag update` 确保搜索索引是最新的：

- 新建或修改 spec 文件
- 创建任务或更新任务 PRD
- 任务归档后（因为 PRD 通常在归档前补充了总结）
- 新注册或删除项目

如果 `rag update` 报错或搜索结果明显不对，降级使用 `lattice rag rebuild` 全量重建。

## 读取原则

- 先拿上下文，再读规范，再动代码
- spec 优先级始终是 `project > user > global`
- 遇到同名 spec 覆盖时，要提醒用户覆盖关系
- 只有长期稳定、可复用的信息才应沉淀为 spec
- 产生新内容后及时 `rag update`，确保搜索可用

## 渐进式加载

默认只读本文件；遇到具体场景时再继续读取对应子文档：

- 项目上下文、任务上下文、相似案例搜索：[project-context.md](project-context.md)
- 项目查找/识别、多路径绑定、指纹选单、AI 推断项目关系：[project-discovery.md](project-discovery.md)
- spec 层级、冲突判断、模板和规则沉淀：[spec-workflows.md](spec-workflows.md)
- 任务创建、开始、进展追踪、完成、归档：[task-workflows.md](task-workflows.md)
- Agent Commands 的用途与使用边界：[agent-commands.md](agent-commands.md)
- 所有 CLI 配套命令的参数与功能：[command-reference.md](command-reference.md)
