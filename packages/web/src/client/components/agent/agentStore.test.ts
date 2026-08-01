/**
 * agentStore actions 行为契约测试
 *
 * 覆盖两组契约（spec/agent-node-state-machine.md：client 禁止内联判断，守卫走 protocol 谓词）：
 *   1. submitFromNode fork/追问前的源可用性校验：
 *      线程源不可换（server 沿祖先链解析），源不可用/已移除时落 error turn 提示，不发送；
 *      源目录未加载（sources 空）不拦截，root 提交不受影响。
 *   2. 操作守卫（canApplyOperation）：undo/delete/retry/continue 对只读终态 no-op，
 *      undone→hidden 删除合法，undo 不复活 hidden 后代。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock 连接层（避免真实 WS）：sendWs 捕获出站消息，isWsReady 恒 true 走同步发送路径
vi.mock('./connection', () => ({
  sendWs: vi.fn(),
  isWsReady: vi.fn(() => true),
  connectAgentWs: vi.fn(),
  disconnectAgentWs: vi.fn(),
  setStreamingTarget: vi.fn(),
  unsubscribeTree: vi.fn(),
  waitForSessionReady: vi.fn(() => new Promise<string>(() => {})),
}));

import type {
  ClientMessage,
  ConversationNode,
  TreeSnapshotMessage,
  StreamEventMessage,
} from '@qcqx/lattice-agent-protocol';
import { sendWs } from './connection';
import type { ClientSourceInfo } from './store';
import {
  applySnapshot,
  resetLastAppliedRev,
  __hasLiveStreamForTest,
  handleStreamEvent,
  startLiveStreamGc,
} from './sync';
import {
  agentStore,
  putTurn,
  submitFromNode,
  undoTurn,
  deleteTurn,
  retryTurn,
  continueTurn,
  switchConversation,
  newConversation,
  cleanupAgentStore,
  type TurnNode,
} from './agentStore';

function src(id: string, available: boolean, reason?: string): ClientSourceInfo {
  return {
    id,
    displayName: id,
    version: '1.0.0',
    modelPolicy: 'catalog',
    available,
    modelCount: 1,
    ...(reason ? { unavailableReason: { code: 'unavailable', message: reason } } : {}),
  };
}

function makeTurn(id: string, status: TurnNode['status'], opts: Partial<TurnNode> = {}): TurnNode {
  return {
    id,
    parentTurnId: null,
    userMessage: 'q',
    blocks: [{ type: 'text', text: 'a' }],
    status,
    timestamp: Date.now(),
    sourceId: 'qoder',
    modelId: 'auto',
    ...opts,
  };
}

/** sendWs 捕获的出站消息列表 */
function sentMessages(): ClientMessage[] {
  return vi.mocked(sendWs).mock.calls.map((c) => c[0]);
}

/** 本轮新落的 error turn（排除已注入的 fixture） */
function errorTurns(excludeIds: string[]): TurnNode[] {
  return [...agentStore.turns.values()].filter(
    (t) => t.status === 'error' && !excludeIds.includes(t.id),
  );
}

beforeEach(() => {
  agentStore.turns.clear();
  agentStore.ui.clear();
  agentStore.turnCaps.clear();
  agentStore.sessionId = 'sess-1';
  agentStore.treeId = 'tree-1';
  agentStore.sources = [src('qoder', true)];
  agentStore.activeSourceId = 'qoder';
  agentStore.activeModelId = 'auto';
  vi.clearAllMocks();
});

