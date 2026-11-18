# Contributing to Lattice

Thanks for your interest in improving Lattice! This document covers everything you need to set up the monorepo, run the verification suites, and get a change merged.

## Development environment

- **Node.js** 24 (matches CLI distribution and website tooling), **pnpm** ≥ 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
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

## Installation documentation

Installation channels have one catalog: `scripts/installation-channels.json`. Change availability and runtime requirements only after verifying the public npm release, standalone assets and owned Homebrew tap. Unreleased channels stay marked as coming soon. The Pages deployment verifies the published npm version and any enabled standalone assets. If Homebrew is enabled, it also checks the tap’s `Formula/lattice.rb` against the same release. Run `pnpm sync:install` to regenerate the controlled README/quick-start blocks, then `pnpm check:install`, `pnpm check:docs-i18n`, `pnpm sync:docs` and `pnpm check:docs`. The site renders the same catalog as tabs; GitHub Markdown keeps native expandable sections. Never edit generated blocks or duplicate installation commands in landing components.

## Pull requests

1. Fork the repo and create a topic branch.
2. Keep the change focused; update docs/READMEs when behavior or surfaces change.
3. Make sure `pnpm lint`, `pnpm check-types` and the relevant tests pass.
4. Describe the motivation and the verification you ran in the PR description (the template will guide you).

Small typo fixes and doc improvements are fine without opening an issue first; for larger changes please open an issue to discuss the design upfront.

## Releasing (maintainers)

CLI npm publishing and standalone artifacts are built by CI from the pushed tag. Core npm publishing remains local. Web ships as part of the CLI platform package.

- **npm packages** — `pnpm release patch` (or `minor` / `major` / an exact `x.y.z`; add `--core` or `--cli` to limit the targets). It bumps `@qcqx/lattice-{core,cli}`, appends the new version section to `CHANGELOG.md` (moving curated `[Unreleased]` entries, or generating them from commits since the last tag), builds, publishes core locally (CLI publication is deferred to tag CI), commits `release: vX.Y.Z`, tags and pushes. It refuses to start unless the current `HEAD` has a green `ci.yml` run (so a broken CI never publishes to npm), and it runs `node --test scripts/__tests__/` first. Flags: `--dry-run`, `--no-push` (prepare a local release commit and tag without npm publishing or Git push), `--allow-red-ci` (skip that CI check), and `continue` (resume with the original targets; a failed npm publish is skipped only if npm confirms the exact version). Credentials live in npm's own `~/.npmrc` (`npm login` or a granular access token with read+write on `@qcqx`).
- **GitHub Release** — `.github/workflows/release.yml` runs on every `v*` tag push. It refuses to publish unless the tagged commit is on `master` **and** its CI run is green (it polls `ci.yml` for that SHA and fails on red/cancelled), then checks the tag against the package versions (a partial `--core` or `--cli` release is allowed but reported as a warning; a tag that matches none of them fails), builds the VSIX **from that tag** with `pnpm --dir packages/vscode run package`, renders the notes from the CHANGELOG section (`scripts/release-notes.mjs`) and creates or updates the Release with the VSIX attached. Nothing to run locally and no extra secrets — it uses the built-in `GITHUB_TOKEN`. Re-running the failed publish job reuses its verified artifacts and is idempotent (notes and assets are replaced). A complete rebuild may change native binary bytes; strict integrity checks intentionally reject replacing an already published version with different bytes, so retry the failed job rather than rebuilding an existing npm version. `pnpm check:release` runs the unit tests for these scripts.
- **CLI platform releases** — `scripts/cli-distribution/config.cjs` is the only target/runtime catalog. The reusable `cli-platform.yml` installs/builds under that fixed Node, materializes production dependencies, verifies file integrity, FTS5/sqlite-vec and the Transformers Node entry (ORT/sharp) without loading a model, verifies relocation and the init/project/task/spec/search/doctor lifecycle, and installs the real tarballs with modern npm and npm6 on supported caller platforms. `release.yml` waits for its existing master/green-CI guards, checks the complete same-commit/version catalog, then publishes all platform packages before the thin root package. The workspace CLI refuses direct publishing. npm trusted publishing requires configuring this repository's `release.yml` publisher for the root and each platform package; use the optional `NPM_TOKEN` secret for first publication where required. The workflow uses npm bundled with the fixed Node (OIDC requires npm >=11.5.1). No installation credentials go into payloads.
- **Distribution development** — after `pnpm build:cli`, run `pnpm cli:distribution:build --node <official-fixed-node> --node-license <LICENSE>` under that platform with matching native bindings. `--sqlite-binding <addon>` can supply an independently compiled matching SQLite binding for local validation. `pnpm cli:distribution:smoke --node <source-install-node> --caller-node <caller-node> --npm <npm-cli.js> --model-path <read-only-local-model-root>` tests the complete archive; omit model-path for hard-offline synthetic fixtures. Model probes terminate from their parent after receiving vectors to avoid the existing ORT macOS teardown issue; they do not test CLI model teardown. `pnpm cli:distribution:benchmark --runs 20` records warm-cache startup/search/unchanged-update p50/p95, per-process peak RSS and a CPU profile. `pnpm cli:distribution:assemble` requires all targets; `--allow-partial` is only for local installer tests. `--development-runtime` or dirty-worktree artifacts cannot publish. Local installer fixtures also need `--allow-development` when assembling these artifacts. CLI releases stay draft until the complete asset set is attached; non-CLI partial releases do not replace the latest CLI release. `pnpm check:release` injects manifest/catalog/hash/installer failures; run it whenever distribution or release code changes.
- **Standalone / Homebrew** — release assets include platform tarballs, `SHA256SUMS`, `release-manifest.json`, `release-version.txt`, `install.sh` and a generated `lattice.rb` for a Lattice-owned tap. The shell installer consumes the same hashes without downloading npm or compiling dependencies; it checks native dependency readiness before activation, serializes installations sharing an app or command directory, recovers locks owned by stopped local processes, and repairs corrupt same-version payloads into a new immutable directory. SHA256SUMS lists the attached standalone assets (including the tap recipe); npm tarball hashes remain in release-manifest.json. Maintain/publish the owned tap separately; this binary formula is not a homebrew/core submission. Runtime security updates require rebuilding and releasing all platform artifacts. Model weights remain outside the application payload.
- **VS Code extension markets** (versioned separately)
  1. Copy `.env.release.example` → `.env.release` and fill in `OVSX_PAT` (Open VSX) and `VSCE_PAT` (Azure DevOps PAT, scopes ≥ *Marketplace: Manage*). The file is **git-ignored** — never commit it (env vars override the file).
  2. `pnpm --filter lattice-context run release` — CHANGELOG consistency check → build → VSIX → sha256.
  3. `pnpm --filter lattice-context run release:publish` — the above **plus publishing to both marketplaces** (channels without credentials are skipped with a warning; tokens are masked in logs).

