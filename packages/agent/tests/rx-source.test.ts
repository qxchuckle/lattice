/**
 * from(SourceEventStream) 回归文档：rxjs from() 原生桥接 AsyncIterable
 *
 * turn-runner 的事件主干直接用 rxjs `from(stream)` 消费 SourceEventStream，
 * 不再自写桥（fromSourceStream 曾重造 from()，已删）。本测试锁定 from() 对本项目
 * EventStream 的语义：逐事件透传、迭代结束 → complete、迭代抛错 → error、退订停拉取。
 */
import { describe, it, expect } from 'vitest';
import { from, lastValueFrom, toArray, take } from 'rxjs';
import { SourceEventStream } from '@qcqx/lattice-agent-protocol';
import type { SourceEvent } from '@qcqx/lattice-agent-protocol';

/** 造一个已推入若干事件并以 done 收尾的流 */
function streamWith(events: SourceEvent[]): SourceEventStream {
  const s = new SourceEventStream();
  for (const e of events) s.push(e);
  s.push({ type: 'done', sessionId: 'sess-1', ts: Date.now() });
  return s;
}

describe('from(SourceEventStream)（rxjs 原生桥接）', () => {
  it('逐事件透传，done 后 complete', async () => {
    const s = streamWith([
      { type: 'text', content: 'a', ts: 1 },
      { type: 'text', content: 'b', ts: 2 },
    ]);
    const events = await lastValueFrom(from(s).pipe(toArray()));
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'done']);
  });

  it('源以 fail() 结束 → 迭代正常收尾 complete（错误走 error 事件通道，非 Observable error）', async () => {
    const s = new SourceEventStream();
    s.push({
      type: 'error',
      message: 'boom',
      code: 'unknown',
      retryable: false,
      source: { id: 'mock', name: 'Mock' },
      ts: 1,
    });
    s.fail(new Error('boom')); // 与 for-await 一致：fail 不向迭代抛，结束迭代
    const events = await lastValueFrom(from(s).pipe(toArray()));
    // error 事件已在流内传达；from() complete（不 error）
    expect(events.map((e) => e.type)).toEqual(['error']);
  });

  it('退订后停止拉取（take(1) 只取首个）', async () => {
    const s = streamWith([
      { type: 'text', content: 'first', ts: 1 },
      { type: 'text', content: 'second', ts: 2 },
    ]);
    const first = await lastValueFrom(from(s).pipe(take(1)));
    expect(first).toMatchObject({ type: 'text', content: 'first' });
  });
});
