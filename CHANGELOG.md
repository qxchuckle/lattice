# Changelog

All notable changes to Lattice are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`@qcqx/lattice-cli`, `@qcqx/lattice-core` and `@qcqx/lattice-web` share one version and are released
together. The VS Code extension is versioned separately — see
[`packages/vscode/CHANGELOG.md`](packages/vscode/CHANGELOG.md).

Releases before `1.28.0` are recorded as git tags only (`git tag --list 'v*'`); they were not
backfilled here. New entries are appended by `pnpm release`, which also creates the matching GitHub
Release and attaches the VSIX when one was built.

## [Unreleased]

### Changed

- Published packages now declare `homepage` (https://lattice.qcqx.cn/), `repository` (with
  `directory`) and `bugs`, so npm package pages link back to the site and the repository.

## [1.29.0] - 2026-10-19

### Added

- **Project and task groups** — group registry and group tree in `core`, wired through `services`,
  the CLI, the web workbench, the VS Code extension and the Web UI.
- **VS Code extension** — live preview in view search, unified filtering, and fuller project/task
  actions; the extension is renamed to `lattice-context`.
- **Test infrastructure** — repository-wide vitest 4, plus CLI E2E coverage for the command matrix
  and the task lifecycle.

### Fixed

- `ltc init` skips the AI-tool prompt when it is not attached to a TTY.
- Invalid `ltc task` input now reports against the machine contract.

## [1.28.1] - 2026-10-18

### Added

- **Local release tooling** — a publishing script for the npm packages and a two-channel VSIX
  release script (`packages/vscode/scripts/release-vsix.mjs`): version/CHANGELOG consistency check →
  build → `vsce package` → sha256 → optional publish to Open VSX and VS Marketplace, skipping
  channels without credentials.

### Documentation

- Restructured the English and Chinese READMEs.

## [1.28.0] - 2026-10-16

### Added

- **Knowledge-base export** — `ltc task export` can emit a skill-style directory layout, so an
  exported task drops straight into a skill or knowledge base.
- **Richer task exports** — task exports now carry the design document and process records
  (checkpoints), not just the summary.
- **Glob patterns** — export accepts glob wildcards when selecting tasks.

### Fixed

- `ltc spec migrate` at project level now works across the whole project and asks for confirmation
  before writing.
