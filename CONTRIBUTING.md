# Contributing to Lattice

Thanks for your interest in improving Lattice! This document covers everything you need to set up the monorepo, run the verification suites, and get a change merged.

## Development environment

Use Node.js 24 and pnpm 10.30.3. An activated mise shell selects the repository toolchain when you enter the directory. Run `mise install` on first setup.

```bash
git clone https://github.com/qxchuckle/lattice.git
cd lattice
mise install
pnpm install
```

With nvm, run `nvm install` on first setup and `nvm use` when entering the repository. Install pnpm for that Node version with `npm install -g pnpm@10.30.3`. VS Code ≥ 1.85 is optional for extension development.

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
pnpm verify:vscode             # lint → check-types → unit → package VSIX
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

`scripts/installation-channels.json` lists the available channels. Edit commands and prompts in `scripts/install-content.mjs`. Run `pnpm sync:install` after changing the catalog or installation content, and commit the regenerated blocks in `docs/quick-start*.md`. Use `pnpm check:install` to verify those blocks. The website renders its tabs from the same content and generates its own pages with `pnpm sync:docs`.

## Pull requests

1. Fork the repo and create a topic branch.
2. Keep the change focused; update docs/READMEs when behavior or surfaces change.
3. Make sure `pnpm lint`, `pnpm check-types` and the relevant tests pass.
4. Describe the motivation and the verification you ran in the PR description (the template will guide you).

Small typo fixes and doc improvements are fine without opening an issue first; for larger changes please open an issue to discuss the design upfront.

## Releasing (maintainers)

Master CI builds and tests the CLI archives for the release commit. The tag workflow publishes those same archives. Core npm publishing remains local. Web ships as part of the CLI platform package.

- **npm packages** — `pnpm release patch` (or `minor` / `major` / an exact `x.y.z`; add `--core` or `--cli` to limit the targets). It bumps `@qcqx/lattice-{core,cli}`, appends the new version section to `CHANGELOG.md` (moving curated `[Unreleased]` entries, or generating them from commits since the last tag), builds and publishes core locally when selected (CLI builds and publication run in CI), commits `release: vX.Y.Z`, tags and pushes. It refuses to start unless the current `HEAD` has a green `ci.yml` run (so a broken CI never publishes to npm), and it runs `node --test scripts/__tests__/` first. Flags: `--dry-run`, `--no-push` (prepare a local release commit and tag without npm publishing or Git push), `--allow-red-ci` (skip that CI check), and `continue` (resume with the original targets; a failed npm publish is skipped only if npm confirms the exact version). Credentials live in npm's own `~/.npmrc` (`npm login` or a granular access token with read+write on `@qcqx`).
- **GitHub Release** — `release.yml` requires a tag on `master` and a successful `ci.yml` push run for that exact commit. It downloads the tested VSIX from that run and renders notes from `CHANGELOG.md`. A core-only release leaves the latest CLI release in place. On failure, rerun failed Release jobs. To resume a failed publication with a draft in place, dispatch Release from `master` with the same tag and failed Release run ID.
- **CLI platform releases** — `scripts/cli-distribution/config.cjs` defines the runtime and platforms. Ordinary application edits run an exhaustive smoke on Linux x64. Site-only changes skip the CLI matrix. Packaging, lockfile, workflow, and version changes run all five platforms. The modern npm smoke exercises installation, relocation, Web, search and incremental RAG. Older Node and npm 6 check real installation and private runtime handoff. Master CI retains the tested artifacts for 14 days.
- **Artifact reuse and npm order** — The Release workflow verifies the complete platform catalog, tag version, commit SHA and archive hashes from master CI. It uploads platform packages in small batches, waits until every tarball is downloadable, then publishes the thin CLI package. Reuse the same artifacts for retries. npm versions are immutable, so if the original artifacts expire after partial publication, release a new version. Keep npm trusted publishing configured for this repository's `release.yml`; `NPM_TOKEN` is optional where trusted publishing is already configured.
- **First platform publication** — create a short-lived granular npm token with read and write access to the `@qcqx` package scope and Bypass 2FA. Save it as the repository Actions secret `NPM_TOKEN`. After first publication, register the trusted publisher separately on the root CLI and each platform package, verify OIDC publishing, then revoke the bootstrap token.
- **Standalone core SDK** — audit a clean npm consumer install of the packed SDK before publishing. Workspace dependency overrides apply to the materialized CLI payload. A consumer installing the SDK resolves the dependency ranges declared by the tarball and its upstream packages.
- **Distribution development** — after `pnpm build:cli`, run `pnpm cli:distribution:build --node <official-fixed-node> --node-license <LICENSE>` under that platform with matching native bindings. `--sqlite-binding <addon>` can supply an independently compiled matching SQLite binding for local validation. `pnpm cli:distribution:smoke --node <source-install-node> --caller-node <caller-node> --npm <npm-cli.js> --model-path <read-only-local-model-root>` tests the complete archive; omit model-path for hard-offline synthetic fixtures. Model probes terminate from their parent after receiving vectors to avoid the existing ORT macOS teardown issue; they do not test CLI model teardown. `pnpm cli:distribution:benchmark --runs 20` records warm-cache startup/search/unchanged-update p50/p95, per-process peak RSS and a CPU profile. `pnpm cli:distribution:assemble` requires all targets; `--allow-partial` is only for local installer tests. `--development-runtime` or dirty-worktree artifacts cannot publish. Local installer fixtures also need `--allow-development` when assembling these artifacts. CLI releases stay draft until the complete asset set is attached; non-CLI partial releases do not replace the latest CLI release. `pnpm check:release` injects manifest/catalog/hash/installer failures; run it whenever distribution or release code changes.
- **Standalone / Homebrew** — release assets include platform tarballs, `SHA256SUMS`, `release-manifest.json`, `release-version.txt`, `install.sh` and a generated `lattice.rb` for a Lattice-owned tap. The shell installer consumes the same hashes without downloading npm or compiling dependencies; it checks native dependency readiness before activation, serializes installations sharing an app or command directory, recovers locks owned by stopped local processes, and repairs corrupt same-version payloads into a new immutable directory. SHA256SUMS lists the attached standalone assets (including the tap recipe); npm tarball hashes remain in release-manifest.json. For automatic updates to `qxchuckle/homebrew-software`, add an Actions secret named `HOMEBREW_TAP_TOKEN` with Contents write access limited to that tap. The workflow checks the formula against the latest public CLI Release and its checksum. With no secret configured, copy the verified `lattice.rb` into the tap manually. Runtime security updates require rebuilding and releasing all platform artifacts. Model weights remain outside the application payload.
- **VS Code extension markets** (versioned separately)
  1. Copy `.env.release.example` → `.env.release` and fill in `OVSX_PAT` (Open VSX) and `VSCE_PAT` (Azure DevOps PAT, scopes ≥ *Marketplace: Manage*). The file is **git-ignored** — never commit it (env vars override the file).
  2. `pnpm --filter lattice-context run release` — CHANGELOG consistency check → build → VSIX → sha256.
  3. `pnpm --filter lattice-context run release:publish` — publish the same VSIX to both marketplaces. Supply both credentials before running it. A failure in either channel is reported independently.

