# @qcqx/lattice-protocol

**Lattice 跨端契约** —— 宿主 ⇄ 客户端共用的 DTO 与消息类型。**types-only**：零运行时代码，纯 TypeScript 类型。

被以下消费方共用：

- web 客户端（`@qcqx/lattice-web` 前端）与 VS Code webview（`@qcqx/lattice-web-ui` 消费方）
- 宿主桥层（web HTTP 绑定 / VS Code postMessage 桥）

## 内容

| 类别 | 代表导出 |
|---|---|
| 桥协议 | `BridgeRequest` / `BridgeResponse` / `BridgeAction` / `BridgeEvent`、`WebviewToExtension` / `ExtensionToWebview` |
| 方法与动作白名单 | `BridgeRequestMethod`、`BridgeActionName` |
| 快照 DTO | `SnapshotSpec`、`GraphSnapshot`、`TaskDetailPayload`、`ProjectDetailPayload`、`SpecDetailPayload` |
| 参数/状态 DTO | `ContentParams`、`SearchBridgeParams`、`GlobalStatusPayload`、`StatsPayload`、`SpecScopeWire` |

## 使用

```bash
pnpm add @qcqx/lattice-protocol
```

```ts
import type { BridgeRequestMethod, SnapshotSpec } from '@qcqx/lattice-protocol';
```

> 本包 `main` / `types` 直指 `src/index.ts`（无构建产物），由消费方的 bundler / tsc 一并编译——仅适用于 TypeScript 工程。

## 约束

- 只放**类型与常量联合**；不放运行时代码、不放宿主实现。
- 契约变更属跨端变更：请同步检查 web 客户端、webview 桥与契约测试（`pnpm test:contract`）。

## License

[MIT](./LICENSE) © 2026 qcqx
