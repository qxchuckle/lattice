# 项目上下文与搜索

本文件用于“进入项目先看什么”和“如何搜索类似经验”。

## 进入项目时的默认动作

如果当前目录属于已注册项目，优先运行：

```bash
lattice context
lattice status
```

需要明确的关键信息：

- 当前项目有哪些项目级 spec
- 是否存在用户级 / 全局级补充规则
- 当前项目是否有关联任务
- 是否存在 spec 冲突或历史上下文

## 用户提到相似需求时

先运行：

```bash
lattice search "<查询词>" --json
```

如果结果和任务相关，再补：

```bash
lattice task list --current
lattice context --task <id>
```

## 输出要求

- 不要直接转储整份上下文
- 优先提炼与当前请求最相关的规则、历史方案和风险
- AI / Agent 调用 `lattice search` 时优先带上 `--json`，先读取结构化结果再组织结论
- 如果当前目录不是 Lattice 项目，明确说明，并提示可先运行 `lattice link`

## 相关命令

```bash
lattice context
lattice context --task <id>
lattice status
lattice search <query> --json
lattice project list
lattice project info <id>
```
