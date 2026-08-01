/**
 * EventStream 背压监控测试
 *
 * 验证 metrics（queueSize / maxQueueSize / isBackpressured）：
 * - 无消费者时 push 超过阈值（1000）→ isBackpressured 标记告警
 * - maxQueueSize 记录历史峰值（消费后不重置）
 * - queueSize 反映当前队列长度（消费后归零）
 * - 有消费者时 queue 不堆积 → 不触发背压
 *
 * 不改变单消费者语义。
 */
import { describe, it, expect } from 'vitest';
import { EventStream } from '../src/index.js';

describe('EventStream 背压监控', () => {
  it('push 1001 个事件（无消费者）→ isBackpressured===true、maxQueueSize 记录峰值', () => {
    const stream = new EventStream<string, string>(
      (e) => e === 'done',
      (e) => e,
    );
    for (let i = 0; i < 1001; i++) stream.push(`event-${i}`);

    expect(stream.metrics.isBackpressured).toBe(true);
    expect(stream.metrics.maxQueueSize).toBe(1001);
    expect(stream.metrics.queueSize).toBe(1001);
  });

  it('push 1000 个事件（恰好未超阈值）→ isBackpressured 仍为 false', () => {
    const stream = new EventStream<string, string>(
      (e) => e === 'done',
      (e) => e,
    );
    for (let i = 0; i < 1000; i++) stream.push(`event-${i}`);

    expect(stream.metrics.isBackpressured).toBe(false);
    expect(stream.metrics.maxQueueSize).toBe(1000);
    expect(stream.metrics.queueSize).toBe(1000);
  });

  it('消费后 queueSize 归零但 maxQueueSize 保留峰值、isBackpressured 保持告警（sticky）', async () => {
    const stream = new EventStream<string, string>(
      (e) => e === 'done',
      (e) => e,
    );
    for (let i = 0; i < 1001; i++) stream.push(`event-${i}`);
    stream.push('done');

    const drained: string[] = [];
    for await (const e of stream) drained.push(e);

    expect(drained).toHaveLength(1002);
    expect(stream.metrics.queueSize).toBe(0);
    // 1001 事件 + 1 done 均入过 queue → 峰值 1002
    expect(stream.metrics.maxQueueSize).toBe(1002);
    expect(stream.metrics.isBackpressured).toBe(true);
  });

  it('少量事件不触发背压，maxQueueSize 记录实际峰值', () => {
    const stream = new EventStream<string, string>(
      (e) => e === 'done',
      (e) => e,
    );
    stream.push('a');
    stream.push('b');
    stream.push('c');

    expect(stream.metrics.isBackpressured).toBe(false);
    expect(stream.metrics.maxQueueSize).toBe(3);
    expect(stream.metrics.queueSize).toBe(3);
  });

  it('有消费者待命时 push 直接送达消费者，queue 不堆积、不触发背压', async () => {
    const stream = new EventStream<string, string>(
      (e) => e === 'done',
      (e) => e,
    );
    // 先启动消费者：for-await 首次迭代同步挂起 await，waiters 中有一条待命
    const consumed: string[] = [];
    const done = (async () => {
      for await (const e of stream) {
        consumed.push(e);
        if (e === 'done') return;
      }
    })();

    // 同步 push：第一条命中 waiter 直接送达，其余进 queue
    // 但因消费者微任务调度，queue 会有短暂堆积（≤ push 总数），关键是不超过阈值
    for (let i = 0; i < 500; i++) stream.push(`e-${i}`);
    stream.push('done');
    await done;

    expect(consumed).toHaveLength(501);
    expect(stream.metrics.isBackpressured).toBe(false);
    expect(stream.metrics.maxQueueSize).toBeLessThanOrEqual(500);
  });
});
