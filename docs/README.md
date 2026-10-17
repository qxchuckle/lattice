# Lattice 文档索引

> 主入口见根目录 [README.md](../README.md)（[中文](../README.zh-CN.md)）。

## 阅读顺序

| 文档 | 内容 | 适合 |
|---|---|---|
| [quick-start.md](./quick-start.md) | 安装、初始化、扫描项目、第一个任务与规范 | 首次上手 |
| [architecture.md](./architecture.md) | 分层架构（core → services → 宿主 → 客户端）、多端演进（M1–M6 / P1–P3）、契约测试 | 想理解内部设计 |
| [directory-and-config.md](./directory-and-config.md) | `~/.lattice` 目录结构、配置文件、层级约定 | 排查数据/配置 |
| [spec-template-registry.md](./spec-template-registry.md) | Spec 模板仓库结构（内置 / 远程模板） | 编写自定义模板 |

## 子包文档

- [@qcqx/lattice-core](../packages/core/README.md) — 领域核心
- [@qcqx/lattice-protocol](../packages/protocol/README.md) — 跨端契约（types-only）
- [@qcqx/lattice-services](../packages/services/README.md) — 多宿主共享用例层
- [@qcqx/lattice-cli](../packages/cli/README.md) — 命令行
- [@qcqx/lattice-web](../packages/web/README.md) — Web 服务端
- [@qcqx/lattice-web-ui](../packages/web-ui/README.md) — 共享 React UI
- [VS Code 扩展](../packages/vscode/README.md) — 侧栏视图 / 图谱 / 诊断

## AI / Agent 工作流

面向 AI 客户端（Cursor / Claude Code / Qoder / Trae 等）的注入模板：

- [技能总览](../packages/core/public/templates/skills/SKILL.md)
- [常驻规则](../packages/core/public/templates/platforms/lattice-rules.md)
- [命令速查](../packages/core/public/templates/skills/command-reference.md)
- [任务工作流](../packages/core/public/templates/skills/task-workflows.md) · [Spec 工作流](../packages/core/public/templates/skills/spec-workflows.md)

## 参与贡献

- [CONTRIBUTING.md](../CONTRIBUTING.md) — 开发环境、命令、分层约定、提交规范
- [SECURITY.md](../SECURITY.md) — 漏洞上报
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) — 行为准则
