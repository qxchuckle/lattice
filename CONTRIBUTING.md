# Contributing to Lattice

Thanks for your interest in improving Lattice! This document covers everything you need to set up the monorepo, run the verification suites, and get a change merged.

## Development environment

- **Node.js** ≥ 18, **pnpm** ≥ 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
- Optional: VS Code ≥ 1.85 (for extension development)

```bash
git clone https://github.com/qxchuckle/lattice.git
cd lattice
pnpm install
```

## Monorepo layout

| Package | Role |
|---|---|
| `packages/core` | Domain core: storage, spec cascade, RAG, sync |
| `packages/protocol` | Cross-host contracts (types-only) |
| `packages/services` | Use-case layer shared by CLI / web / extension |
| `packages/cli` | Command line (`lattice` / `ltc`) |
| `packages/web` | Web server (HTTP API + static assets) |
| `packages/web-ui` | Shared React UI (web client & extension webview) |
| `packages/vscode` | VS Code extension |

See [docs/architecture.md](./docs/architecture.md) for the layered design and [docs/directory-and-config.md](./docs/directory-and-config.md) for the data root layout.

## Common commands

```bash
pnpm build                 # build all packages
pnpm lint                  # ESLint + Prettier checks (repo root)
pnpm check-types           # tsc --noEmit per package
pnpm --filter lattice test # extension unit tests (node --test)

# VS Code extension end-to-end
pnpm verify:vscode             # lint → check-types → unit → build → VSIX
pnpm --filter lattice run test:integration   # @vscode/test-cli, in-process core fixture
pnpm package:vscode            # → packages/vscode/dist-vsix/lattice-<version>.vsix
```

Press <kbd>F5</kbd> inside `packages/vscode` to launch an Extension Development Host.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, …) — enforced by commitlint via Husky. Use `release: vX.Y.Z` only for release commits.
- **Formatting** is Prettier; **linting** is ESLint. Run `pnpm lint` before pushing.
- **User-visible strings** must go through the l10n helpers (`t()` in the extension, l10n bundles under `packages/vscode/l10n/`). The UI ships in English + Simplified Chinese.
- **Layer discipline**: hosts (CLI / web / extension) call `@qcqx/lattice-services`; domain logic belongs in `@qcqx/lattice-core`. The VS Code extension must not shell out to the CLI for data access — it runs the core in-process.
- **Tests**: bug fixes and features should come with a unit or integration test where practical.

## Pull requests

1. Fork the repo and create a topic branch.
2. Keep the change focused; update docs/READMEs when behavior or surfaces change.
3. Make sure `pnpm lint`, `pnpm check-types` and the relevant tests pass.
4. Describe the motivation and the verification you ran in the PR description (the template will guide you).

Small typo fixes and doc improvements are fine without opening an issue first; for larger changes please open an issue to discuss the design upfront.

## Releasing (maintainers)

No CI — releases run locally from a clean, verified worktree.

- **VS Code extension**
  1. Copy `.env.release.example` → `.env.release` and fill in `OVSX_PAT` (Open VSX) and `VSCE_PAT` (Azure DevOps PAT, scopes ≥ *Marketplace: Manage*). The file is **git-ignored** — never commit it (env vars override the file).
  2. `pnpm --filter lattice run release` — CHANGELOG consistency check → build → VSIX → sha256.
  3. `pnpm --filter lattice run release:publish` — the above **plus publishing to both marketplaces** (channels without credentials are skipped with a warning; tokens are masked in logs).
- **npm packages** — credentials live in npm's own `~/.npmrc` (`npm login` or a granular access token with read+write on `@qcqx`). Publish changed packages from their directory: `pnpm publish --no-git-checks` (`prepublishOnly` rebuilds `dist`).

## Reporting issues

Use the [issue templates](https://github.com/qxchuckle/lattice/issues/new/choose). For the VS Code extension the most useful attachment is `Lattice: Copy Diagnostics` output plus the extension version and editor build.

---

# 参与贡献（中文）

感谢你愿意改进 Lattice！上面同样适用，中文速览：

- 环境：Node ≥ 18、pnpm ≥ 9；`pnpm install` 后即可开发。
- 提交规范：Conventional Commits（commitlint 强制）；提交前跑 `pnpm lint` 与相关测试。
- 分层约定：宿主（CLI / Web / 扩展）只调用 `@qcqx/lattice-services`；领域逻辑放 `@qcqx/lattice-core`；扩展数据面必须进程内直连 core，不得起 CLI 子进程。
- 文案：面向用户的文案必须走 l10n（扩展内 `t()` + `packages/vscode/l10n/`），中英双语。
- PR：小改动直接提；大改动先开 Issue 讨论设计。描述里写清动机与验证方式。
