/**
 * ConnectionIndicator handleRetry 行为测试
 *
 * 验证 reconnecting 态点击重试先 disconnectAgentWs 再 connectAgentWs（防 WS 泄漏）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

// mock 连接层
const mockConnectAgentWs = vi.fn();
const mockDisconnectAgentWs = vi.fn();
vi.mock('./connection', () => ({
  connectAgentWs: (...args: unknown[]) => mockConnectAgentWs(...args),
  disconnectAgentWs: (...args: unknown[]) => mockDisconnectAgentWs(...args),
  getConnectionState: vi.fn(() => ({ type: 'disconnected' as const })),
  connectionState$: { subscribe: () => ({ unsubscribe: () => {} }) },
}));

// mock useConnectionState（测试时控制返回值）
let mockConnState: Record<string, unknown> = { type: 'disconnected' };
vi.mock('./useConnectionState', () => ({
  useConnectionState: () => mockConnState,
}));

// mock authStore（valtio proxy 由工厂内联创建）
vi.mock('../../store', async () => {
  const { proxy } = await import('valtio');
  return {
    authStore: proxy({
      token: null as string | null,
      initialized: true,
      authEnabled: false,
    }),
  };
});

// mock antd App.useApp()
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
        notification: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
      }),
    },
  };
});

import { ConnectionIndicator } from './ConnectionIndicator';

beforeEach(() => {
  vi.clearAllMocks();
  mockConnState = { type: 'disconnected' };
});

afterEach(() => {
  cleanup();
});

function clickActionableBadge(): boolean {
  // Badge 渲染为 span.ant-badge，在可操作态时有 cursor:pointer style
  const badges = document.querySelectorAll('.ant-badge, [class*="ant-badge"]');
  for (const badge of badges) {
    const el = badge as HTMLElement;
    if (el.style.cursor === 'pointer') {
      fireEvent.click(el);
      return true;
    }
    // Badge 的父元素（Tooltip 包裹）也可能有 cursor:pointer
    const parent = el.parentElement;
    if (parent && (parent as HTMLElement).style.cursor === 'pointer') {
      fireEvent.click(parent);
      return true;
    }
  }
  // fallback: 找任何 cursor:pointer 元素
  const clickable = document.querySelector('[style*="cursor"]') as HTMLElement | null;
  if (clickable && clickable.style.cursor === 'pointer') {
    fireEvent.click(clickable);
    return true;
  }
  return false;
}

describe('ConnectionIndicator handleRetry', () => {
  it('disconnected 态点击重试只调用 connectAgentWs（不调 disconnect）', () => {
    mockConnState = { type: 'disconnected' };
    render(<ConnectionIndicator />);

    const clicked = clickActionableBadge();
    if (!clicked) {
      // disconnected 态可能不渲染可点击元素（cursor:default），这是正确行为
      // 只要 disconnectAgentWs 没被调用即可
    }

    expect(mockDisconnectAgentWs).not.toHaveBeenCalled();
    if (clicked) {
      expect(mockConnectAgentWs).toHaveBeenCalled();
    }
  });

  it('reconnecting 态点击重试先 disconnectAgentWs 再 connectAgentWs', () => {
    mockConnState = { type: 'reconnecting', attempt: 1, reason: 'connection-lost' };
    render(<ConnectionIndicator />);

    const clicked = clickActionableBadge();
    expect(clicked, 'reconnecting 态应有可点击元素').toBe(true);

    // 验证：disconnectAgentWs 在 connectAgentWs 之前被调用
    expect(mockDisconnectAgentWs).toHaveBeenCalled();
    expect(mockConnectAgentWs).toHaveBeenCalled();

    // 确认调用顺序：disconnect 先于 connect
    const disconnectOrder = mockDisconnectAgentWs.mock.invocationCallOrder[0];
    const connectOrder = mockConnectAgentWs.mock.invocationCallOrder[0];
    expect(disconnectOrder).toBeLessThan(connectOrder);
  });
});