## Reporting issues

Use the [issue templates](https://github.com/qxchuckle/lattice/issues/new/choose). For the VS Code extension the most useful attachment is `Lattice: Copy Diagnostics` output plus the extension version and editor build.

---

# 参与贡献（中文）

感谢你愿意改进 Lattice！上面同样适用，中文速览：

- 环境：Node 24（与 CLI 分发及站点工具链一致）、pnpm ≥ 9；`pnpm install` 后即可开发。
- 提交规范：Conventional Commits（commitlint 强制）；提交前跑 `pnpm lint` 与相关测试。
- 分层约定：宿主（CLI / Web / 扩展）只调用 `@qcqx/lattice-services`；领域逻辑放 `@qcqx/lattice-core`；扩展数据面必须进程内直连 core，不得起 CLI 子进程。
- 文案：面向用户的文案必须走 l10n（扩展内 `t()` + `packages/vscode/l10n/`），中英双语。
- 文档：公开文档英文为默认入口（`docs/foo.md`），中文为 `docs/foo.zh-CN.md`；两边同轮更新，新增文档对登记到 `i18n-manifest.json`，并跑 `pnpm check:docs-i18n`。官网直接渲染仓库文档、不维护第二套：新增页面须在 `apps/site/scripts/docs-nav.mjs` 登记，改完 `docs/` 后跑 `pnpm sync:docs` 与 `pnpm check:docs`；`apps/site/src/content/docs/{,zh-cn/}docs/` 是生成物（已 gitignore），不要手改。`pnpm dev:site` 会基于同一份文档生成开发用 Pagefind 索引，本地不构建生产包也能搜索；生产环境仍使用 Starlight 的 HTML 索引。
- 安装渠道真源：`scripts/installation-channels.json`。核实公开 npm、独立归档、自有 Homebrew tap 已发布后才启用对应渠道和运行时说明，未发布保持“即将提供”。修改后跑 `pnpm sync:install`、`pnpm check:install`、`pnpm check:docs-i18n`、`pnpm sync:docs` 和 `pnpm check:docs`；官网使用同一配置渲染 Tab，GitHub Markdown 使用原生折叠区，不要手改生成块或在 landing 组件里复制安装命令。
- PR：小改动直接提；大改动先开 Issue 讨论设计。描述里写清动机与验证方式。
- 发布：`pnpm release patch|minor|x.y.z` 负责 bump → 写 `CHANGELOG.md` → 构建 → 本地发布 core → tag → 推送；`--no-push` 只准备本地提交和 tag，继续发布用相同目标的 `pnpm release continue`。CLI 由 tag CI 使用固定 Node 构建包含 Web 的平台成品，完整验证后先发平台包、再发薄入口。不要直接发布 workspace CLI。首次发布需配置各 npm 包的 trusted publisher，或准备 `NPM_TOKEN`；不在产物里分发凭据。独立归档、SHA-256 清单、shell 安装器和自有 tap 配方由同一目录生成，tap 仍需单独发布。改分发脚本后跑 `pnpm check:release` 注入自测，性能数据用 `pnpm cli:distribution:benchmark`，没有实测热点证据不引入 Rust。推 tag 后 `.github/workflows/release.yml` 先确认该提交在 master 上且 CI 绿色，再从同一个 tag 构建 VSIX 并建 GitHub Release（正文取 `CHANGELOG.md` 对应版本段）。扩展市场仍走本地 `pnpm --filter lattice-context run release:publish`，版本与 `packages/vscode/CHANGELOG.md` 独立维护。
