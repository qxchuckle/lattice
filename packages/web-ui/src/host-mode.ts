/**
 * 宿主探测（纯检测，无任何桥调用）：
 * VSCode Webview 会注入全局 acquireVsCodeApi；以此让视图层知道「编辑动作应交给原生编辑器」。
 */
export function isWebviewHost(): boolean {
  return typeof (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi === 'function';
}
