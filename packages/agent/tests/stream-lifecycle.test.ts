/**
 * StreamLifecycleState 状态机测试：穷举转换矩阵（合法 + 非法）
 *
 * 锁两件事：
 * 1. 生命周期单向推进：idle → preflight → streaming → 终态，终态不接受任何信号
 *    （防「已结束的轮次被迟到信号改写结局」，与 node-state 的终止态守卫同一铁律）
 * 2. 对外 interrupted 语义只由 aborted / source-incomplete 派生——
 *    这是 turn-runner 原 `signal.aborted || !accumulator.done` 布尔混合判断的显式替身，
 *    矩阵变了意味着落盘状态（interrupted 节点）语义变了。
 */
import { describe, it, expect } from 'vitest';
import {
  advanceStreamLifecycle,
  isTerminalStreamState,
  isInterruptedStreamState,
} from '../src/conversation/stream-lifecycle.js';
import type {
  StreamLifecycleState,
  StreamLifecycleSignal,
} from '../src/conversation/stream-lifecycle.js';

const ALL_STATES: StreamLifecycleState[] = [
  'idle',
  'preflight',
  'streaming',
  'completed',
  'aborted',
  'source-incomplete',
  'readonly-skipped',
  'failed',
];

const ALL_SIGNALS: StreamLifecycleSignal[] = [
  'begin',
  'skip-readonly',
  'fail',
  'stream',
  'complete',
  'abort',
  'source-incomplete',
];

/** 全部合法转换（唯一真相镜像：改转换表必须同步改这里） */
const LEGAL: Array<[StreamLifecycleState, StreamLifecycleSignal, StreamLifecycleState]> = [
  ['idle', 'begin', 'preflight'],
  ['preflight', 'skip-readonly', 'readonly-skipped'],
  ['preflight', 'fail', 'failed'],
  ['preflight', 'stream', 'streaming'],
  ['streaming', 'complete', 'completed'],
  ['streaming', 'abort', 'aborted'],
  ['streaming', 'source-incomplete', 'source-incomplete'],
];

describe('advanceStreamLifecycle：合法转换', () => {
  it.each(LEGAL)('%s --%s--> %s', (from, signal, to) => {
    expect(advanceStreamLifecycle(from, signal)).toBe(to);
  });

  it('主干路径：idle → preflight → streaming → completed', () => {
    let s: StreamLifecycleState = 'idle';
    s = advanceStreamLifecycle(s, 'begin');
    s = advanceStreamLifecycle(s, 'stream');
    s = advanceStreamLifecycle(s, 'complete');
    expect(s).toBe('completed');
  });
});

describe('advanceStreamLifecycle：非法转换保持原态（穷举）', () => {
  const legalSet = new Set(LEGAL.map(([from, signal]) => `${from}|${signal}`));

  it('全组合中非合法项一律保持当前状态（不抛错、不产生非法态）', () => {
    for (const state of ALL_STATES) {
      for (const signal of ALL_SIGNALS) {
        if (legalSet.has(`${state}|${signal}`)) continue;
        expect(advanceStreamLifecycle(state, signal)).toBe(state);
      }
    }
  });

  it('合法转换数与转换表一致（矩阵覆盖 8 态 × 7 信号 = 56 组合，其中 7 条合法）', () => {
    let legalCount = 0;
    for (const state of ALL_STATES) {
      for (const signal of ALL_SIGNALS) {
        if (advanceStreamLifecycle(state, signal) !== state) legalCount++;
      }
    }
    // LEGAL 中无 from === to 的转换，「结果 ≠ 原态」计数法可完整覆盖合法项
    expect(legalCount).toBe(LEGAL.length);
  });

  it('🔴 终态守卫：completed/aborted/source-incomplete/readonly-skipped/failed 不接受任何信号', () => {
    const terminals: StreamLifecycleState[] = [
      'completed',
      'aborted',
      'source-incomplete',
      'readonly-skipped',
      'failed',
    ];
    for (const state of terminals) {
      for (const signal of ALL_SIGNALS) {
        expect(advanceStreamLifecycle(state, signal)).toBe(state);
      }
    }
  });

  it('全组合的返回值必须仍是合法状态', () => {
    for (const state of ALL_STATES) {
      for (const signal of ALL_SIGNALS) {
        expect(ALL_STATES).toContain(advanceStreamLifecycle(state, signal));
      }
    }
  });
});

describe('守卫与派生语义', () => {
  it('isTerminalStreamState：终态判定与转换表一致（终态 ⟺ 无出边）', () => {
    for (const state of ALL_STATES) {
      const hasOutgoing = ALL_SIGNALS.some((sig) => advanceStreamLifecycle(state, sig) !== state);
      expect(isTerminalStreamState(state)).toBe(!hasOutgoing);
    }
  });

  it('isInterruptedStreamState：仅 aborted / source-incomplete 派生对外中断（原布尔混合的替身）', () => {
    for (const state of ALL_STATES) {
      expect(isInterruptedStreamState(state)).toBe(
        state === 'aborted' || state === 'source-incomplete',
      );
    }
    // 只读提前返回与前置失败不是「中断」——不落 interrupted 节点
    expect(isInterruptedStreamState('readonly-skipped')).toBe(false);
    expect(isInterruptedStreamState('failed')).toBe(false);
    expect(isInterruptedStreamState('completed')).toBe(false);
  });
});
