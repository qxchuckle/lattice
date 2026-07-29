/**
 * protocol 纯函数测试：错误分类穷尽 + 节点能力投影（含源能力维度）
 *
 * 这两个纯函数是「三层能力机制」的类型层与投影层落点：
 * errorCategory 决定消费层重试/降级策略；projectNodeCapabilities 是
 * server 守卫与 UI 渲染的单一真相（接口行为 ≡ 视图）。
 */
import { describe, it, expect } from 'vitest';
import type { SourceErrorCode, ViewStatus } from '../src/index.js';
import { errorCategory, projectNodeCapabilities } from '../src/index.js';

describe('errorCategory：全 code 归类（穷尽）', () => {
  const cases: Array<[SourceErrorCode, string]> = [
    ['auth_missing', 'auth'],
    ['auth_invalid', 'auth'],
    ['auth_insufficient', 'auth'],
    ['model_not_found', 'input'],
    ['model_unavailable', 'transient'],
    ['context_overflow', 'input'],
    ['network', 'transient'],
    ['rate_limited', 'transient'],
    ['timeout', 'transient'],
    ['aborted', 'transient'],
    ['source_not_initialized', 'state'],
    ['session_not_found', 'state'],
    ['session_expired', 'state'],
    ['unsupported_operation', 'capability'],
    ['unsupported_option', 'capability'],
    ['invalid_state', 'state'],
    ['unknown', 'transient'],
  ];

  it.each(cases)('%s → %s', (code, expected) => {
    expect(errorCategory(code)).toBe(expected);
  });

  it('能力缺口类与状态类可区分（消费层据此决定「不可重试」vs「排队重试」）', () => {
    expect(errorCategory('unsupported_operation')).toBe('capability');
    expect(errorCategory('invalid_state')).toBe('state');
  });
});

describe('projectNodeCapabilities：状态 × 源能力', () => {
  it('done + 可 fork：分支/撤销/删除/追问可用，无中止/继续', () => {
    expect(projectNodeCapabilities('done')).toEqual({
      canBranch: true,
      canUndo: true,
      canDelete: true,
      canRetry: false,
      canContinue: false,
      canFollowup: true,
      canAbort: false,
    });
  });

  it('streaming：仅可中止，结构操作全禁', () => {
    const caps = projectNodeCapabilities('streaming');
    expect(caps.canAbort).toBe(true);
    expect(caps.canBranch).toBe(false);
    expect(caps.canUndo).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it('interrupted：可继续 + 可重试；error：可重试不可继续', () => {
    expect(projectNodeCapabilities('interrupted')).toMatchObject({
      canContinue: true,
      canRetry: true,
    });
    expect(projectNodeCapabilities('error')).toMatchObject({
      canContinue: false,
      canRetry: true,
    });
  });

  it('undone/hidden 只读：仅 delete 对 undone 合法', () => {
    expect(projectNodeCapabilities('undone')).toMatchObject({
      canBranch: false,
      canUndo: false,
      canDelete: true,
      canFollowup: false,
    });
    expect(projectNodeCapabilities('hidden')).toMatchObject({
      canDelete: false,
      canFollowup: false,
    });
  });

  it('【源能力维度】fork=false → branch/retry 被屏蔽，其余不变', () => {
    const noFork = projectNodeCapabilities('done', { fork: false });
    expect(noFork.canBranch).toBe(false);
    expect(noFork.canFollowup).toBe(true); // 追问不需要 fork
    expect(noFork.canUndo).toBe(true);

    const errNoFork = projectNodeCapabilities('error', { fork: false });
    expect(errNoFork.canRetry).toBe(false); // 重试 = 从锚点重问，需 fork
    expect(projectNodeCapabilities('error', { fork: { atMessage: false } }).canRetry).toBe(true);
  });

  it('ctx 缺省 = 宽松（client streaming 瞬时态过渡用）', () => {
    const statuses: ViewStatus[] = ['done', 'error', 'interrupted'];
    for (const s of statuses) {
      expect(projectNodeCapabilities(s)).toEqual(
        projectNodeCapabilities(s, { fork: { atMessage: true } }),
      );
    }
  });
});
