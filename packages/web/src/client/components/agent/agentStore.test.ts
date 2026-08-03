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
  isWsConnected: vi.fn(() => true),
  connectAgentWs: vi.fn(),
  disconnectAgentWs: vi.fn(),
  setStreamingTarget: vi.fn(),
  unsubscribeTree: vi.fn(),
  waitForSessionReady: vi.fn(() => new Promise<string>(() => {})),
  // 批次四：useConnectionState re-export 所需的接缝
  getConnectionState: vi.fn(() => ({ type: 'disconnected' as const })),
  connectionState$: { subscribe: () => ({ unsubscribe: () => {} }) },
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
  removeQueuedMessage,
  reorderQueuedMessage,
  editQueuedMessage,
  computeReorderIndex,
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

describe('submitFromNode 排队路径（streaming 期间入队）', () => {
  it('父 turn streaming → 发 queue.enqueue（非 session.send），不建本地 turn', () => {
    putTurn(makeTurn('p1', 'streaming', { sourceId: 'qoder' }));
    const id = submitFromNode('p1', '排队消息');
    expect(id, '不创建本地 turn').toBeNull();
    expect(sentMessages().filter((m) => m.type === 'session.send')).toHaveLength(0);
    const enq = sentMessages().find((m) => m.type === 'queue.enqueue') as
      | { anchorTurnId: string; message: string; mode: string }
      | undefined;
    expect(enq, '发 queue.enqueue').toBeTruthy();
    expect(enq!.anchorTurnId, '锚定 streaming 的父 turn').toBe('p1');
    expect(enq!.message).toBe('排队消息');
    expect(enq!.mode).toBe('queue');
    expect(agentStore.turns.size, '未新增 turn').toBe(1);
  });

  it('父 turn done → 正常 session.send（不入队）', () => {
    putTurn(makeTurn('p1', 'done', { sourceId: 'qoder' }));
    const id = submitFromNode('p1', '追问');
    expect(id).not.toBeNull();
    expect(sentMessages().filter((m) => m.type === 'queue.enqueue')).toHaveLength(0);
    expect(sentMessages().find((m) => m.type === 'session.send')).toBeTruthy();
  });
});

