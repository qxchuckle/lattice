/**
 * sync — 多端同步接收端（框架无关：仅依赖 valtio store + 纯函数，可移植 app/vscode）
 *
 * 消费 server 广播的 tree.snapshot / stream.event / stream.aborted / presence.state：
 *   - tree.snapshot：全量重建 turns（含在途流式中间态补齐）
 *   - stream.event：其他端发起的流式 delta 实时渲染（按 requestId===turnId 路由）
 *   - stream.aborted：其他端的流被中止 → 标 interrupted
 *   - presence.state：在场端列表
 * 发起端自身流走 legacy 'event' 路径（server 广播已排除发起连接），此处只处理"他端"。
 */
import type {
  SourceEvent,
  NodeContent,
  ConversationNode,
  PresenceState,
  TreeSnapshotMessage,
  StreamEventMessage,
  StreamAbortedMessage,
  PresenceStateMessage,
} from '@qcqx/lattice-agent-protocol';
import { applyEventToContent } from '@qcqx/lattice-agent-protocol';
import { agentStore, putTurn, ensureUi } from './store';
import { buildTurnsFromNodes } from './turnGraph';
import type { TurnNode, ConversationEntry } from './types';

/** 他端在途流的实时累积：requestId → 已生成内容（快照到达前的缓冲） */
const liveStreams = new Map<string, NodeContent[]>();

/** 已应用的最高 rev（快照/重载共用，防旧状态覆盖新状态的丢失更新） */
let lastAppliedRev = 0;
export function getLastAppliedRev(): number {
  return lastAppliedRev;
}
export function resetLastAppliedRev(): void {
  lastAppliedRev = 0;
}

/**
 * 应用全量快照：重建 turns + 恢复他端在途流 + 刷新 peers。
 * rev 守卫：跳过不新于已应用的快照（防乱序/重复覆盖）；force=true 时强制（reject 回滚）。
 * 流式保护：本端正在流式的 turn（status streaming）保留 live blocks，不被快照（未落盘全）覆盖。
 */
export function applySnapshot(msg: TreeSnapshotMessage, force = false): void {
  if (msg.treeId !== agentStore.treeId) return; // 非当前树（已切换）忽略
  if (!force && msg.rev <= lastAppliedRev) return;
  lastAppliedRev = Math.max(lastAppliedRev, msg.rev);

  const turns = buildTurnsFromNodes(msg.nodes as ConversationNode[]);

  // 保护本端在途流式 turn：快照重建不得覆盖未落盘的 live 累积
  for (const [id, t] of turns) {
    const cur = agentStore.turns.get(id);
    if (cur && cur.status === 'streaming') {
      t.blocks = cur.blocks;
      t.status = 'streaming';
    }
  }

  // 恢复他端在途流（快照含 streaming 中间态 + 本地 live 累积）
  for (const s of msg.streaming ?? []) {
    const turn = turns.get(s.parentId);
    if (turn && turn.blocks.length === 0 && turn.status !== 'undone' && turn.status !== 'hidden') {
      turn.blocks = [...s.content];
      turn.status = 'streaming';
    }
    liveStreams.set(s.requestId, [...s.content]);
  }
  for (const [rid, blocks] of liveStreams) {
    const turn = turns.get(rid);
    if (turn && turn.blocks.length === 0 && turn.status !== 'undone' && turn.status !== 'hidden') {
      turn.blocks = [...blocks];
      turn.status = 'streaming';
    }
  }

  agentStore.turns.clear();
  for (const [id, turn] of turns) {
    putTurn(turn);
    ensureUi(id);
  }
  // 会话列表元数据增量更新（免每次变更走 REST 拉列表）
  if (msg.conversation) {
    const c = msg.conversation;
    const list = agentStore.conversations;
    const i = list.findIndex((x) => x.treeId === c.treeId);
    const entry: ConversationEntry = {
      treeId: c.treeId,
      title: c.title,
      nodeCount: c.nodeCount,
      updatedAt: c.updatedAt,
    };
    if (i >= 0) list[i] = entry;
    else list.unshift(entry);
  }
  agentStore.version++;
}

/** 他端流式 delta：路由到对应 turn（requestId===turnId）；turn 未到则缓冲待快照补齐 */
export function handleStreamEvent(msg: StreamEventMessage): void {
  if (msg.treeId !== agentStore.treeId) return;
  const turn = agentStore.turns.get(msg.requestId) as TurnNode | undefined;
  if (!turn) {
    let arr = liveStreams.get(msg.requestId);
    if (!arr) {
      arr = [];
      liveStreams.set(msg.requestId, arr);
    }
    applyEventToContent(arr, msg.event as SourceEvent);
    return;
  }
  if (turn.status === 'undone' || turn.status === 'hidden') return;
  applyEventToContent(turn.blocks, msg.event as SourceEvent);
  const ev = msg.event as SourceEvent;
  if (ev.type === 'done') {
    turn.status = 'done';
    turn.usage = ev.usage;
    liveStreams.delete(msg.requestId);
    agentStore.version++;
  } else if (ev.type === 'error') {
    turn.status = 'error';
    liveStreams.delete(msg.requestId);
    agentStore.version++;
  }
}

/** 他端流被中止（撤销/删除/显式停止） */
export function handleStreamAborted(msg: StreamAbortedMessage): void {
  if (msg.treeId !== agentStore.treeId) return;
  const turn = agentStore.turns.get(msg.requestId) as TurnNode | undefined;
  if (turn && turn.status === 'streaming') {
    turn.status = 'interrupted';
    agentStore.version++;
  }
  liveStreams.delete(msg.requestId);
}

/** 在场端列表（presence） */
export function handlePresenceState(msg: PresenceStateMessage): void {
  if (msg.treeId !== agentStore.treeId) return;
  agentStore.peers = msg.peers as PresenceState[];
}