describe('submitFromNode fork 前源可用性校验', () => {
  it('追问继承可用源 → 正常发送 session.send（源随线程）', () => {
    putTurn(makeTurn('p1', 'done', { sourceId: 'qoder' }));
    const id = submitFromNode('p1', '继续');
    expect(id).not.toBeNull();
    const send = sentMessages().find((m) => m.type === 'session.send');
    expect(send).toMatchObject({ sourceId: 'qoder', parentNodeId: 'p1' });
  });

  it('父线程源不可用 → 不发送，落 error turn 提示原因', () => {
    agentStore.sources = [src('qoder', true), src('codex', false, 'CLI 未安装')];
    putTurn(makeTurn('p1', 'done', { sourceId: 'codex' }));
    const id = submitFromNode('p1', '继续');
    expect(id).toBeNull();
    expect(sentMessages().filter((m) => m.type === 'session.send')).toHaveLength(0);
    const errs = errorTurns(['p1']);
    expect(errs).toHaveLength(1);
    expect(errs[0].parentTurnId).toBe('p1');
    const errBlock = errs[0].blocks.find((b) => b.type === 'error');
    expect(errBlock && 'message' in errBlock ? errBlock.message : '').toMatch(/codex/);
    expect(errBlock && 'message' in errBlock ? errBlock.message : '').toMatch(/CLI 未安装/);
  });

  it('父线程源已从配置移除 → 不发送，落 error turn', () => {
    putTurn(makeTurn('p1', 'done', { sourceId: 'gone' }));
    const id = submitFromNode('p1', '继续');
    expect(id).toBeNull();
    expect(sentMessages().filter((m) => m.type === 'session.send')).toHaveLength(0);
    const errs = errorTurns(['p1']);
    expect(errs).toHaveLength(1);
    const errBlock = errs[0].blocks.find((b) => b.type === 'error');
    expect(errBlock && 'message' in errBlock ? errBlock.message : '').toMatch(/gone/);
  });

  it('源目录未加载（sources 空）→ 不拦截（避免启动早期误伤）', () => {
    agentStore.sources = [];
    putTurn(makeTurn('p1', 'done', { sourceId: 'anything' }));
    const id = submitFromNode('p1', '继续');
    expect(id).not.toBeNull();
    expect(sentMessages().some((m) => m.type === 'session.send')).toBe(true);
  });

  it('root 提交（无父节点）不走线程源校验（activeSourceId 由选择层保证可用）', () => {
    agentStore.sources = [src('qoder', true), src('codex', false, 'CLI 未安装')];
    const id = submitFromNode(null, '新线程');
    expect(id).not.toBeNull();
    const send = sentMessages().find((m) => m.type === 'session.send');
    expect(send).toMatchObject({ sourceId: 'qoder', parentNodeId: null });
  });
});

describe('操作守卫（canApplyOperation，只读终态 no-op）', () => {
  it('undoTurn 对 undone 目标 no-op：不发送、状态不变', () => {
    putTurn(makeTurn('t1', 'undone'));
    undoTurn('t1');
    expect(sentMessages()).toHaveLength(0);
    expect(agentStore.turns.get('t1')!.status).toBe('undone');
  });

  it('undoTurn 对 hidden 目标 no-op', () => {
    putTurn(makeTurn('t1', 'hidden'));
    undoTurn('t1');
    expect(sentMessages()).toHaveLength(0);
    expect(agentStore.turns.get('t1')!.status).toBe('hidden');
  });

  it('deleteTurn 对 hidden 目标 no-op（不可重复删）', () => {
    putTurn(makeTurn('t1', 'hidden'));
    deleteTurn('t1');
    expect(sentMessages()).toHaveLength(0);
  });

  it('deleteTurn 对 undone 目标合法（undone→hidden）', () => {
    putTurn(makeTurn('t1', 'undone'));
    deleteTurn('t1');
    expect(sentMessages().some((m) => m.type === 'session.delete')).toBe(true);
    expect(agentStore.turns.get('t1')!.status).toBe('hidden');
  });

  it('retryTurn 对 undone 目标 no-op：不发送、blocks 不被清空', () => {
    putTurn(makeTurn('t1', 'undone', { blocks: [{ type: 'text', text: '历史回复' }] }));
    retryTurn('t1');
    expect(sentMessages()).toHaveLength(0);
    expect(agentStore.turns.get('t1')!.blocks).toHaveLength(1);
  });

  it('continueTurn 对 undone 目标 no-op', () => {
    putTurn(makeTurn('t1', 'undone'));
    continueTurn('t1');
    expect(sentMessages()).toHaveLength(0);
    expect(agentStore.turns.get('t1')!.status).toBe('undone');
  });

  it('undo 标记子树不复活 hidden 后代（shouldSkipDescendantMark）', () => {
    putTurn(makeTurn('t1', 'done'));
    putTurn(makeTurn('t2', 'hidden', { parentTurnId: 't1' }));
    putTurn(makeTurn('t3', 'done', { parentTurnId: 't1' }));
    undoTurn('t1');
    expect(agentStore.turns.get('t1')!.status).toBe('undone');
    expect(agentStore.turns.get('t2')!.status).toBe('hidden');
    expect(agentStore.turns.get('t3')!.status).toBe('undone');
  });
});

