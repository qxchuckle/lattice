# Spec 工作流

spec 概念/层级/精读/沉淀/写入。其他文档引用本文不复述。

## spec 定义

记录对理解项目、完成任务有益的可复用信息。核心判定：**下次进入这个项目还需要吗？**

内容：行为约束 · 项目认知（架构/模块/领域） · 流程范式 · 经验细节 · 试错积累

spec 非永远正确——与代码矛盾时交叉验证，必要时问用户。

## 层级

`项目级 > [父项目 > 祖先 >] 用户级 > 全局级`

| 层级 | 路径 | 适用 |
|---|---|---|
| 项目级 | `~/.lattice/users/<u>/projects/<id>/spec/` | 当前项目 |
| 用户级 | `~/.lattice/users/<u>/spec/` | 跨项目 |
| 全局级 | `~/.lattice/spec/` | 多用户多项目 |

冲突：近覆盖远；同名冲突告知用户。user/global 必含 `## 适用范围`。

## 按任务主题精读相关 spec

> 必须委派 `lattice-spec-digest` subagent（不支持时退化串行）。

**动态持续，非一次性**。起手读一批，推进中涉及新模块/概念时补读。宁多勿少。

**选**：`ltc context` 标题+描述选读（不确定 → 读）+ `ltc search "<关键词>" --json` 语义补漏

**读**：`read_file` 全文（禁止部分读取）→ 验证时效 → 提炼约束

**关联**：`ltc task ref-spec <task-id> <spec-name>`

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
