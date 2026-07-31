/**
 * 节点状态机的视图投影规则测试（deriveTurnStatus + protocol/node-state）
 *
 * 由 scripts/verify-state-machine.mts 迁移。
 * 投影优先级：undone > hidden > error(内容) > interrupted > done
 */
import { describe, it, expect } from 'vitest';
import {
  deriveTurnStatus,
  viewToNodeStatus,
  isStreamingStatus,
  isVisibleTurnStatus,
  turnStyleFlags,
} from './turnState';
import {
  isReadOnly,
  canApplyOperation,
  shouldSkipDescendantMark,
  isBranchableChild,
  projectNodeCapabilities,
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

  it('compaction/notice 块不触发 error 投影（非 error 块）', () => {
    const blocks: NodeContent[] = [
      { type: 'text', text: 'hi' },
      { type: 'compaction', trigger: 'auto', preTokens: 1000 },
      { type: 'notice', level: 'warning', text: '会话恢复失败' },
    ];
    expect(deriveTurnStatus(user, makeNode(undefined, blocks))).toBe('done');
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

  it('projectNodeCapabilities：能力投影与状态机一致', () => {
    // done：可结构操作 + 追问，无重试/继续/中止
    expect(projectNodeCapabilities('done')).toEqual({
      canBranch: true,
      canUndo: true,
      canDelete: true,
      canRetry: false,
      canContinue: false,
      canFollowup: true,
      canAbort: false,
    });
    // streaming：仅可中止，禁止结构操作
    const streaming = projectNodeCapabilities('streaming');
    expect(streaming.canAbort).toBe(true);
    expect(streaming.canBranch).toBe(false);
    expect(streaming.canUndo).toBe(false);
    expect(streaming.canDelete).toBe(false);
    // error：可重试
    expect(projectNodeCapabilities('error').canRetry).toBe(true);
    expect(projectNodeCapabilities('error').canContinue).toBe(false);
    // interrupted：可继续 + 可重试
    expect(projectNodeCapabilities('interrupted').canContinue).toBe(true);
    expect(projectNodeCapabilities('interrupted').canRetry).toBe(true);
    // undone：只读，但 undone→hidden 删除合法（与 canApplyOperation 一致）
    const undone = projectNodeCapabilities('undone');
    expect(undone.canBranch).toBe(false);
    expect(undone.canUndo).toBe(false);
    expect(undone.canFollowup).toBe(false);
    expect(undone.canDelete).toBe(true);
    // hidden：全关
    const hidden = projectNodeCapabilities('hidden');
    expect(hidden.canDelete).toBe(false);
    expect(hidden.canFollowup).toBe(false);
  });
});

describe('客户端谓词适配（turnState 薄层，单一真相在 protocol/node-state）', () => {
  it('viewToNodeStatus：done → active（投影反向适配），其余同名透传', () => {
    expect(viewToNodeStatus('done')).toBe('active');
    expect(viewToNodeStatus('streaming')).toBe('streaming');
    expect(viewToNodeStatus('error')).toBe('error');
    expect(viewToNodeStatus('interrupted')).toBe('interrupted');
    expect(viewToNodeStatus('undone')).toBe('undone');
    expect(viewToNodeStatus('hidden')).toBe('hidden');
  });

  it('viewToNodeStatus 与 canApplyOperation 组合：done 可操作，终态只读', () => {
    expect(canApplyOperation('undo', viewToNodeStatus('done'))).toBe(true);
    expect(canApplyOperation('undo', viewToNodeStatus('undone'))).toBe(false);
    expect(canApplyOperation('delete', viewToNodeStatus('undone'))).toBe(true);
    expect(canApplyOperation('delete', viewToNodeStatus('hidden'))).toBe(false);
  });

  it('isStreamingStatus：仅 streaming 为真（含 undefined 兑底）', () => {
    expect(isStreamingStatus('streaming')).toBe(true);
    expect(isStreamingStatus('done')).toBe(false);
    expect(isStreamingStatus('hidden')).toBe(false);
    expect(isStreamingStatus(undefined)).toBe(false);
  });

  it('isVisibleTurnStatus：仅 hidden 不可见（undefined 视为可见）', () => {
    expect(isVisibleTurnStatus('hidden')).toBe(false);
    expect(isVisibleTurnStatus('done')).toBe(true);
    expect(isVisibleTurnStatus('undone')).toBe(true);
    expect(isVisibleTurnStatus('streaming')).toBe(true);
    expect(isVisibleTurnStatus(undefined)).toBe(true);
  });

  it('turnStyleFlags：各状态恰有对应标志为真，互斥', () => {
    expect(turnStyleFlags('streaming')).toEqual({
      isStreaming: true,
      isError: false,
      isInterrupted: false,
      isUndone: false,
      isHidden: false,
    });
    expect(turnStyleFlags('error').isError).toBe(true);
    expect(turnStyleFlags('interrupted').isInterrupted).toBe(true);
    expect(turnStyleFlags('undone').isUndone).toBe(true);
    expect(turnStyleFlags('hidden').isHidden).toBe(true);
    // done / undefined：全假（普通完成态样式）
    const done = turnStyleFlags('done');
    const none = turnStyleFlags(undefined);
    for (const f of [done, none]) {
      expect(Object.values(f).every((v) => v === false)).toBe(true);
    }
  });
});
