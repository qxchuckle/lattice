# Integration fixture workspace

This folder is used by `@vscode/test-cli` as the workspace for extension integration tests.
It contains a `lattice.json` anchor so the extension auto-activates, and a fake `ltc` CLI is
injected per test run via the `lattice.cliPath` / `lattice.latticeHome` settings.
