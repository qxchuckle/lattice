/**
 * useConnectionState hook 行为测试
 *
 * 验证：
 *   1. 初始状态为 disconnected（模块加载时无连接）
 *   2. 订阅后状态变化能同步到 React 组件
 *   3. 连接/断连/重连状态正确反映
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConnectionState, __resetConnectionStateForTest } from './useConnectionState';
import { __resetConnectionForTest, __setConnStateForTest } from './connection';

describe('useConnectionState', () => {
  beforeEach(() => {
    __resetConnectionForTest();
    __resetConnectionStateForTest();
  });

  it('初始状态为 disconnected', () => {
    const { result } = renderHook(() => useConnectionState());
    expect(result.current.type).toBe('disconnected');
  });

  it('connecting → connected 状态转换正确反映', () => {
    const { result } = renderHook(() => useConnectionState());
    expect(result.current.type).toBe('disconnected');

    act(() => {
      __setConnStateForTest({ type: 'connecting', attempt: 0 });
    });
    expect(result.current.type).toBe('connecting');

    act(() => {
      __setConnStateForTest({ type: 'connected' });
    });
    expect(result.current.type).toBe('connected');
  });

  it('connected → reconnecting 状态转换正确反映', () => {
    const { result } = renderHook(() => useConnectionState());

    act(() => {
      __setConnStateForTest({ type: 'connected' });
    });
    expect(result.current.type).toBe('connected');

    act(() => {
      __setConnStateForTest({
        type: 'reconnecting',
        attempt: 1,
        reason: 'connection-lost',
      });
    });
    expect(result.current.type).toBe('reconnecting');
    if (result.current.type === 'reconnecting') {
      expect(result.current.reason).toBe('connection-lost');
      expect(result.current.attempt).toBe(1);
    }
  });

  it('reconnecting → disconnected → connecting 状态转换正确反映', () => {
    const { result } = renderHook(() => useConnectionState());

    act(() => {
      __setConnStateForTest({ type: 'reconnecting', attempt: 2, reason: 'connect-failed' });
    });
    expect(result.current.type).toBe('reconnecting');

    act(() => {
      __setConnStateForTest({ type: 'disconnected' });
    });
    expect(result.current.type).toBe('disconnected');

    act(() => {
      __setConnStateForTest({ type: 'connecting', attempt: 0 });
    });
    expect(result.current.type).toBe('connecting');
  });
});
