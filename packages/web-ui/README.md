# @qcqx/lattice-web-ui

> English | [简体中文](./README.zh-CN.md)

**Lattice shared React UI** — components and hooks shared by the web client and the VS Code webview. The same interface renders in the browser and in the editor; the host injects the data source through an **adapter seam**.

## Contents

| Category | Representative exports |
|---|---|
| App shell | `AppShell` (navigation + main content + detail panel), `ErrorBoundary`, `FloatingStatusBar` |
| Graph | `CytoscapeGraph`, `useGlobalGraph` |
| Panels / sidebar | `DetailPanel`, `TreeBrowserSidebar`, `GlobalSearchPanel` |
| Theme / interaction | `getAntdThemeConfig`, `themeStore`, `useKeyboard`, `useIsMobile` |
| Data seam | `setAdapter` / `getAdapter`, `isWebviewHost` |

## Install

```bash
pnpm add @qcqx/lattice-web-ui
```

Depends on React 19, antd 6, Cytoscape and others (declared with the package); `exports` points directly at source (`./src/ui.ts`), compiled by the consumer's bundler.

## Usage

```tsx
import { AppShell, setAdapter, getAntdThemeConfig } from '@qcqx/lattice-web-ui';

setAdapter(myHostAdapter); // the host provides the data plane (HTTP / postMessage / in-memory)

export function App() {
  return <AppShell features={{ login: false, admin: false, terminal: false }} />;
}
```

`AppShell` includes routing (`/task/:id`, `/project/:id`, `/spec/:id`…). Hosts can route navigation commands into the app through events (the VS Code webview bridge does exactly this).

## Consumers

- [`@qcqx/lattice-web`](https://github.com/qxchuckle/lattice/tree/master/packages/web): browser client
- [`packages/vscode`](https://github.com/qxchuckle/lattice/tree/master/packages/vscode): extension webview (graph workbench) — data comes through the postMessage bridge

## License

[MIT](https://github.com/qxchuckle/lattice/blob/master/LICENSE) © 2026 qcqx
