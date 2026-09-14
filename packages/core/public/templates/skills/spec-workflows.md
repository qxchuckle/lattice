# Spec 工作流

spec 概念/层级/全文读取/沉淀/写入。其他文档引用本文不复述。

## spec 定义

记录对理解项目、完成任务有益的可复用信息。核心判定：**下次进入这个项目还需要吗？**

内容：行为约束 · 项目认知（架构/模块/领域） · 流程范式 · 经验细节 · 试错积累

spec 非永远正确——与代码矛盾时交叉验证，必要时问用户。

**判定"spec 陈旧 / 与代码不符"前必须先核实工作树能代表该内容**：`git branch --show-current` + `git status --short` + 该内容是否来自未合入分支、未提交改动或并行任务。工作树里没有 ≠ spec 有误——多任务共用一个仓库时，spec 常描述另一分支正在落地的实现；据此改 spec = 删掉别人正在写的约定。违规识别：本轮无分支 / 合入状态核实记录却要下"spec 过时"结论 → 结论不成立，先核实或问用户。

## 层级

`项目级 > [父项目 > 祖先 >] 用户级 > 全局级`

| 层级 | 路径 | 适用 |
|---|---|---|
| 项目级 | `~/.lattice/users/<u>/projects/<id>/spec/` | 当前项目 |
| 用户级 | `~/.lattice/users/<u>/spec/` | 跨项目 |
| 全局级 | `~/.lattice/spec/` | 多用户多项目 |

冲突：近覆盖远；同名冲突告知用户。关联同步域时：同层级同路径冲突以本地数据源、当前用户为准（本地 > 域，域间按 `sync.domains` 数组序）；域 spec 只读，`spec show <name> --source <hash8>` 可直读被遮蔽的域版本。user/global 必含 `## 适用范围`。

## 按任务主题全文读取相关 spec

**必须委派 `lattice-spec-digest` subagent（不支持时退化串行）。**

**动态持续，非一次性**。起手读一批，推进中涉及新模块/概念时补读。宁多勿少。

**选**：`ltc context` 标题+描述+路径选读（不确定 → 读）+ `ltc search "<关键词>" --json` 语义补漏（结果带路径）

**读**：`read_file` 所选 spec 的路径全文（context / search 输出已含路径，禁止部分读取）→ 验证时效 → 提炼约束

**关联**：`ltc task ref-spec <task-id> <spec-id>`

## 沉淀判定

| 档位 | 条件 |
|---|---|
| **必须写** | 用户显式指示行为规则 / 用户主动给出项目认知 |
| **建议写** | 核心判定通过（下次还需要） |
| **不写** | 一次性需求 / 未验证猜测 / 纯任务级细节 |

### 基于 checkpoint 类型

| 类型 | 条件 | 层级 |
|---|---|---|
| `correction` | 长期行为规范（含试错）→ 强制 | 项目/用户级 |
| `constraint` | ≥2 任务复现 → 强制；首次按建议 | 项目→复现升用户 |
| `context` | 业务/架构背景 → 认知类 | 项目级 |
| `assumption` | 被确认且通用 → 上升为规则 | 视内容 |

`issue` + 解决方案 = 试错类 spec。符合 → 主动询问用户。

## 写入流程

1. 前置：`ltc context` + `ltc spec list --scope <层级>` + 回顾对话
2. 查已有：`ltc spec show <相关>`，优先补充非重复创建
3. 冲突检测：同层及上下层矛盾 → 告知用户
4. 写入：一文件一主题 · 具体可执行 · user/global 带适用范围 · **敏感信息 → `~/.lattice/.cache/sensitive/`**
5. 元数据：编辑正文后 `ltc spec migrate`；仅改 frontmatter 用 `ltc spec set`
6. 二次审阅 + `ltc rag update`

## 模板命令

```bash
ltc spec template list / apply <name> / pull <repo> / sync / registry list
```
