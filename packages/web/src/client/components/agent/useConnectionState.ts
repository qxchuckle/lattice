/**
 * useConnectionState — 订阅 agent WebSocket 连接状态
 *
 * 批次四新增：UI 可通过此 hook 消费 connectionState$，
 * 显示 connected/connecting/error/disconnected 状态指示器。
 */
import { useSyncExternalStore } from 'react';
import { connectionState$, getConnectionState, type ConnectionState } from './connection';

// 外部 store 适配 useSyncExternalStore
let currentState: ConnectionState = getConnectionState();
const listeners = new Set<() => void>();

// 订阅 connectionState$ 并同步到本地缓存
let subscribed = false;
let stateSub: { unsubscribe: () => void } | null = null;
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  stateSub = connectionState$.subscribe((state) => {
    currentState = state;
    listeners.forEach((l) => l());
  });
}

function subscribe(callback: () => void): () => void {
  ensureSubscribed();
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): ConnectionState {
  return currentState;
}

/** 仅测试用：重置订阅状态（退订 + 清空 listeners + 重置 flag） */
export function __resetConnectionStateForTest(): void {
  stateSub?.unsubscribe();
  stateSub = null;
  subscribed = false;
  listeners.clear();
  currentState = getConnectionState();
}

/** React hook：订阅连接状态变化，返回当前 ConnectionState */
export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
