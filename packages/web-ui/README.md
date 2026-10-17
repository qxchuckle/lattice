# @qcqx/lattice-web-ui

**Lattice 共享 React UI** —— web 客户端与 VS Code webview 共用的组件与 hooks。同一套界面在浏览器和编辑器内渲染，数据来源由宿主通过 **adapter 接缝** 注入。

## 内容

| 类别 | 代表导出 |
|---|---|
| 应用外壳 | `AppShell`（导航 + 主内容 + 详情面板）、`ErrorBoundary`、`FloatingStatusBar` |
| 图谱 | `CytoscapeGraph`、`useGlobalGraph` |
| 面板 / 侧栏 | `DetailPanel`、`TreeBrowserSidebar`、`GlobalSearchPanel` |
| 主题 / 交互 | `getAntdThemeConfig`、`themeStore`、`useKeyboard`、`useIsMobile` |
| 数据接缝 | `setAdapter` / `getAdapter`、`isWebviewHost` |

## 安装

```bash
pnpm add @qcqx/lattice-web-ui
```

依赖 React 19、antd 6、Cytoscape 等（随包声明）；`exports` 直出源码（`./src/ui.ts`），由消费方 bundler 编译。

## 使用

```tsx
import { AppShell, setAdapter, getAntdThemeConfig } from '@qcqx/lattice-web-ui';

setAdapter(myHostAdapter); // 宿主提供数据面（HTTP / postMessage / 内存）

export function App() {
  return <AppShell features={{ login: false, admin: false, terminal: false }} />;
}
```

`AppShell` 内置路由（`/task/:id`、`/project/:id`、`/spec/:id`…），宿主可通过事件把导航指令路由进应用（VS Code webview 桥即如此）。

## 消费方

- [`@qcqx/lattice-web`](../web)：浏览器客户端
- [`packages/vscode`](../vscode)：扩展 webview（图谱工作台）——通过 postMessage 桥提供数据

## License

[MIT](./LICENSE) © 2026 qcqx
