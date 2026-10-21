# @qcqx/lattice-protocol

> English | [简体中文](./README.zh-CN.md)

**Lattice cross-host contract** — DTOs and message types shared by hosts ⇄ clients. **Types-only**: zero runtime code, pure TypeScript types.

Shared by:

- the web client (`@qcqx/lattice-web` frontend) and the VS Code webview (`@qcqx/lattice-web-ui` consumer)
- host bridge layers (web HTTP binding / VS Code postMessage bridge)

## Contents

| Category | Representative exports |
|---|---|
| Bridge protocol | `BridgeRequest` / `BridgeResponse` / `BridgeAction` / `BridgeEvent`, `WebviewToExtension` / `ExtensionToWebview` |
| Method and action allowlists | `BridgeRequestMethod`, `BridgeActionName` |
| Snapshot DTOs | `SnapshotSpec`, `GraphSnapshot`, `TaskDetailPayload`, `ProjectDetailPayload`, `SpecDetailPayload` |
| Parameter/state DTOs | `ContentParams`, `SearchBridgeParams`, `GlobalStatusPayload`, `StatsPayload`, `SpecScopeWire` |

## Usage

```bash
pnpm add @qcqx/lattice-protocol
```

```ts
import type { BridgeRequestMethod, SnapshotSpec } from '@qcqx/lattice-protocol';
```

> This package's `main` / `types` point directly at `src/index.ts` (no build output); the consumer's bundler / tsc compiles it — intended for TypeScript projects only.

## Constraints

- Only **types and constant unions**; no runtime code, no host implementations.
- Contract changes are cross-host changes: also check the web client, webview bridge and contract tests (`pnpm test:contract`).

## License

[MIT](https://github.com/qxchuckle/lattice/blob/master/LICENSE) © 2026 qcqx
