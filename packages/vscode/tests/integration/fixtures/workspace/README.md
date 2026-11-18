# Integration fixture workspace

This folder is used by `@vscode/test-cli` as the workspace for extension integration tests.
Its `lattice.json` anchor activates the extension. The test runner uses an isolated
Lattice data home through `LATTICE_HOME`.