## Reporting issues

Use the [issue templates](https://github.com/qxchuckle/lattice/issues/new/choose). For the VS Code extension the most useful attachment is `Lattice: Copy Diagnostics` output plus the extension version and editor build.

---

# 参与贡献（中文）

感谢你愿意改进 Lattice！上面同样适用，中文速览：

- 开发使用 Node 24 和 pnpm 10.30.3。已启用 mise 的终端会在进入仓库时切换工具版本，首次运行 `mise install`。使用 nvm 时，首次运行 `nvm install`，进入仓库后运行 `nvm use`，并为该 Node 版本安装 `pnpm@10.30.3`。准备好版本后运行 `pnpm install`。
- 提交规范：Conventional Commits（commitlint 强制）；提交前跑 `pnpm lint` 与相关测试。
- 分层约定：宿主（CLI / Web / 扩展）只调用 `@qcqx/lattice-services`；领域逻辑放 `@qcqx/lattice-core`；扩展数据面必须进程内直连 core，不得起 CLI 子进程。
- 文案：面向用户的文案必须走 l10n（扩展内 `t()` + `packages/vscode/l10n/`），中英双语。
- 文档：公开文档英文为默认入口（`docs/foo.md`），中文为 `docs/foo.zh-CN.md`；两边同轮更新，新增文档对登记到 `i18n-manifest.json`，并跑 `pnpm check:docs-i18n`。官网直接渲染仓库文档、不维护第二套：新增页面须在 `apps/site/scripts/docs-nav.mjs` 登记，改完 `docs/` 后跑 `pnpm sync:docs` 与 `pnpm check:docs`；`apps/site/src/content/docs/{,zh-cn/}docs/` 是生成物（已 gitignore），不要手改。`pnpm dev:site` 会基于同一份文档生成开发用 Pagefind 索引，本地不构建生产包也能搜索；生产环境仍使用 Starlight 的 HTML 索引。
- `scripts/installation-channels.json` 记录可用渠道，命令和提示词在 `scripts/install-content.mjs` 维护。改动后运行 `pnpm sync:install`，提交 `docs/quick-start*.md` 中重新生成的安装区块，并运行 `pnpm check:install` 校验。官网使用相同来源渲染标签，通过 `pnpm sync:docs` 生成站点页面。
- PR：小改动直接提；大改动先开 Issue 讨论设计。描述里写清动机与验证方式。
- 发布：`pnpm release patch|minor|x.y.z` 更新版本与 `CHANGELOG.md`，选中 core 时本地构建并发布 core，再创建并推送标签。`--no-push` 只准备本地版本提交和标签，之后以相同目标运行 `pnpm release continue`。CLI 发布从标签对应的成功 master CI 下载已测试的五平台产物和 VSIX，并核对提交、版本和归档哈希。先上传平台包并等待全部归档可下载，再发 CLI 入口包。发布失败优先重跑失败的 Release job，复用原始产物；master CI 产物保留 14 天。独立归档齐全后公开 GitHub Release。配置只对 `qxchuckle/homebrew-software` 有 Contents 写权限的 `HOMEBREW_TAP_TOKEN` 后可自动同步配方。扩展市场仍走 `pnpm --filter lattice-context run release:publish`，版本独立维护。