describe('排队队列 actions（queue.update 命令 + 排序索引计算）', () => {
  const qm = (id: string, order: number, anchor = 't1') => ({
    id,
    content: id,
    order,
    createdAt: order,
    createdBy: 'c1',
    mode: 'queue' as const,
    anchorTurnId: anchor,
  });

  beforeEach(() => {
    agentStore.queue = [];
  });

  it('removeQueuedMessage 发 queue.update remove', () => {
    removeQueuedMessage('m1');
    const upd = sentMessages().find((m) => m.type === 'queue.update') as {
      messageId: string;
      update: { action: string };
    };
    expect(upd.messageId).toBe('m1');
    expect(upd.update.action).toBe('remove');
  });

  it('reorderQueuedMessage 发 queue.update reorder（携带 newIndex）', () => {
    reorderQueuedMessage('m1', 2);
    const upd = sentMessages().find((m) => m.type === 'queue.update') as {
      update: { action: string; newIndex: number };
    };
    expect(upd.update).toMatchObject({ action: 'reorder', newIndex: 2 });
  });

  it('editQueuedMessage 发 queue.update edit；空内容不发送', () => {
    editQueuedMessage('m1', '新内容');
    const upd = sentMessages().find((m) => m.type === 'queue.update') as {
      update: { action: string; content: string };
    };
    expect(upd.update).toMatchObject({ action: 'edit', content: '新内容' });
    vi.clearAllMocks();
    editQueuedMessage('m1', '   ');
    expect(sentMessages().filter((m) => m.type === 'queue.update')).toHaveLength(0);
  });

  it('computeReorderIndex：移到组首位 / 组末位 / 组中间', () => {
    agentStore.queue = [qm('a', 0), qm('b', 1), qm('c', 2)];
    // c(组 idx2) 移到组 idx0 → 扁平 0
    expect(computeReorderIndex('c', 0, 't1')).toBe(0);
    // a(组 idx0) 移到组末（idx2）→ 移除后 [b,c]，插到 c 后 → 2
    expect(computeReorderIndex('a', 2, 't1')).toBe(2);
    // a(组 idx0) 移到组 idx1 → 移除后 [b,c]，插到 b 前… 目标组 idx1=c → 扁平 1
    expect(computeReorderIndex('a', 1, 't1')).toBe(1);
  });

  it('computeReorderIndex：跨锚点不交又时组内映射正确', () => {
    // 扁平：a(A) x(B) b(A)；A 组 = [a, b]
    agentStore.queue = [qm('a', 0, 'A'), qm('x', 1, 'B'), qm('b', 2, 'A')];
    // b 移到 A 组首位 → 移除后 [a, x]，目标组 idx0=a → 扁平 0
    expect(computeReorderIndex('b', 0, 'A')).toBe(0);
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
    agentStore.retryWarning = '';
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

// ── retryCounts 生命周期清理（批次四必修项 2）──

describe('🔴 retryCounts 生命周期清理', () => {
  beforeEach(() => {
    agentStore.turns.clear();
    agentStore.ui.clear();
    agentStore.turnCaps.clear();
    agentStore.sessionId = 'sess-1';
    agentStore.treeId = 'tree-1';
    agentStore.sources = [src('qoder', true)];
    agentStore.activeSourceId = 'qoder';
    agentStore.activeModelId = 'auto';
    agentStore.retryWarning = '';
    vi.clearAllMocks();
  });

  it('retryTurn 6 次触发 retryWarning（UI 警告）', () => {
    putTurn(makeTurn('t-retry', 'done'));
    // 前 5 次重试合法
    for (let i = 0; i < 5; i++) {
      retryTurn('t-retry');
      // 每次重试后拉回 done 以允许下次重试（retry 会改为 streaming）
      agentStore.turns.get('t-retry')!.status = 'done';
    }
    expect(agentStore.retryWarning).toBe('');
    // 第 6 次超限
    retryTurn('t-retry');
    expect(agentStore.retryWarning).toMatch(/已达重试上限/);
  });

  it('switchConversation 后 retryCounts 清空（重试计数重置）', () => {
    putTurn(makeTurn('t-retry2', 'done'));
    // 5 次重试消耗预算
    for (let i = 0; i < 5; i++) {
      retryTurn('t-retry2');
      agentStore.turns.get('t-retry2')!.status = 'done';
    }
    // 切换会话重置计数
    switchConversation('tree-2');

    // 新会话同 ID 重试应合法（retryCounts 已清空）
    agentStore.sessionId = 'sess-1'; // 恢复 session 以允许 retryTurn 执行
    putTurn(makeTurn('t-retry2', 'done'));
    retryTurn('t-retry2');
    // retryWarning 不应触发（因为计数已重置）
    expect(agentStore.retryWarning).toBe('');
  });

  it('newConversation 后 retryCounts 清空', () => {
    putTurn(makeTurn('t-retry3', 'done'));
    for (let i = 0; i < 5; i++) {
      retryTurn('t-retry3');
      agentStore.turns.get('t-retry3')!.status = 'done';
    }
    newConversation();

    agentStore.sessionId = 'sess-1'; // 恢复 session
    putTurn(makeTurn('t-retry3', 'done'));
    retryTurn('t-retry3');
    expect(agentStore.retryWarning).toBe('');
  });

  it('cleanupAgentStore 后 retryCounts 清空', () => {
    putTurn(makeTurn('t-retry4', 'done'));
    for (let i = 0; i < 5; i++) {
      retryTurn('t-retry4');
      agentStore.turns.get('t-retry4')!.status = 'done';
    }
    cleanupAgentStore();

    agentStore.sessionId = 'sess-1';
    putTurn(makeTurn('t-retry4', 'done'));
    retryTurn('t-retry4');
    expect(agentStore.retryWarning).toBe('');
  });
});
