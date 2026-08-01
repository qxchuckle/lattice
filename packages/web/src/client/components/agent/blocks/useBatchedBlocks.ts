/**
 * useBatchedBlocks — 流式大消息分批渲染策略
 *
 * 批次四新增：100+ 块场景下前 N 块立即渲染，后续异步插入，避免一次性挂载大量 DOM。
 *
 * 策略：
 *   - 块数 ≤ BLOCK_BATCH_THRESHOLD：全部立即渲染
 *   - 块数 > BLOCK_BATCH_THRESHOLD 且非 streaming：前 BLOCK_BATCH_IMMEDIATE 块立即，
 *     后续每帧追加 BLOCK_BATCH_SIZE 块直到全部可见
 *   - streaming 模式：不分批（用户需看到最新流式内容）
 */
import { useState, useEffect, useRef } from 'react';
import {
  BLOCK_BATCH_THRESHOLD,
  BLOCK_BATCH_IMMEDIATE,
  BLOCK_BATCH_SIZE,
} from '../../../constants/layout';

export function useBatchedBlocks<T>(blocks: T[], streaming?: boolean): T[] {
  const total = blocks.length;
  const shouldBatch = !streaming && total > BLOCK_BATCH_THRESHOLD;

  // 记录是否曾处于 streaming 模式：streaming 结束后跳过 batch 重置，保留全量可见
  const hasStreamedRef = useRef(false);
  if (streaming) hasStreamedRef.current = true;

  const [visibleCount, setVisibleCount] = useState(() =>
    shouldBatch && !hasStreamedRef.current ? BLOCK_BATCH_IMMEDIATE : total,
  );

  // 块数组身份变化时重置分批策略
  useEffect(() => {
    if (!shouldBatch) {
      // streaming 或 total ≤ 阈值：全部可见（包括 streaming→done 场景，保留全量）
      setVisibleCount((prev) => Math.max(prev, total));
      return;
    }
    // streaming 结束后首次进入 batch 区：保留之前已渲染的数量，不回退到 IMMEDIATE
    if (hasStreamedRef.current) {
      hasStreamedRef.current = false;
      setVisibleCount((prev) => Math.min(prev, total));
      return;
    }
    setVisibleCount(BLOCK_BATCH_IMMEDIATE);
  }, [shouldBatch, total]);

  // 渐进渲染：每帧追加一批块
  useEffect(() => {
    if (visibleCount >= total) return;
    const timer = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + BLOCK_BATCH_SIZE, total));
    }, 16); // ~一帧（60fps）
    return () => clearTimeout(timer);
  }, [visibleCount, total]);

  return blocks.slice(0, Math.min(visibleCount, total));
}
