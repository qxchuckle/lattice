/**
 * TreeRuntimeRegistry 单测：并发语义的地基
 *
 * 拆分前这些行为只有集成覆盖（经 controller 间接测），锁域本身的边界没有直接断言。
 * 三条不变式：结构队列串行 / 同分支串行且跨分支并行 / 锁域随树身份迁移。
 */
import { describe, it, expect } from 'vitest';
import { TreeRuntimeRegistry } from '../src/conversation/tree-runtime.js';
import type { SessionContext } from '../src/conversation/types.js';

const ctxOf = (sessionId: string, treeId: string | null = null): SessionContext => ({
  sessionId,
  sourceId: 'mock',
  treeId,
  state: treeId ? 'active' : 'idle',
});

/** 可控完成时机的任务 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('锁域身份', () => {
  it('树未创建用 session bootstrap；建树后按 treeId（多连接共享同一锁域）', () => {
    const reg = new TreeRuntimeRegistry();
    const a = ctxOf('s1');
    const bootstrap = reg.of(a);

    a.treeId = 't1'; // 懒建树：同一 ctx 迁移到 per-tree 锁域
    const perTree = reg.of(a);
    expect(perTree).not.toBe(bootstrap);

    // 另一个连接进入同一棵树 → 复用同一锁域（保证同源 session 不并发 prompt）
    expect(reg.of(ctxOf('s2', 't1'))).toBe(perTree);
    // 不同树 → 互不影响
    expect(reg.of(ctxOf('s3', 't2'))).not.toBe(perTree);
  });
});

describe('结构队列（enqueue）', () => {
  it('严格串行：后一个任务在前一个完成后才开始', async () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1', 't1');
    const first = deferred();
    const order: string[] = [];

    const p1 = reg.enqueue(ctx, async () => {
      order.push('first-start');
      await first.promise;
      order.push('first-end');
    });
    const p2 = reg.enqueue(ctx, async () => {
      order.push('second-start');
    });

    await Promise.resolve();
    expect(order).toEqual(['first-start']); // 第二个还没开始
    first.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('任务抛错传播给 caller 且不卡住队列（后续任务仍能执行）', async () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1', 't1');
    // 新契约：enqueue 返回的 promise 原样传播任务错误（caller 可感知失败）
    await expect(
      reg.enqueue(ctx, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // 错误不卡队列：后续任务照常执行
    let ran = false;
    await reg.enqueue(ctx, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe('分支流式队列（scheduleStream）', () => {
  it('同分支串行、跨分支并行', async () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1', 't1');
    const blockA1 = deferred();
    const started: string[] = [];
    const finished: string[] = [];

    reg.scheduleStream(ctx, 'branch-a', async () => {
      started.push('a1');
      await blockA1.promise;
      finished.push('a1');
    });
    reg.scheduleStream(ctx, 'branch-a', async () => {
      started.push('a2');
      finished.push('a2');
    });
    reg.scheduleStream(ctx, 'branch-b', async () => {
      started.push('b1');
      finished.push('b1');
    });

    await Promise.resolve();
    await Promise.resolve();
    // a1 阻塞时 a2 未开始（同分支串行），b1 已跑完（跨分支并行）
    expect(started).toContain('a1');
    expect(started).not.toContain('a2');
    expect(finished).toContain('b1');

    blockA1.resolve();
    const rt = reg.of(ctx);
    await Promise.all([...rt.streamQueues.values()]);
    expect(finished).toEqual(['b1', 'a1', 'a2']);
  });

  it('队列排空后清理 map 条目（不泄漏分支键）', async () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1', 't1');
    reg.scheduleStream(ctx, 'branch-a', async () => {});
    const rt = reg.of(ctx);
    await Promise.all([...rt.streamQueues.values()]);
    await Promise.resolve();
    expect(rt.streamQueues.size).toBe(0);
  });
});

describe('在途请求中止', () => {
  it('abortRequest：命中则中止并摘除，未命中返回 false', () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1', 't1');
    const rt = reg.of(ctx);
    const ctrl = new AbortController();
    rt.abortControllers.set('r1', ctrl);

    expect(reg.abortRequest(rt, 'ghost')).toBe(false);
    expect(reg.abortRequest(rt, 'r1')).toBe(true);
    expect(ctrl.signal.aborted).toBe(true);
    expect(rt.abortControllers.has('r1')).toBe(false);
  });

  it('abortAll：中止该锁域全部请求', () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1', 't1');
    const rt = reg.of(ctx);
    const ctrls = ['r1', 'r2', 'r3'].map((id) => {
      const c = new AbortController();
      rt.abortControllers.set(id, c);
      return c;
    });
    reg.abortAll(ctx);
    expect(ctrls.every((c) => c.signal.aborted)).toBe(true);
    expect(rt.abortControllers.size).toBe(0);
  });

  it('abortByRequestId：跨锁域查找（socket 断开场景），只中止命中的那个', () => {
    const reg = new TreeRuntimeRegistry();
    const rtA = reg.of(ctxOf('s1', 't1'));
    const rtB = reg.of(ctxOf('s2', 't2'));
    const a = new AbortController();
    const b = new AbortController();
    rtA.abortControllers.set('ra', a);
    rtB.abortControllers.set('rb', b);

    reg.abortByRequestId('rb');
    expect(b.signal.aborted).toBe(true);
    expect(a.signal.aborted).toBe(false);
  });

  it('abortTree：按 treeId 中止整树在途流；未知树静默返回', () => {
    const reg = new TreeRuntimeRegistry();
    const rt = reg.of(ctxOf('s1', 't1'));
    const ctrl = new AbortController();
    rt.abortControllers.set('r1', ctrl);

    expect(() => reg.abortTree('ghost-tree')).not.toThrow();
    reg.abortTree('t1');
    expect(ctrl.signal.aborted).toBe(true);
  });
});
