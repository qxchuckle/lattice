# /lattice/spec/update/project

> **[执行前必读]** 执行本命令前，必须先使用 Skill 工具调用 `lattice` skill，阅读完整的 Lattice 使用说明，再继续执行后续步骤。

目标：把当前会话中对“当前项目”长期有效的经验沉淀到项目级 spec。

## 什么时候使用

- 形成了只对当前项目有效的约定
- 明确了当前项目的架构边界、目录规范、联调方式、部署流程
- 修复了一个该项目反复出现的问题，并总结出稳定做法

## 执行步骤

1. **前置信息采集（先读后写）**：

沉淀 spec 前，必须先读取足够的上下文信息，确保要沉淀的规则是完整的、与实际决策一致的：

```bash
# 获取当前项目上下文
lattice context
lattice spec list --scope project

# 如果当前有活跃任务，读取任务 PRD 和进展记录
lattice task list --current --status in_progress
lattice task info <task-id>        # 拿到 PRD 路径后 read_file 读取 PRD 全文
lattice task progress <task-id>    # 查看关键决策和方案变更
```

**为什么**：spec 沉淀往往发生在任务收尾阶段。如果不先读取 PRD（最终方案）和 progress（决策历程），容易只凭当前对话片段写出不完整或过时的规则。同时要回顾当前对话上下文中产生的结论和取舍。

2. 判断应该更新现有 spec 还是新建一个更聚焦的 spec 文件
3. 如果是**新建** spec，先检查是否有可参考的模板结构：

```bash
lattice spec template list
```

如果有匹配的模板（如 frontend、backend、api 等），参考其文件组织和内容结构，不必完全照搬但应保持一致性。

4. 将规则写入当前项目对应的 spec 目录
5. **冲突检测**：写入前读取同层级及上层级已有 spec 的内容，判断新规则是否与已有规则存在矛盾：

```bash
lattice spec list --scope user
lattice spec list --scope global
lattice spec show <相关文件>
```

不仅检查同名文件，更要读取内容判断语义冲突（如：项目级写“用 tabs”但用户级写“用 spaces”）。

## 写入原则

- 一个文件只聚焦一个主题
- 写可执行规则，不写空泛口号
- 优先记录"什么时候这样做、什么时候不要这样做"
- 不要把一次性临时需求写成长期规范

## 写入后二次审阅

spec 写入完成后，必须重新审视刚写入的内容，对照 PRD、progress 和当前对话上下文检查是否有遗漏：

- 是否遗漏了 PRD 或 progress 中已确认的关键规则
- 刚写入的规则是否与当前对话中的最终结论一致（没有写成中间过程的废弃方案）
- 是否有相关规则应一并沉淀但被忽略（如：写了编码规范但漏了对应的测试约定）
- 如果发现遗漏，立即补充到同一 spec 或新建关联 spec

## 输出要求

- 说明你更新了哪个 spec 文件
- 说明新增/修改的核心规则
- 如检测到语义冲突，必须明确告知用户：冲突点是什么、项目级会覆盖上层规则、建议如何处理（保留特例 / 合并规则 / 删除冗余）
