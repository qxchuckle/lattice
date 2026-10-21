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
pnpm --filter lattice-context test # extension unit tests (node --test)

# VS Code extension end-to-end
pnpm verify:vscode             # lint → check-types → unit → build → VSIX
pnpm --filter lattice-context run test:integration   # @vscode/test-cli, in-process core fixture
pnpm package:vscode            # → packages/vscode/dist-vsix/lattice-context-<version>.vsix
```

Press <kbd>F5</kbd> inside `packages/vscode` to launch an Extension Development Host.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, …) — enforced by commitlint via Husky. Use `release: vX.Y.Z` only for release commits.
- **Formatting** is Prettier; **linting** is ESLint. Run `pnpm lint` before pushing.
- **User-visible strings** must go through the l10n helpers (`t()` in the extension, l10n bundles under `packages/vscode/l10n/`). The UI ships in English + Simplified Chinese.
- **Layer discipline**: hosts (CLI / web / extension) call `@qcqx/lattice-services`; domain logic belongs in `@qcqx/lattice-core`. The VS Code extension must not shell out to the CLI for data access — it runs the core in-process.
- **Tests**: bug fixes and features should come with a unit or integration test where practical.

## Documentation languages

Public docs use English as the default entry (`docs/foo.md`) and Simplified Chinese as `docs/foo.zh-CN.md`. When you change either side, update both and keep headings, internal links and command tokens aligned. Add new pairs to `i18n-manifest.json` and run `pnpm check:docs-i18n` (CI runs the same gate).

The website renders the repository docs — it does not keep a second copy. `apps/site/scripts/sync-docs.mjs` derives the site pages from `docs/*.md` at build time, and `apps/site/scripts/docs-nav.mjs` owns the sidebar order and labels. Never edit files under `apps/site/src/content/docs/docs/` or `apps/site/src/content/docs/zh-cn/docs/` (they are generated and git-ignored). After changing `docs/`, register any new page in `docs-nav.mjs`, then run `pnpm sync:docs` and `pnpm check:docs`. A `docs/*.md` file without a nav entry, a missing translation, a stale generated page or an orphan page fails the gate. `pnpm dev:site` generates a development Pagefind index from the same docs, so search works locally without a production build; production keeps using Starlight's HTML index.

## Pull requests

1. Fork the repo and create a topic branch.
2. Keep the change focused; update docs/READMEs when behavior or surfaces change.
3. Make sure `pnpm lint`, `pnpm check-types` and the relevant tests pass.
4. Describe the motivation and the verification you ran in the PR description (the template will guide you).

Small typo fixes and doc improvements are fine without opening an issue first; for larger changes please open an issue to discuss the design upfront.

## Releasing (maintainers)

No CI — releases run locally from a clean, verified worktree.

- **npm packages** — `pnpm release patch` (or `minor` / `major` / an exact `x.y.z`; add `--core`, `--cli`, `--web` to limit the targets). The script bumps `@qcqx/lattice-{core,cli,web}`, appends the new version section to `CHANGELOG.md` from the commits since the last tag, builds, publishes, commits `release: vX.Y.Z`, tags, pushes, then creates the GitHub Release from that CHANGELOG section. If `packages/vscode/dist-vsix/` holds a VSIX matching the current extension version it is uploaded as a release asset. Flags: `--dry-run`, `--no-push` (skip push and release), `--no-release`, and `continue` (retry a failed publish). Credentials live in npm's own `~/.npmrc` (`npm login` or a granular access token with read+write on `@qcqx`).
- **VS Code extension** (versioned separately)
  1. Copy `.env.release.example` → `.env.release` and fill in `OVSX_PAT` (Open VSX) and `VSCE_PAT` (Azure DevOps PAT, scopes ≥ *Marketplace: Manage*). The file is **git-ignored** — never commit it (env vars override the file).
  2. `pnpm --filter lattice-context run release` — CHANGELOG consistency check → build → VSIX → sha256.
  3. `pnpm --filter lattice-context run release:publish` — the above **plus publishing to both marketplaces** (channels without credentials are skipped with a warning; tokens are masked in logs).

Run step 2 **before** `pnpm release` if you want the fresh VSIX attached to the GitHub Release.

## Reporting issues

Use the [issue templates](https://github.com/qxchuckle/lattice/issues/new/choose). For the VS Code extension the most useful attachment is `Lattice: Copy Diagnostics` output plus the extension version and editor build.

---

# 参与贡献（中文）

感谢你愿意改进 Lattice！上面同样适用，中文速览：

- 环境：Node ≥ 18、pnpm ≥ 9；`pnpm install` 后即可开发。
- 提交规范：Conventional Commits（commitlint 强制）；提交前跑 `pnpm lint` 与相关测试。
- 分层约定：宿主（CLI / Web / 扩展）只调用 `@qcqx/lattice-services`；领域逻辑放 `@qcqx/lattice-core`；扩展数据面必须进程内直连 core，不得起 CLI 子进程。
- 文案：面向用户的文案必须走 l10n（扩展内 `t()` + `packages/vscode/l10n/`），中英双语。
- 文档：公开文档英文为默认入口（`docs/foo.md`），中文为 `docs/foo.zh-CN.md`；两边同轮更新，新增文档对登记到 `i18n-manifest.json`，并跑 `pnpm check:docs-i18n`。官网直接渲染仓库文档、不维护第二套：新增页面须在 `apps/site/scripts/docs-nav.mjs` 登记，改完 `docs/` 后跑 `pnpm sync:docs` 与 `pnpm check:docs`；`apps/site/src/content/docs/{,zh-cn/}docs/` 是生成物（已 gitignore），不要手改。`pnpm dev:site` 会基于同一份文档生成开发用 Pagefind 索引，本地不构建生产包也能搜索；生产环境仍使用 Starlight 的 HTML 索引。
- PR：小改动直接提；大改动先开 Issue 讨论设计。描述里写清动机与验证方式。
- 发布：npm 包用 `pnpm release patch|minor|x.y.z`（自动写 `CHANGELOG.md`、打 tag、推送、建 GitHub Release 并附上匹配版本的 VSIX）；VS Code 扩展单独走 `pnpm --filter lattice-context run release:publish`，扩展版本与 `packages/vscode/CHANGELOG.md` 独立维护。
