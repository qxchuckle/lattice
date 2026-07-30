/**
 * sync 多端同步接收端测试（框架无关纯逻辑）
 *
 * 覆盖：tree.snapshot 重建 + 在途流恢复、stream.event 路由/缓冲/只读守卫、
 * stream.aborted 中止、presence.state。直接操作 agentStore（valtio proxy）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ConversationNode,
  TreeSnapshotMessage,
  StreamEventMessage,
  StreamAbortedMessage,
  PresenceStateMessage,
} from '@qcqx/lattice-agent-protocol';
import { agentStore, putTurn } from './store';
import {
  applySnapshot,
  handleStreamEvent,
  handleStreamAborted,
  handlePresenceState,
  resetLastAppliedRev,
} from './sync';
import type { TurnNode } from './types';

const TREE = 'tree-sync-test';

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
function assistantNode(id: string, parentId: string, text: string): ConversationNode {
  return {
    id,
    parentId,
    branchId: 'b',
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 2,
  };
}
function snapshot(
  nodes: ConversationNode[],
  streaming?: TreeSnapshotMessage['streaming'],
): TreeSnapshotMessage {
  return {
    type: 'tree.snapshot',
    treeId: TREE,
    rev: 1,
    nodes,
    branches: [],
    headNodeId: null,
    streaming,
  };
}

describe('sync.applySnapshot', () => {
  beforeEach(() => {
    resetLastAppliedRev();
    agentStore.treeId = TREE;
    agentStore.turns.clear();
    agentStore.peers = [];
  });

  it('从快照节点重建 turns', () => {
    applySnapshot(snapshot([userNode('u1'), assistantNode('a1', 'u1', '回答')]));
    const turn = agentStore.turns.get('u1');
    expect(turn, 'user 节点 → turn').toBeTruthy();
    expect(turn!.userMessage).toBe('q-u1');
    expect((turn!.blocks[0] as { text: string }).text).toBe('回答');
  });

  it('快照携带的 turnCapabilities 写入 store（能力数据驱动：client 不重算）', () => {
    const caps = {
      canBranch: true,
      canUndo: true,
      canDelete: true,
      canRetry: false,
      canContinue: false,
      canFollowup: true,
      canAbort: false,
    };
    agentStore.turnCaps.clear();
    // 旧能力项应被整表替换（server 是全量下发，残留会让已删节点的能力鬼影存活）
    agentStore.turnCaps.set('ghost', caps);
    applySnapshot({ ...snapshot([userNode('u1')]), turnCapabilities: { u1: caps } });
    expect(agentStore.turnCaps.get('u1')).toEqual(caps);
    expect(agentStore.turnCaps.has('ghost'), '全量替换，不残留旧项').toBe(false);
  });

  it('快照未带 turnCapabilities 时保留现有能力表（兼容可选字段）', () => {
    const caps = {
      canBranch: false,
      canUndo: false,
      canDelete: true,
      canRetry: false,
      canContinue: false,
      canFollowup: false,
      canAbort: false,
    };
    agentStore.turnCaps.clear();
    agentStore.turnCaps.set('u1', caps);
    applySnapshot(snapshot([userNode('u1')]));
    expect(agentStore.turnCaps.get('u1'), '未下发则不清空（避免闪烁回本地投影）').toEqual(caps);
  });

  it('恢复快照携带的在途流中间态', () => {
    applySnapshot(
      snapshot(
        [userNode('u1')],
        [{ requestId: 'u1', parentId: 'u1', content: [{ type: 'text', text: '流式ing' }] }],
      ),
    );
    const turn = agentStore.turns.get('u1');
    expect(turn!.status, '在途流 → streaming').toBe('streaming');
    expect((turn!.blocks[0] as { text: string }).text).toBe('流式ing');
  });

  it('忽略非当前树的快照（已切换对话）', () => {
    resetLastAppliedRev();
    agentStore.treeId = 'other-tree';
    applySnapshot(snapshot([userNode('u1')]));
    expect(agentStore.turns.size, '非当前树快照不应用').toBe(0);
  });

  it('rev 守卫：跳过不新于已应用的快照（防丢失更新）', () => {
    const snap5: TreeSnapshotMessage = { ...snapshot([userNode('u1')]), rev: 5 };
    const snap3: TreeSnapshotMessage = {
      ...snapshot([userNode('u1'), userNode('u2')]),
      rev: 3,
    };
    applySnapshot(snap5);
    applySnapshot(snap3); // 旧快照不得覆盖新状态
    expect(agentStore.turns.has('u2'), 'rev 3 旧快照被跳过').toBe(false);
  });

  it('force 绕过 rev 守卫（reject 回滚）', () => {
    applySnapshot({ ...snapshot([userNode('u1')]), rev: 5 });
    applySnapshot({ ...snapshot([userNode('u1'), userNode('u2')]), rev: 5 }, true);
    expect(agentStore.turns.has('u2'), 'force 同 rev 也重建').toBe(true);
  });

  it('expectedNextRev 仅 warn 不跳过：rev 更新的快照必须应用（防节点永久丢失）', () => {
    applySnapshot({ ...snapshot([userNode('u1')]), rev: 6, expectedNextRev: 7 });
    // 构建耗时期间发生新变更 → expectedNextRev 滞后，但 rev 更新且含新节点 u2
    applySnapshot({ ...snapshot([userNode('u1'), userNode('u2')]), rev: 7, expectedNextRev: 5 });
    expect(agentStore.turns.has('u2'), 'expectedNextRev 滞后不得跳过更新快照').toBe(true);
  });

  it('流式保护：本端 streaming turn 的 live blocks 不被快照覆盖', () => {
    putTurn({
      id: 'u1',
      parentTurnId: null,
      userMessage: 'q',
      blocks: [{ type: 'text', text: 'live累积' }],
      status: 'streaming',
      timestamp: 1,
      sourceId: 'qoder',
      modelId: '',
    } as TurnNode);
    // 快照里 u1 的 assistant 尚未落盘（空），不得覆盖 live 累积
    applySnapshot({ ...snapshot([userNode('u1')]), rev: 9 });
    const turn = agentStore.turns.get('u1');
    expect(turn!.status, 'streaming 状态保留').toBe('streaming');
    expect((turn!.blocks[0] as { text: string }).text).toBe('live累积');
  });

  it('会话列表元数据增量更新（免 REST 拉列表）', () => {
    agentStore.conversations = [];
    applySnapshot({
      ...snapshot([userNode('u1')]),
      rev: 1,
      conversation: { treeId: TREE, title: '对话A', nodeCount: 1, updatedAt: 100 },
    });
    expect(agentStore.conversations.length).toBe(1);
    expect(agentStore.conversations[0].title).toBe('对话A');
    // 同树再次快照 → 更新而非新增
    applySnapshot({
      ...snapshot([userNode('u1'), userNode('u2')]),
      rev: 2,
      conversation: { treeId: TREE, title: '对话A', nodeCount: 2, updatedAt: 200 },
    });
    expect(agentStore.conversations.length, '同树 upsert 不重复').toBe(1);
    expect(agentStore.conversations[0].nodeCount).toBe(2);
  });
});

describe('sync.handleStreamEvent', () => {
  beforeEach(() => {
    resetLastAppliedRev();
    agentStore.treeId = TREE;
    agentStore.turns.clear();
  });

  function streamingTurn(id: string): void {
    putTurn({
      id,
      parentTurnId: null,
      userMessage: 'q',
      blocks: [],
      status: 'streaming',
      timestamp: 1,
      sourceId: 'qoder',
      modelId: '',
    } as TurnNode);
  }
  function evt(requestId: string, content: string): StreamEventMessage {
    return { type: 'stream.event', treeId: TREE, requestId, event: { type: 'text', content } };
  }

  it('按 requestId===turnId 路由 delta 到对应 turn', () => {
    streamingTurn('u1');
    handleStreamEvent(evt('u1', '你好'));
    expect((agentStore.turns.get('u1')!.blocks[0] as { text: string }).text).toBe('你好');
  });

  it('turn 未到时缓冲，快照到达后补齐', () => {
    handleStreamEvent(evt('u2', '先到的流')); // turn 尚未由快照建立
    applySnapshot(snapshot([userNode('u2')]));
    const turn = agentStore.turns.get('u2');
    expect(turn!.status).toBe('streaming');
    expect((turn!.blocks[0] as { text: string }).text).toBe('先到的流');
  });

  it('done 事件转 done 状态', () => {
    streamingTurn('u1');
    handleStreamEvent({
      type: 'stream.event',
      treeId: TREE,
      requestId: 'u1',
      event: { type: 'done' },
    });
    expect(agentStore.turns.get('u1')!.status).toBe('done');
  });

  it('快照重建的 done turn 收到他端流 delta → 提升为 streaming', () => {
    // 快照先到（user 节点无 assistant 子 → 投影 done），他端流随后到
    applySnapshot(snapshot([userNode('u1')]));
    expect(agentStore.turns.get('u1')!.status).toBe('done');
    handleStreamEvent(evt('u1', '他端流'));
    expect(agentStore.turns.get('u1')!.status, '他端流式期间应为 streaming').toBe('streaming');
    expect((agentStore.turns.get('u1')!.blocks[0] as { text: string }).text).toBe('他端流');
  });

  it('只读 turn 丢弃迟到流事件（防 done 复活已删节点）', () => {
    putTurn({
      id: 'u1',
      parentTurnId: null,
      userMessage: 'q',
      blocks: [],
      status: 'hidden',
      timestamp: 1,
      sourceId: 'qoder',
      modelId: '',
    } as TurnNode);
    handleStreamEvent({
      type: 'stream.event',
      treeId: TREE,
      requestId: 'u1',
      event: { type: 'done' },
    });
    expect(agentStore.turns.get('u1')!.status, 'hidden 不被 done 改回').toBe('hidden');
  });
});

describe('sync.handleStreamAborted', () => {
  beforeEach(() => {
    resetLastAppliedRev();
    agentStore.treeId = TREE;
    agentStore.turns.clear();
  });

  it('streaming turn 被中止 → interrupted', () => {
    putTurn({
      id: 'u1',
      parentTurnId: null,
      userMessage: 'q',
      blocks: [],
      status: 'streaming',
      timestamp: 1,
      sourceId: 'qoder',
      modelId: '',
    } as TurnNode);
    handleStreamAborted({
      type: 'stream.aborted',
      treeId: TREE,
      requestId: 'u1',
      reason: 'undo',
    } as StreamAbortedMessage);
    expect(agentStore.turns.get('u1')!.status).toBe('interrupted');
  });

  it('非 streaming 状态不受影响', () => {
    putTurn({
      id: 'u1',
      parentTurnId: null,
      userMessage: 'q',
      blocks: [],
      status: 'undone',
      timestamp: 1,
      sourceId: 'qoder',
      modelId: '',
    } as TurnNode);
    handleStreamAborted({
      type: 'stream.aborted',
      treeId: TREE,
      requestId: 'u1',
      reason: 'undo',
    } as StreamAbortedMessage);
    expect(agentStore.turns.get('u1')!.status).toBe('undone');
  });
});

describe('sync.handlePresenceState', () => {
  beforeEach(() => {
    resetLastAppliedRev();
    agentStore.treeId = TREE;
    agentStore.peers = [];
  });

  it('写入当前树的 peers', () => {
    handlePresenceState({
      type: 'presence.state',
      treeId: TREE,
      peers: [{ connectionId: 'c1', clientKind: 'web' }],
    } as PresenceStateMessage);
    expect(agentStore.peers.length).toBe(1);
    expect(agentStore.peers[0].connectionId).toBe('c1');
  });

  it('忽略非当前树的 presence', () => {
    handlePresenceState({
      type: 'presence.state',
      treeId: 'other',
      peers: [{ connectionId: 'c1', clientKind: 'web' }],
    } as PresenceStateMessage);
    expect(agentStore.peers.length).toBe(0);
  });
});

describe('sync 会话切换竞态防护（treeId 守卫贯穿全部入口）', () => {
  beforeEach(() => {
    resetLastAppliedRev();
    agentStore.turns.clear();
    agentStore.peers = [];
  });

  /** 构造指定 treeId 的快照（snapshot() 默认 treeId=TREE，竞态测试需自定义） */
  const snapFor = (
    treeId: string,
    nodes: ConversationNode[],
    rev: number,
  ): TreeSnapshotMessage => ({
    type: 'tree.snapshot',
    treeId,
    rev,
    nodes,
    branches: [],
    headNodeId: null,
  });

  it('切树后旧树的快照/流式/中止/presence 全部被丢弃', () => {
    agentStore.treeId = 'Y';

    // 旧树 X 的在途消息迟到 → 不得污染当前树 Y
    applySnapshot(snapFor('X', [userNode('old')], 99), true);
    handleStreamEvent({
      type: 'stream.event',
      treeId: 'X',
      requestId: 'old',
      event: { type: 'text', content: 'x' },
    });
    handleStreamAborted({ type: 'stream.aborted', treeId: 'X', requestId: 'old', reason: 'undo' });
    handlePresenceState({
      type: 'presence.state',
      treeId: 'X',
      peers: [{ connectionId: 'c', clientKind: 'web' }],
    });

    expect(agentStore.turns.size, '旧树快照/流式不写入当前树').toBe(0);
    expect(agentStore.peers.length, '旧树 presence 不写入').toBe(0);
  });

  it('当前树的消息正常应用（守卫按当前 treeId 动态判定）', () => {
    agentStore.treeId = 'Y';
    applySnapshot(snapFor('Y', [userNode('y1')], 1), true);
    expect(agentStore.turns.has('y1'), '当前树快照应用').toBe(true);

    // 切到 X 后 Y 的消息变“旧树”被丢弃
    agentStore.treeId = 'X';
    applySnapshot(snapFor('Y', [userNode('y2')], 2), true);
    expect(agentStore.turns.has('y2'), '切走后旧树快照被丢弃').toBe(false);
  });
});
