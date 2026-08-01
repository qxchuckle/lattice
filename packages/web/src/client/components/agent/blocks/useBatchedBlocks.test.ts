/**
 * useBatchedBlocks hook 行为测试
 *
 * 验证流式大消息分批渲染策略：
 *   1. 块数 ≤ 阈值：全部立即渲染（无延迟）
 *   2. 块数 > 阈值：前 N 块立即渲染，后续分批异步插入
 *   3. streaming 模式：不分批，全部立即可见（用户需看到最新流式内容）
 *   4. 分批增长最终渲染所有块
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBatchedBlocks } from './useBatchedBlocks';

// 生成 N 个占位块
function makeBlocks(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

describe('useBatchedBlocks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('块数 ≤ 阈值时全部立即渲染', () => {
    const blocks = makeBlocks(10);
    const { result } = renderHook(() => useBatchedBlocks(blocks, false));
    expect(result.current).toHaveLength(10);
  });

  it('块数 > 阈值时仅渲染前 N 块（立即批次）', () => {
    const blocks = makeBlocks(100);
    const { result } = renderHook(() => useBatchedBlocks(blocks, false));
    // 初始只渲染 BLOCK_BATCH_IMMEDIATE（30）块
    expect(result.current).toHaveLength(30);
  });

  it('streaming 模式不分批，全部立即可见', () => {
    const blocks = makeBlocks(100);
    const { result } = renderHook(() => useBatchedBlocks(blocks, true));
    expect(result.current).toHaveLength(100);
  });

  it('分批增长：timer 推进后更多块变为可见', () => {
    const blocks = makeBlocks(100);
    const { result } = renderHook(() => useBatchedBlocks(blocks, false));
    expect(result.current).toHaveLength(30); // 初始

    act(() => {
      vi.advanceTimersByTime(20);
    });
    // 30 + 20 = 50
    expect(result.current).toHaveLength(50);

    act(() => {
      vi.advanceTimersByTime(20);
    });
    // 50 + 20 = 70
    expect(result.current).toHaveLength(70);
  });

  it('最终所有块都被渲染', () => {
    const blocks = makeBlocks(100);
    const { result } = renderHook(() => useBatchedBlocks(blocks, false));
    expect(result.current).toHaveLength(30);

    // 逐帧推进 timer：每帧追加 BLOCK_BATCH_SIZE 块
    // 30 → 50 → 70 → 90 → 100（cap）
    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(20);
      });
    }
    expect(result.current).toHaveLength(100);
  });

  it('streaming→done 不回退已渲染量（total 100 全程可见后保持 100）', () => {
    // streaming 阶段：total 从 0 渐增到 100，全部可见
    const blocks = makeBlocks(100);
    const { result, rerender } = renderHook(
      ({ blocks, streaming }) => useBatchedBlocks(blocks, streaming),
      { initialProps: { blocks, streaming: true } },
    );

    // streaming 中 100 块全部可见
    expect(result.current).toHaveLength(100);

    // streaming 结束（streaming=false），total 不变
    rerender({ blocks, streaming: false });
    // 不回退到 BLOCK_BATCH_IMMEDIATE(30)，仍保持 100
    expect(result.current).toHaveLength(100);
  });

  it('streaming→done 后新增块走分批逻辑（total 增长场景）', () => {
    const blocks100 = makeBlocks(100);
    const { result, rerender } = renderHook(
      ({ blocks, streaming }) => useBatchedBlocks(blocks, streaming),
      { initialProps: { blocks: blocks100, streaming: true } },
    );

    expect(result.current).toHaveLength(100);

    // streaming 结束且 total 增长（新块到来）
    const blocks150 = makeBlocks(150);
    rerender({ blocks: blocks150, streaming: false });

    // 不回退到 30；保持至少之前可见的 100（Math.min(prev=100, total=150)=100）
    // 然后分批增长到 150
    expect(result.current.length).toBeGreaterThanOrEqual(100);
  });
});
