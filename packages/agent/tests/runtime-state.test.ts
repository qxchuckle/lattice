/**
 * TreeRuntimeState 状态机测试：穷举转换矩阵（合法 + 非法）+ 终态守卫 + 错误传播行为
 *
 * 锁三件事：
 * 1. 两个正交维度（queue × stream）各自独立推进——queue 信号不动 stream 维度，反之亦然
 *    （对应真实并发原语：结构队列与分支流队列可同时活跃）
 * 2. 非法转换保持原态（不抛错、不产生非法态），failed 是观测驻留态（drain 不清除）
 * 3. enqueue 的错误传播契约：reject 原样传给 caller，且不卡队列（后续任务照常执行）
 */
import { describe, it, expect } from 'vitest';
import {
  advanceTreeRuntime,
  initialTreeRuntimeState,
  isTerminalTreeRuntimeState,
  hasRuntimeFailure,
} from '../src/conversation/runtime-state.js';
import type {
  TreeRuntimeState,
  TreeRuntimeSignal,
  QueueState,
  StreamState,
} from '../src/conversation/runtime-state.js';
import { TreeRuntimeRegistry } from '../src/conversation/tree-runtime.js';
import type { SessionContext } from '../src/conversation/types.js';

const QUEUE_STATES: QueueState[] = ['idle', 'queueing', 'failed'];
const STREAM_STATES: StreamState[] = ['idle', 'streaming', 'failed'];
const ALL_SIGNALS: TreeRuntimeSignal[] = [
  'enqueue-task',
  'task-done',
  'task-error',
  'stream-start',
  'stream-done',
  'stream-error',
];

/** 全部合法转换（唯一真相镜像：改转换表必须同步改这里），按维度记 */
const QUEUE_LEGAL: Array<[QueueState, TreeRuntimeSignal, QueueState]> = [
  ['idle', 'enqueue-task', 'queueing'],
  ['queueing', 'task-done', 'idle'],
  ['queueing', 'task-error', 'failed'],
  ['failed', 'enqueue-task', 'queueing'],
];
const STREAM_LEGAL: Array<[StreamState, TreeRuntimeSignal, StreamState]> = [
  ['idle', 'stream-start', 'streaming'],
  ['streaming', 'stream-done', 'idle'],
  ['streaming', 'stream-error', 'failed'],
  ['failed', 'stream-start', 'streaming'],
];

const QUEUE_SIGNALS = new Set<TreeRuntimeSignal>(['enqueue-task', 'task-done', 'task-error']);

/** 期望结果：按维度查合法镜像，非法保持原态 */
function expected(state: TreeRuntimeState, signal: TreeRuntimeSignal): TreeRuntimeState {
  if (QUEUE_SIGNALS.has(signal)) {
    const hit = QUEUE_LEGAL.find(([f, s]) => f === state.queue && s === signal);
    return hit ? { queue: hit[2], stream: state.stream } : state;
  }
  const hit = STREAM_LEGAL.find(([f, s]) => f === state.stream && s === signal);
  return hit ? { queue: state.queue, stream: hit[2] } : state;
}

const allStates = (): TreeRuntimeState[] =>
  QUEUE_STATES.flatMap((queue) => STREAM_STATES.map((stream) => ({ queue, stream })));

