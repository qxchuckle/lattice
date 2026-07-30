/**
 * protocol 纯函数测试：错误分类穷尽 + 节点能力投影（含源能力维度）
 *
 * 这两个纯函数是「三层能力机制」的类型层与投影层落点：
 * errorCategory 决定消费层重试/降级策略；projectNodeCapabilities 是
 * server 守卫与 UI 渲染的单一真相（接口行为 ≡ 视图）。
 */
import { describe, it, expect } from 'vitest';
import type { SourceErrorCode, ViewStatus, NodeStatus } from '../src/index.js';
import {
  errorCategory,
  projectNodeCapabilities,
  projectViewStatus,
  canApplyOperation,
  isReadOnly,
  isBranchableChild,
  shouldSkipDescendantMark,
} from '../src/index.js';

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
  });

  it('【atMessage 维度】只能末尾分叉的源：末尾可分支，中间节点不可', () => {
    // ACP 型源：fork.atMessage=false → 只支持线形对话
    const tailOnly = { fork: { atMessage: false }, isTail: true } as const;
    const middle = { fork: { atMessage: false }, isTail: false } as const;

    // 末尾节点：分支/重试可用（从会话末尾分叉做得到）
    expect(projectNodeCapabilities('done', tailOnly).canBranch).toBe(true);
    expect(projectNodeCapabilities('error', tailOnly).canRetry).toBe(true);

    // 中间节点：分支/重试不可用——源做不到从任意 msgId 分叉
    expect(projectNodeCapabilities('done', middle).canBranch).toBe(false);
    expect(projectNodeCapabilities('error', middle).canRetry).toBe(false);
    // 但追问/撤销/删除不受影响（不需 fork）
    expect(projectNodeCapabilities('done', middle).canFollowup).toBe(true);
    expect(projectNodeCapabilities('done', middle).canUndo).toBe(true);
    expect(projectNodeCapabilities('done', middle).canDelete).toBe(true);
  });

  it('【atMessage 维度】支持任意锚点分叉的源：中间节点仍可分支', () => {
    const anywhere = { fork: { atMessage: true }, isTail: false } as const;
    expect(projectNodeCapabilities('done', anywhere).canBranch).toBe(true);
    expect(projectNodeCapabilities('error', anywhere).canRetry).toBe(true);
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

describe('操作守卫与视图投影（server 侧纵深防御的同一真相）', () => {
  it('canApplyOperation：delete 对 undone 合法、对 hidden 非法；其余操作不作用于只读终态', () => {
    expect(canApplyOperation('delete', 'undone')).toBe(true);
    expect(canApplyOperation('delete', 'hidden')).toBe(false);
    expect(canApplyOperation('delete', 'active')).toBe(true);
    for (const op of ['continue', 'retry', 'undo'] as const) {
      expect(canApplyOperation(op, 'active')).toBe(true);
      expect(canApplyOperation(op, 'interrupted')).toBe(true);
      expect(canApplyOperation(op, 'undone')).toBe(false);
      expect(canApplyOperation(op, 'hidden')).toBe(false);
    }
  });

  it('isReadOnly / isBranchableChild：只读终态判定一致（同一语义两处使用）', () => {
    expect(isReadOnly('undone')).toBe(true);
    expect(isReadOnly('hidden')).toBe(true);
    expect(isReadOnly('active')).toBe(false);
    expect(isReadOnly(undefined)).toBe(false);
    expect(isBranchableChild('active')).toBe(true);
    expect(isBranchableChild('undone')).toBe(false);
  });

  it('shouldSkipDescendantMark：undo 不复活已删除后代；delete 全标不跳过', () => {
    expect(shouldSkipDescendantMark('undone', 'hidden')).toBe(true);
    expect(shouldSkipDescendantMark('undone', 'active')).toBe(false);
    expect(shouldSkipDescendantMark('hidden', 'hidden')).toBe(false);
  });

  it('projectViewStatus：undone > hidden > error(内容) > interrupted > done', () => {
    expect(projectViewStatus('undone', true)).toBe('undone');
    expect(projectViewStatus('hidden', true)).toBe('hidden');
    expect(projectViewStatus('interrupted', true)).toBe('error'); // 内容有错优先于中断
    expect(projectViewStatus('interrupted', false)).toBe('interrupted');
    expect(projectViewStatus('active', false)).toBe('done');
    expect(projectViewStatus(undefined, false)).toBe('done');
  });

  it('投影与守卫不矛盾：投影允许的操作，守卫必须也允许（接口行为 ≡ 视图）', () => {
    const cases: Array<[ViewStatus, NodeStatus]> = [
      ['done', 'active'],
      ['error', 'active'],
      ['interrupted', 'interrupted'],
      ['undone', 'undone'],
      ['hidden', 'hidden'],
    ];
    for (const [view, persisted] of cases) {
      const caps = projectNodeCapabilities(view);
      if (caps.canUndo) expect(canApplyOperation('undo', persisted)).toBe(true);
      if (caps.canDelete) expect(canApplyOperation('delete', persisted)).toBe(true);
      if (caps.canContinue) expect(canApplyOperation('continue', persisted)).toBe(true);
      if (caps.canRetry) expect(canApplyOperation('retry', persisted)).toBe(true);
    }
  });
});
