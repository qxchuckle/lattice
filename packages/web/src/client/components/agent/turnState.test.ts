/**
 * 节点状态机的视图投影规则测试（deriveTurnStatus + protocol/node-state）
 *
 * 由 scripts/verify-state-machine.mts 迁移。
 * 投影优先级：undone > hidden > error(内容) > interrupted > done
 */
import { describe, it, expect } from 'vitest';
import { deriveTurnStatus } from './turnState';
import {
  isReadOnly,
  canApplyOperation,
  shouldSkipDescendantMark,
  isBranchableChild,
  computeNodeCapabilities,
  projectViewStatus,
} from '@qcqx/lattice-agent-protocol';
import type { ConversationNode, NodeContent } from '@qcqx/lattice-agent-protocol';

function makeNode(
  status: ConversationNode['status'],
  content: NodeContent[] = [],
): ConversationNode {
  return {
    id: 'n',
    parentId: null,
    branchId: 'b',
    role: 'assistant',
    content,
    timestamp: Date.now(),
    status,
  };
}

const user = makeNode(undefined);
const text: NodeContent[] = [{ type: 'text', text: 'hi' }];
const errContent: NodeContent[] = [
  { type: 'text', text: 'hi' },
  { type: 'error', message: 'boom' },
];

describe('deriveTurnStatus 视图投影优先级', () => {
  it('active + 无错误 → done', () => {
    expect(deriveTurnStatus(user, makeNode(undefined, text))).toBe('done');
  });

  it('interrupted + 无错误 → interrupted（继续）', () => {
    expect(deriveTurnStatus(user, makeNode('interrupted', text))).toBe('interrupted');
  });

  it('interrupted + error 内容 → error（error 优先）', () => {
    expect(deriveTurnStatus(user, makeNode('interrupted', errContent))).toBe('error');
  });

  it('active + error 内容 → error', () => {
    expect(deriveTurnStatus(user, makeNode(undefined, errContent))).toBe('error');
  });

  it('undone / hidden 结构态直接投影', () => {
    expect(deriveTurnStatus(makeNode('undone'), makeNode('undone', text))).toBe('undone');
    expect(deriveTurnStatus(makeNode('hidden'), makeNode('hidden', text))).toBe('hidden');
  });

  it('结构态优先于 error', () => {
    expect(deriveTurnStatus(makeNode('undone'), makeNode('undone', errContent))).toBe('undone');
    expect(deriveTurnStatus(makeNode('hidden'), makeNode('hidden', errContent))).toBe('hidden');
  });

  it('无 assistant（仅 user）→ done', () => {
    expect(deriveTurnStatus(user, undefined)).toBe('done');
  });

  it('interrupted 空内容（首 token 前中止）→ interrupted', () => {
    expect(deriveTurnStatus(user, makeNode('interrupted', []))).toBe('interrupted');
  });
});

describe('共享状态机（protocol/node-state）', () => {
  it('isReadOnly：undone/hidden 只读，active/interrupted/默认非只读', () => {
    expect(isReadOnly('undone')).toBe(true);
    expect(isReadOnly('hidden')).toBe(true);
    expect(isReadOnly('active')).toBe(false);
    expect(isReadOnly('interrupted')).toBe(false);
    expect(isReadOnly(undefined)).toBe(false);
  });

  it('canApplyOperation：undo 作用域', () => {
    expect(canApplyOperation('undo', 'active')).toBe(true);
    expect(canApplyOperation('undo', 'interrupted')).toBe(true);
    expect(canApplyOperation('undo', 'undone')).toBe(false);
    expect(canApplyOperation('undo', 'hidden')).toBe(false);
  });

  it('canApplyOperation：delete 作用域（undone→hidden 合法，已 hidden 不可再删）', () => {
    expect(canApplyOperation('delete', 'undone')).toBe(true);
    expect(canApplyOperation('delete', 'hidden')).toBe(false);
  });

  it('canApplyOperation：retry/continue 不作用于只读态', () => {
    expect(canApplyOperation('retry', 'undone')).toBe(false);
    expect(canApplyOperation('retry', 'hidden')).toBe(false);
    expect(canApplyOperation('continue', 'undone')).toBe(false);
    expect(canApplyOperation('continue', 'hidden')).toBe(false);
  });

  it('shouldSkipDescendantMark：undo 标记跳过 hidden 后代（不复活）', () => {
    expect(shouldSkipDescendantMark('undone', 'hidden')).toBe(true);
    expect(shouldSkipDescendantMark('undone', 'active')).toBe(false);
    expect(shouldSkipDescendantMark('undone', 'undone')).toBe(false);
    expect(shouldSkipDescendantMark('hidden', 'hidden')).toBe(false);
    expect(shouldSkipDescendantMark('hidden', 'active')).toBe(false);
  });

  it('isBranchableChild：auto-fork 只计入活跃子节点', () => {
    expect(isBranchableChild('active')).toBe(true);
    expect(isBranchableChild(undefined)).toBe(true);
    expect(isBranchableChild('undone')).toBe(false);
    expect(isBranchableChild('hidden')).toBe(false);
  });

  it('projectViewStatus：结构态 > error > interrupted > done', () => {
    expect(projectViewStatus('undone', true)).toBe('undone');
    expect(projectViewStatus('interrupted', true)).toBe('error');
    expect(projectViewStatus('interrupted', false)).toBe('interrupted');
    expect(projectViewStatus(undefined, false)).toBe('done');
  });

  it('computeNodeCapabilities：能力投影与状态机一致', () => {
    // done：可结构操作 + 追问，无重试/继续/中止
    expect(computeNodeCapabilities('done')).toEqual({
      canBranch: true,
      canUndo: true,
      canDelete: true,
      canRetry: false,
      canContinue: false,
      canFollowup: true,
      canAbort: false,
    });
    // streaming：仅可中止，禁止结构操作
    const streaming = computeNodeCapabilities('streaming');
    expect(streaming.canAbort).toBe(true);
    expect(streaming.canBranch).toBe(false);
    expect(streaming.canUndo).toBe(false);
    expect(streaming.canDelete).toBe(false);
    // error：可重试
    expect(computeNodeCapabilities('error').canRetry).toBe(true);
    expect(computeNodeCapabilities('error').canContinue).toBe(false);
    // interrupted：可继续 + 可重试
    expect(computeNodeCapabilities('interrupted').canContinue).toBe(true);
    expect(computeNodeCapabilities('interrupted').canRetry).toBe(true);
    // undone：只读，但 undone→hidden 删除合法（与 canApplyOperation 一致）
    const undone = computeNodeCapabilities('undone');
    expect(undone.canBranch).toBe(false);
    expect(undone.canUndo).toBe(false);
    expect(undone.canFollowup).toBe(false);
    expect(undone.canDelete).toBe(true);
    // hidden：全关
    const hidden = computeNodeCapabilities('hidden');
    expect(hidden.canDelete).toBe(false);
    expect(hidden.canFollowup).toBe(false);
  });
});
