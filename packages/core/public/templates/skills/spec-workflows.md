# Spec 工作流

本文件是 Lattice 中所有 **spec 概念与流程**的权威源。其他文档（含 platforms/lattice-rules.md、commands/spec/update/*.md、task-workflows.md）应通过锚点引用本文件，不再重复定义。

## spec 的双重职能（核心定义）

spec 同时承担两种职能，**两类内容都值得沉淀**：

- **行为约束类**：约束 AI / 团队应该怎么做、不要怎么做（编码规范、提交流程、架构边界、依赖方向等）
- **项目认知类**：AI 认识项目的稳定经验（系统架构、模块职责、目录结构、领域概念、设计动机、可复用方法论、关键流程地图）

> **核心判定（统一标准）**：下次有人 / AI 进入这个项目，是否还需要这条信息？

## 层级优先级

基本三层：

1. `~/.lattice/users/<username>/projects/<id>/spec/`（项目级）
2. `~/.lattice/users/<username>/spec/`（用户级）
3. `~/.lattice/spec/`（全局级）

嵌套项目场景扩展为五层（子项目位于父项目目录内时自动生效）：

```
当前项目 > 直接父级项目 > 更远祖先项目 > 用户级 > 全局级
```

冲突处理：项目级优先；祖先按距离覆盖（近覆盖远）；用户级覆盖全局级；同名冲突必须明确告诉用户覆盖关系，不静默忽略。

## 按任务主题精读相关 spec（必做）

进入项目、任务起手、上下文压缩失忆恢复、引入新模块/概念时，**必须**按当前主题挑选并精读相关 spec。

> ⚠️ `lattice context` / `lattice context --task <id>` 输出的只是 spec **标题 + 路径 + 摘要**（摘要常为"[缺失摘要]"）。**看到标题不等于了解内容**。

### 判断哪些 spec 相关

- 标题 / 路径关键字与当前任务标题 / PRD 目标 / 修改范围匹配
- `lattice context --task <id>` 的"语义关联 Spec"列表（基于 RAG 推荐）
- **认知类 spec 默认应读**（系统架构 / 模块边界 / 领域概念 / 项目结构 / 方法论 / 关键流程地图）
- **约束类 spec 按本次会修改的代码范围决定是否读**（编码规范、提交流程等）

### 精读动作

- 必须 `read_file` 读取正文
- 摘要为"[缺失摘要]"或过于笼统的，**更必须读正文**

### 反模式

- ❌ 仅复述 spec 标题就开始动手 / 改代码
- ❌ 把"已运行 lattice context"等同于"已了解 spec 内容"
- ❌ 只读约束类、跳过认知类（觉得"那只是介绍"）

### 关联 spec

实施时确实参照了某个 spec → `lattice task ref-spec <task-id> <spec-name>` 关联。

## 沉淀判定（统一标准）

适用于任务过程中、归档前以及 `/lattice/spec/update/*` 命令。

### 必须沉淀（强制）

- **用户显式行为指示**：用户明确告诉 AI "应该怎么做 / 不要怎么做"的行为规则（"只改源码不碰产物""用 X 而不是 Y"）
- **用户主动给出的项目认知**：用户在对话中明确点出来的稳定项目知识（"section 模块只能这样组织""这个数据流是 …"）

### 建议沉淀（满足核心判定问题）

- **行为约束类**：本次任务形成的新架构约定、流程规则、反复适用的开发经验
- **项目认知类**：长期适用的项目结构 / 模块职责 / 领域概念 / 设计动机 / 可复用方法论 / 关键流程地图

> 不要因为"它不像规范"就丢弃认知类内容。

### 不沉淀

- 一次性临时需求 / 单次 bug 排查过程
- 仍未确认的猜测 / 未验证的方案
- 纯任务级细节（应进 PRD / progress，不进 spec）
- 仅对当前任务有效的 workaround

## 选择写入层级

| 适用范围 | 层级 |
|---|---|
| 只对当前项目长期有效 | **项目级** |
| 跨多个项目可复用，但仍属当前用户/团队习惯 | **用户级** |
| 多用户、多项目都成立的默认规则 | **全局级** |

判定时回避两类错误：
- ❌ 把项目级特例直接提升为全局规则
- ❌ 把多项目复用的工作方式锁死在单个项目

## 适用范围声明（user / global 必须）

用户级和全局级 spec 必须包含 `## 适用范围` 段落，明确声明：

- 适用于哪些项目 / 语言 / 框架
- 不适用于哪些情况（如有）
- 如何判断当前项目是否落入本规范的范围

> **为什么**：缺失适用范围会导致 AI 在聚合上下文时盲目把所有 user/global spec 应用到当前项目，产生误导。

`lattice spec list` 会对缺失适用范围的 user/global spec 输出警告。**项目级 spec 不需要**（天然只对当前项目生效）。

参考示例：

```markdown
## 适用范围

- 适用于所有前端项目（React / Vue / 纯 TS 库），不限定特定工作空间
- 本规范为通用导入约定，项目级有更严格规则时以项目级为准
```

## spec 写入流程（先读后写 + 二次审阅）

`/lattice/spec/update/{project,user,global}` 命令以及任务过程中沉淀 spec 时，**统一遵循本流程**。

### 第一步：前置信息采集（强制，先读后写）

```bash
# 1. 当前项目上下文
lattice context
lattice spec list --scope <对应层级>

# 2. 如果当前有活跃任务，读取 PRD 与 progress
lattice task list --current --status in_progress
lattice task info <task-id>      # 拿到 PRD 路径后 read_file 读取 prd.md 全文
lattice task progress <task-id>  # 查看决策历程与方案变更

# 3. 回顾当前对话上下文中的最终结论与取舍
```

> **为什么**：spec 沉淀往往发生在任务收尾。如果不读 PRD（最终方案）和 progress（决策历程），容易写出不完整、过时或属于已废弃中间方案的规则。**禁止跳过此步骤**。

### 第二步：检查模板与已有 spec

```bash
# 是否有可参考的模板（frontend / backend / api / conventions / architecture 等）
lattice spec template list

# 是否已有相关 spec，优先补充而非重复创建
lattice spec list --scope <层级>
lattice spec show <相关文件>      # 支持模糊匹配 / glob，如 "*migration*"
```

### 第三步：冲突检测（语义层面，不仅看同名）

写入前读取**同层级及上下层级**已有 spec 内容，判断新规则是否存在语义矛盾：

- `lattice spec conflicts` 只检测同名文件冲突
- 真正的冲突往往是语义层面的（如：项目级写"用 tabs"但用户级写"用 spaces"）

发现冲突时必须明确告知用户：冲突点 / 影响范围 / 建议处理方式（保留特例 / 合并规则 / 删除冗余）。

### 第四步：写入 spec

写入原则：

- **一个文件只聚焦一个主题**
- **写可执行规则，不写空泛口号**
- 优先记录"什么时候这样做、什么时候不要这样做"
- user / global 层级必须带 `## 适用范围`（见上文）

### 第五步：写入后二次审阅（强制）

对照 PRD、progress 和当前对话上下文检查：

- 是否遗漏 PRD 或 progress 中已确认的关键规则
- 写入内容是否与当前对话最终结论一致（**没有写成中间过程的废弃方案**）
- 是否有相关规则应一并沉淀但被忽略
- 发现遗漏 → 立即补充到同一 spec 或新建关联 spec

### 第六步：索引更新

```bash
lattice rag update
```

详见 [SKILL.md#索引维护](SKILL.md#索引维护)。

## 模板相关命令

```bash
lattice spec template list
lattice spec template apply <name>
lattice spec template pull <repo>
lattice spec template sync
lattice spec template registry list
```

模板不必完全照搬，但应保持文件组织和内容结构的一致性。
