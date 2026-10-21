# Lattice Documentation

> English | [简体中文](./README.zh-CN.md)

Lattice is a local-first engineering memory and workflow layer. Start with the root [README.md](../README.md) ([简体中文](../README.zh-CN.md)).

## Reading order

| Document | Contents | Audience |
|---|---|---|
| [quick-start.md](./quick-start.md) | Install, initialize, scan projects, first task and spec | First-time users |
| [concepts.md](./concepts.md) | Specs, tasks, checkpoints, project relations, search and sync | Readers building a mental model |
| [web-workbench.md](./web-workbench.md) | The four views, canvas filters, detail panels, search and the public demo | Web workbench users |
| [architecture.md](./architecture.md) | Layered architecture (core → services → hosts → clients), multi-client evolution (M1–M6 / P1–P3), contract tests | Readers who want the internal design |
| [directory-and-config.md](./directory-and-config.md) | `~/.lattice` layout, config files, scope conventions | Data/config troubleshooting |
| [spec-template-registry.md](./spec-template-registry.md) | Spec template repository layout (built-in / remote templates) | Template authors |

## Package docs

Package READMEs use English as the default entry with Simplified Chinese translations.

- [@qcqx/lattice-core](../packages/core/README.md) — domain core
- [@qcqx/lattice-protocol](../packages/protocol/README.md) — cross-host contracts, types-only
- [@qcqx/lattice-services](../packages/services/README.md) — use-case layer shared by hosts
- [@qcqx/lattice-cli](../packages/cli/README.md) — command line
- [@qcqx/lattice-web](../packages/web/README.md) — web server
- [@qcqx/lattice-web-ui](../packages/web-ui/README.md) — shared React UI
- [VS Code extension](../packages/vscode/README.md) — sidebar views, graph, diagnostics

## AI / Agent workflows

Templates injected into AI clients (Cursor / Claude Code / Qoder / Trae and others):

- [Skills overview](../packages/core/public/templates/skills/en/SKILL.md)
- [Always-on rules](../packages/core/public/templates/platforms/en/lattice-rules.md)
- [Command reference](../packages/core/public/templates/skills/en/command-reference.md)
- [Task workflows](../packages/core/public/templates/skills/en/task-workflows.md) · [Spec workflows](../packages/core/public/templates/skills/en/spec-workflows.md)

## Contributing

- [CONTRIBUTING.md](../CONTRIBUTING.md) — development environment, commands, layer conventions, commit rules
- [SECURITY.md](../SECURITY.md) — vulnerability reporting
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) — code of conduct
