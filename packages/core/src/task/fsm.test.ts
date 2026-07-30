/**
 * TaskStatus 状态机单测（L1 纯逻辑）
 *
 * 穷举 4×4 转换矩阵断言合法性（组织方式参考
 * agent-protocol/tests/pure-functions.test.ts 的转换矩阵）。
 *
 * 当前转换表为全连通矩阵——如实建模既有功能（cli start/complete/archive/reopen、
 * update --status 通用 setter、web 详情面板下拉对任意当前态可设三种活跃态），
 * 详见 fsm.ts 转换表注释。未来收紧规则时同步更新此矩阵的期望值即可。
 */
import { describe, it, expect } from 'vitest';
import type { TaskStatus } from '../types';
import { TASK_STATUSES, TASK_TRANSITIONS, isValidTaskStatus, canTransitionTaskStatus } from './fsm';

describe('TASK_STATUSES / TASK_TRANSITIONS：结构一致性', () => {
  it('状态全集与类型成员一致（4 个）', () => {
    expect(TASK_STATUSES).toEqual(['planning', 'in_progress', 'completed', 'archived']);
  });

  it('转换表键集合与 TASK_STATUSES 完全同步（单一真相不漂移）', () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it('转换表的目标状态均为合法状态', () => {
    for (const targets of Object.values(TASK_TRANSITIONS)) {
      for (const target of targets) {
        expect(TASK_STATUSES).toContain(target);
      }
    }
  });
});

describe('canTransitionTaskStatus：4×4 转换矩阵（穷举）', () => {
  // [from, to, 是否合法] —— 每一项标注支撑它的现有功能证据
  const matrix: Array<[TaskStatus, TaskStatus, boolean]> = [
    // from planning
    ['planning', 'planning', true], // 同值 no-op
    ['planning', 'in_progress', true], // cli `task start` / web 下拉
    ['planning', 'completed', true], // cli `task complete`（不检查当前态）
    ['planning', 'archived', true], // core archiveTask（任意态可归档）
    // from in_progress
    ['in_progress', 'planning', true], // web 下拉退回规划 / cli update --status
    ['in_progress', 'in_progress', true], // 同值 no-op
    ['in_progress', 'completed', true], // cli `task complete` / web 下拉
    ['in_progress', 'archived', true], // core archiveTask
    // from completed
    ['completed', 'planning', true], // 语义可疑但现状允许（web 下拉），见 fsm.ts 注释
    ['completed', 'in_progress', true], // cli `task reopen`
    ['completed', 'completed', true], // 同值 no-op
    ['completed', 'archived', true], // core archiveTask
    // from archived（归档恢复：web 下拉 / cli reopen 依赖）
    ['archived', 'planning', true],
    ['archived', 'in_progress', true],
    ['archived', 'completed', true],
    ['archived', 'archived', true], // 同值 no-op
  ];

  it('矩阵覆盖全部 16 种组合', () => {
    expect(matrix).toHaveLength(TASK_STATUSES.length * TASK_STATUSES.length);
    const keys = new Set(matrix.map(([from, to]) => `${from}->${to}`));
    expect(keys.size).toBe(16);
  });

  it.each(matrix)('%s -> %s = %s', (from, to, expected) => {
    expect(canTransitionTaskStatus(from, to)).toBe(expected);
  });

  it('矩阵期望值与转换表逐项一致（防表改测试忘改）', () => {
    for (const [from, to, expected] of matrix) {
      expect(from === to || TASK_TRANSITIONS[from].includes(to)).toBe(expected);
    }
  });
});

describe('isValidTaskStatus：值校验与类型收窄', () => {
  it.each([...TASK_STATUSES])('合法值：%s', (status) => {
    expect(isValidTaskStatus(status)).toBe(true);
  });

  it.each([['done'], ['all'], ['PLANNING'], ['in-progress'], ['']])('非法字符串：%s', (value) => {
    expect(isValidTaskStatus(value)).toBe(false);
  });

  it('非字符串输入一律非法', () => {
    expect(isValidTaskStatus(undefined)).toBe(false);
    expect(isValidTaskStatus(null)).toBe(false);
    expect(isValidTaskStatus(1)).toBe(false);
    expect(isValidTaskStatus(['planning'])).toBe(false);
  });
});
