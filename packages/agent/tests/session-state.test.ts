/**
 * SessionState 状态机测试：穷举转换矩阵（合法 + 非法）+ 终态守卫
 *
 * 锁两件事：
 * 1. 生命周期推进：idle → initializing → active → destroyed，destroyed 是终态
 *    （防「已销毁会话被迟到命令复活」，与 node-state / stream-lifecycle 终态守卫同一铁律）
 * 2. 树创建失败回退：initializing --tree-init-failed--> idle（下次 send 可重新懒建）
 */
import { describe, it, expect } from 'vitest';
import { advanceSessionState, isTerminalSessionState } from '../src/conversation/session-state.js';
import type { SessionState, SessionSignal } from '../src/conversation/session-state.js';

const ALL_STATES: SessionState[] = ['idle', 'initializing', 'active', 'destroyed'];
const ALL_SIGNALS: SessionSignal[] = ['tree-init', 'tree-created', 'tree-init-failed', 'destroy'];

/** 全部合法转换（唯一真相镜像：改转换表必须同步改这里） */
const LEGAL: Array<[SessionState, SessionSignal, SessionState]> = [
  ['idle', 'tree-init', 'initializing'],
  ['idle', 'tree-created', 'active'],
  ['idle', 'destroy', 'destroyed'],
  ['initializing', 'tree-created', 'active'],
  ['initializing', 'tree-init-failed', 'idle'],
  ['initializing', 'destroy', 'destroyed'],
  ['active', 'destroy', 'destroyed'],
];

describe('advanceSessionState：合法转换', () => {
  it.each(LEGAL)('%s --%s--> %s', (from, signal, to) => {
    expect(advanceSessionState(from, signal)).toBe(to);
  });

  it('主干路径：idle → initializing → active → destroyed', () => {
    let s: SessionState = 'idle';
    s = advanceSessionState(s, 'tree-init');
    expect(s).toBe('initializing');
    s = advanceSessionState(s, 'tree-created');
    expect(s).toBe('active');
    s = advanceSessionState(s, 'destroy');
    expect(s).toBe('destroyed');
  });

  it('树创建失败回退：initializing → idle（可重新懒建）', () => {
    let s: SessionState = 'idle';
    s = advanceSessionState(s, 'tree-init');
    s = advanceSessionState(s, 'tree-init-failed');
    expect(s).toBe('idle');
  });
});

describe('advanceSessionState：非法转换保持原态（穷举）', () => {
  const legalSet = new Set(LEGAL.map(([from, signal]) => `${from}|${signal}`));

  it('全组合中非合法项一律保持当前状态（不抛错、不产生非法态）', () => {
    for (const state of ALL_STATES) {
      for (const signal of ALL_SIGNALS) {
        if (legalSet.has(`${state}|${signal}`)) continue;
        expect(advanceSessionState(state, signal)).toBe(state);
      }
    }
  });

  it('合法转换数与转换表一致（矩阵覆盖 4 态 × 4 信号 = 16 组合，其中 7 条合法）', () => {
    let legalCount = 0;
    for (const state of ALL_STATES) {
      for (const signal of ALL_SIGNALS) {
        if (advanceSessionState(state, signal) !== state) legalCount++;
      }
    }
    // LEGAL 中无 from === to 的转换，「结果 ≠ 原态」计数法可完整覆盖合法项
    expect(legalCount).toBe(LEGAL.length);
  });

  it('🔴 终态守卫：destroyed 不接受任何信号（幂等，重复 destroy 保持原态）', () => {
    for (const signal of ALL_SIGNALS) {
      expect(advanceSessionState('destroyed', signal)).toBe('destroyed');
    }
  });

  it('全组合的返回值必须仍是合法状态', () => {
    for (const state of ALL_STATES) {
      for (const signal of ALL_SIGNALS) {
        expect(ALL_STATES).toContain(advanceSessionState(state, signal));
      }
    }
  });
});

describe('守卫语义', () => {
  it('isTerminalSessionState：终态判定与转换表一致（终态 ⟺ 无出边）', () => {
    for (const state of ALL_STATES) {
      const hasOutgoing = ALL_SIGNALS.some((sig) => advanceSessionState(state, sig) !== state);
      expect(isTerminalSessionState(state)).toBe(!hasOutgoing);
    }
    expect(isTerminalSessionState('destroyed')).toBe(true);
    expect(isTerminalSessionState('idle')).toBe(false);
  });
});