describe('节点删除/撤销清理他端在途流缓冲（liveStreams 传递性清理）', () => {
  beforeEach(() => {
    agentStore.turns.clear();
    agentStore.ui.clear();
    agentStore.turnCaps.clear();
    agentStore.sessionId = 'sess-1';
    agentStore.treeId = 'tree-1';
    agentStore.sources = [src('qoder', true)];
    agentStore.activeSourceId = 'qoder';
    agentStore.activeModelId = 'auto';
    resetLastAppliedRev();
    vi.clearAllMocks();
  });

  function userNode(id: string, parentId: string | null = null): ConversationNode {
    return {
      id,
      parentId,
      branchId: 'b',
      role: 'user',
      content: [{ type: 'text', text: `q-${id}` }],
      timestamp: 1,
    };
  }

  /** 快照携带 streaming 中间态 → turn 进入 streaming + liveStreams 注入条目 */
  function snapWithStreaming(nodes: ConversationNode[], requestIds: string[]): TreeSnapshotMessage {
    return {
      type: 'tree.snapshot',
      treeId: 'tree-1',
      rev: 1,
      nodes,
      branches: [],
      headNodeId: null,
      streaming: requestIds.map((id) => ({
        requestId: id,
        parentId: id,
        content: [{ type: 'text', text: '流式ing' }],
      })),
    };
  }

  it('deleteTurn 主动清理对应他端在途流缓冲（requestId===turnId）', () => {
    applySnapshot(snapWithStreaming([userNode('u1')], ['u1']));
    expect(agentStore.turns.get('u1')!.status).toBe('streaming');
    expect(__hasLiveStreamForTest('u1')).toBe(true);

    deleteTurn('u1'); // delete 守卫仅排除 hidden → streaming 合法
    expect(__hasLiveStreamForTest('u1'), 'deleteTurn 后 liveStream 条目清理').toBe(false);
    expect(agentStore.turns.get('u1')!.status).toBe('hidden');
  });

  it('undoTurn 主动清理对应他端在途流缓冲', () => {
    applySnapshot(snapWithStreaming([userNode('u1')], ['u1']));
    expect(__hasLiveStreamForTest('u1')).toBe(true);

    undoTurn('u1'); // undo 守卫仅排除只读终态 → streaming 合法
    expect(__hasLiveStreamForTest('u1'), 'undoTurn 后 liveStream 条目清理').toBe(false);
  });

  it('删除子树时递归清理子节点在途流缓冲', () => {
    applySnapshot(snapWithStreaming([userNode('u1'), userNode('u2', 'u1')], ['u1', 'u2']));
    expect(__hasLiveStreamForTest('u1')).toBe(true);
    expect(__hasLiveStreamForTest('u2')).toBe(true);

    deleteTurn('u1'); // 子树标 hidden → markLocalSubtree 递归清理
    expect(__hasLiveStreamForTest('u1')).toBe(false);
    expect(__hasLiveStreamForTest('u2'), '子节点 liveStream 同步清理').toBe(false);
  });
});

// ── 断连/会话切换清理：pendingPermissions + liveStreams 防孤儿/防残留 ──

describe('🔴 断连/切换清理（pendingPermissions + liveStreams）', () => {
  beforeEach(() => {
    agentStore.turns.clear();
    agentStore.ui.clear();
    agentStore.turnCaps.clear();
    agentStore.sessionId = 'sess-1';
    agentStore.treeId = 'tree-1';
    agentStore.sources = [src('qoder', true)];
    agentStore.activeSourceId = 'qoder';
    agentStore.activeModelId = 'auto';
    agentStore.pendingPermissions.clear();
    vi.clearAllMocks();
    // cleanupAgentStore 会停 GC，需在每轮测试前确保 GC 运行
    startLiveStreamGc();
  });

  /** 构造他端 stream.event（treeId 匹配但 turn 不存在 → 缓冲入 liveStreams） */
  function streamEvent(rid: string): StreamEventMessage {
    return {
      type: 'stream.event',
      treeId: 'tree-1',
      requestId: rid,
      event: { type: 'text', content: 'hello' },
    } as StreamEventMessage;
  }

  it('cleanupAgentStore 清空 pendingPermissions（页面卸载/登出不留孤儿）', () => {
    agentStore.pendingPermissions.set('perm-clean-1', {
      requestId: 'perm-clean-1',
      tool: 'writeFile',
      args: {},
      level: 'ask',
    });
    expect(agentStore.pendingPermissions.has('perm-clean-1')).toBe(true);

    cleanupAgentStore();

    expect(agentStore.pendingPermissions.size).toBe(0);
  });

  it('switchConversation 清空 liveStreams（防旧树条目残留至 TTL）', () => {
    handleStreamEvent(streamEvent('rid-sw-1'));
    expect(__hasLiveStreamForTest('rid-sw-1')).toBe(true);

    switchConversation('tree-new');

    expect(__hasLiveStreamForTest('rid-sw-1')).toBe(false);
  });

  it('newConversation 清空 liveStreams', () => {
    handleStreamEvent(streamEvent('rid-nc-1'));
    expect(__hasLiveStreamForTest('rid-nc-1')).toBe(true);

    newConversation();

    expect(__hasLiveStreamForTest('rid-nc-1')).toBe(false);
  });
});
