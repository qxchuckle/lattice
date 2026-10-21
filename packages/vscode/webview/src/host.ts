import type {
  BridgeActionName,
  BridgeRequestMethod,
  BridgeResponse,
  ConfigProgressEvent,
  ExtensionToWebview,
} from '@qcqx/lattice-protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | null | undefined;

/** 是否运行在 VSCode Webview 宿主中。 */
export function isWebviewHost(): boolean {
  return typeof acquireVsCodeApi === 'function';
}

export function getVsCodeApi(): VsCodeApi | null {
  if (!isWebviewHost()) return null;
  if (api === undefined) {
    try {
      api = acquireVsCodeApi();
    } catch {
      api = null;
    }
  }
  return api ?? null;
}

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingEntry>();
let seq = 0;

/** 请求-响应（30s 超时；面板销毁时由扩展侧忽略）。 */
export function bridgeRequest<T>(
  method: BridgeRequestMethod,
  params?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const vscodeApi = getVsCodeApi();
  if (!vscodeApi) return Promise.reject(new Error('Not running in a VSCode webview'));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Bridge request timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    vscodeApi.postMessage({ kind: 'request', id, method, params });
  });
}

export function bridgeAction(action: BridgeActionName, params?: unknown): void {
  getVsCodeApi()?.postMessage({ kind: 'action', action, params });
}

export interface HostBridgeHandlers {
  onSnapshotChanged?: (payload?: { sections?: string[] }) => void;
  onThemeChanged?: (mode: 'light' | 'dark') => void;
  onRouteTo?: (path: string) => void;
  onConfigProgress?: (payload: ConfigProgressEvent) => void;
  onConfigStateChanged?: () => void;
}

let bridgeInitialized = false;

/** 初始化宿主桥：响应路由 + 事件分发（theme / snapshotChanged / routeTo）+ ready 握手。 */
export function initHostBridge(handlers: HostBridgeHandlers = {}): void {
  const vscodeApi = getVsCodeApi();
  if (!vscodeApi || bridgeInitialized) return;
  bridgeInitialized = true;

  window.addEventListener('message', (event: MessageEvent<ExtensionToWebview>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'response') {
      const response = message as BridgeResponse;
      const entry = pending.get(response.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(response.id);
      if (response.ok) entry.resolve(response.data);
      else entry.reject(new Error(response.error?.message ?? 'Bridge error'));
      return;
    }
    if (message.kind === 'event') {
      switch (message.event) {
        case 'themeChanged': {
          const mode = (message.payload as { mode?: 'light' | 'dark' } | undefined)?.mode;
          if (mode === 'light' || mode === 'dark') handlers.onThemeChanged?.(mode);
          break;
        }
        case 'snapshotChanged':
          handlers.onSnapshotChanged?.(message.payload as { sections?: string[] } | undefined);
          break;
        case 'routeTo': {
          const path = (message.payload as { path?: string } | undefined)?.path;
          if (path) handlers.onRouteTo?.(path);
          break;
        }
        case 'configProgress':
          handlers.onConfigProgress?.(message.payload as ConfigProgressEvent);
          break;
        case 'configStateChanged':
          handlers.onConfigStateChanged?.();
          break;
      }
    }
  });

  vscodeApi.postMessage({ kind: 'ready' });
}