describe('advanceTreeRuntime：穷举转换矩阵（9 态 × 6 信号）', () => {
  it('每格结果与转换表镜像一致（合法推进 / 非法保持原态）', () => {
    for (const state of allStates()) {
      for (const signal of ALL_SIGNALS) {
        expect(advanceTreeRuntime(state, signal)).toEqual(expected(state, signal));
      }
    }
  });

  it('维度正交：queue 信号不改 stream 维度，stream 信号不改 queue 维度', () => {
    for (const state of allStates()) {
      for (const signal of ALL_SIGNALS) {
        const next = advanceTreeRuntime(state, signal);
        if (QUEUE_SIGNALS.has(signal)) {
          expect(next.stream, `${signal} 不应改 stream`).toBe(state.stream);
        } else {
          expect(next.queue, `${signal} 不应改 queue`).toBe(state.queue);
        }
      }
    }
  });

  it('非法转换保持原态（返回原对象引用，不产生非法态）', () => {
    for (const state of allStates()) {
      for (const signal of ALL_SIGNALS) {
        const next = advanceTreeRuntime(state, signal);
        if (next === state) continue; // 非法项：引用不变
        // 合法项：结果仍是合法状态
        expect(QUEUE_STATES).toContain(next.queue);
        expect(STREAM_STATES).toContain(next.stream);
      }
    }
  });

  it('主干路径：idle → queueing → idle（结构队列一轮）', () => {
    let s = initialTreeRuntimeState();
    s = advanceTreeRuntime(s, 'enqueue-task');
    expect(s.queue).toBe('queueing');
    s = advanceTreeRuntime(s, 'task-done');
    expect(s.queue).toBe('idle');
  });

  it('failed 驻留：drain 不清除，enqueue/stream-start 才拉回活跃', () => {
    let s = initialTreeRuntimeState();
    s = advanceTreeRuntime(s, 'enqueue-task');
    s = advanceTreeRuntime(s, 'task-error');
    expect(s.queue).toBe('failed');
    // 无 drain 信号能清 failed（task-done 对 failed 非法）
    expect(advanceTreeRuntime(s, 'task-done').queue).toBe('failed');
    // 新任务入队才拉回
    expect(advanceTreeRuntime(s, 'enqueue-task').queue).toBe('queueing');
  });
});

describe('守卫与派生语义', () => {
  it('isTerminalTreeRuntimeState：runtime 常驻无销毁流程 → 恒非终态（所有态均有出边）', () => {
    for (const state of allStates()) {
      const hasOutgoing = ALL_SIGNALS.some((sig) => advanceTreeRuntime(state, sig) !== state);
      expect(isTerminalTreeRuntimeState(state)).toBe(!hasOutgoing);
      expect(isTerminalTreeRuntimeState(state)).toBe(false);
    }
  });

  it('hasRuntimeFailure：任一维度 failed 即为真', () => {
    for (const state of allStates()) {
      expect(hasRuntimeFailure(state)).toBe(state.queue === 'failed' || state.stream === 'failed');
    }
  });
});

// ── TreeRuntimeRegistry 错误传播行为（enqueue 契约的集成断言） ──

const ctxOf = (sessionId: string, treeId: string | null = 't1'): SessionContext => ({
  sessionId,
  sourceId: 'mock',
  treeId,
  state: treeId ? 'active' : 'idle',
});

describe('enqueue 错误传播契约', () => {
  it('reject 原样传给 caller，且不卡队列（后续任务照常执行）', async () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1');
    await expect(
      reg.enqueue(ctx, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    let ran = false;
    await reg.enqueue(ctx, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('任务出错后 rt.state.queue=failed 且 lastError 记录（观测替身，不再无痕吞掉）', async () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1');
    await reg
      .enqueue(ctx, async () => {
        throw new Error('kaboom');
      })
      .catch(() => {});
    // 让内部 state 推进的微任务跑完
    await Promise.resolve();
    const rt = reg.of(ctx);
    expect(rt.state.queue).toBe('failed');
    expect((rt.lastError as Error)?.message).toBe('kaboom');
  });

  it('scheduleStream 错误记录到 lastError 并推进 stream 维度（不抛给调用方）', async () => {
    const reg = new TreeRuntimeRegistry();
    const ctx = ctxOf('s1');
    expect(() =>
      reg.scheduleStream(ctx, 'branch-a', async () => {
        throw new Error('stream-boom');
      }),
    ).not.toThrow();
    const rt = reg.of(ctx);
    await Promise.all([...rt.streamQueues.values()]);
    await Promise.resolve();
    expect((rt.lastError as Error)?.message).toBe('stream-boom');
    // 错误分支排空后 stream 维度驻留 failed（唯一分支排空但为 failed 非法转换保持原态）
    expect(rt.state.stream).toBe('failed');
  });
});
