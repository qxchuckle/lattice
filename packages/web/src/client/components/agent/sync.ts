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
import { advanceViewStatus, isTerminalViewStatus } from '@qcqx/lattice-agent-protocol';
import { agentStore, putTurn, ensureUi } from './store';
import { buildTurnsFromNodes } from './turnGraph';
import { isStreamingStatus } from './turnState';
import type { TurnNode, ConversationEntry } from './types';

/** 他端在途流缓冲 TTL：超时视为异常中止，丢弃缓冲 */
const LIVE_STREAM_TTL_MS = 5 * 60_000; // 5 分钟

/** 他端在途流的实时累积：requestId → { blocks: 已生成内容, at: 最后更新时间 } */
const liveStreams = new Map<string, { blocks: NodeContent[]; at: number }>();

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
 * expectedNextRev 仅作新鲜度提示（warn）不跳过：全量快照总是安全可应用，跳过会丢节点。
 * 流式保护：本端正在流式的 turn（status streaming）保留 live blocks，不被快照（未落盘全）覆盖。
 */
export function applySnapshot(msg: TreeSnapshotMessage, force = false): void {
  if (msg.treeId !== agentStore.treeId) return; // 非当前树（已切换）忽略
  // 新鲜度提示：expectedNextRev（服务端构建时 rev+1）不高于已应用 rev → 构建期间又有新变更。
  // 仅 warn 不跳过：快照是全量的，应用旧快照至多短暂回退，后续快照会推回最新；
  // 若因此跳过 rev 更新的快照，其中独有的节点会永久丢失。
  if (!force && msg.expectedNextRev !== undefined && msg.expectedNextRev <= lastAppliedRev) {
    console.warn(
      '[snapshot] Snapshot built before newer updates (expectedNextRev=%d, currentRev=%d), applying anyway',
      msg.expectedNextRev,
      lastAppliedRev,
    );
  }
  // rev 守卫：undefined rev（服务端旧版/特殊快照）→ (undefined <= N) === false → 不跳过，安全应用
  // lastAppliedRev 只由已应用的全量快照推进，被跳过的旧快照必已被更新全量覆盖，不丢节点
  if (!force && msg.rev <= lastAppliedRev) return;
  lastAppliedRev = Math.max(lastAppliedRev, msg.rev ?? 0);

  const turns = buildTurnsFromNodes(msg.nodes as ConversationNode[]);

  // 保护本端在途流式 turn：快照重建不得覆盖未落盘的 live 累积
  for (const [id, t] of turns) {
    const cur = agentStore.turns.get(id);
    if (cur && isStreamingStatus(cur.status)) {
      t.blocks = cur.blocks;
      t.status = 'streaming';
    }
  }

  // 恢复他端在途流（快照含 streaming 中间态 + 本地 live 累积）
  for (const s of msg.streaming ?? []) {
    const turn = turns.get(s.parentId);
    if (turn && turn.blocks.length === 0 && !isTerminalViewStatus(turn.status)) {
      turn.blocks = [...s.content];
      turn.status = 'streaming';
    }
    liveStreams.set(s.requestId, { blocks: [...s.content], at: Date.now() });
  }
  // 遍历 liveStreams 时顺手清理过期条目（TTL 防异常中止流缓冲永久驻留）
  const now = Date.now();
  for (const [rid, entry] of liveStreams) {
    if (now - entry.at > LIVE_STREAM_TTL_MS) {
      liveStreams.delete(rid); // 过期丢弃
      continue;
    }
    const turn = turns.get(rid);
    if (turn && turn.blocks.length === 0 && !isTerminalViewStatus(turn.status)) {
      turn.blocks = [...entry.blocks];
      turn.status = 'streaming';
    }
  }

  agentStore.turns.clear();
  for (const [id, turn] of turns) {
    putTurn(turn);
    ensureUi(id);
  }
  // 能力数据驱动：server 已按同一守卫函数算好，client 直接存下备渲染（不重算）
  if (msg.turnCapabilities) {
    agentStore.turnCaps.clear();
    for (const [turnId, caps] of Object.entries(msg.turnCapabilities)) {
      agentStore.turnCaps.set(turnId, caps);
    }
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
    let entry = liveStreams.get(msg.requestId);
    if (!entry) {
      entry = { blocks: [], at: Date.now() };
      liveStreams.set(msg.requestId, entry);
    }
    entry.at = Date.now(); // 刷新时间戳（防 TTL 过期）
    applyEventToContent(entry.blocks, msg.event as SourceEvent);
    return;
  }
  if (isTerminalViewStatus(turn.status)) return; // 终止态守卫（状态机单一真相）
  const ev = msg.event as SourceEvent;
  // 他端流 delta 到达时提升为 streaming：快照重建的 turn 默认 'done'（assistant 未落盘），
  // 不提升会导致他端流式期间思考块不展开/无实时计时、无光标、无停止按钮
  if (ev.type !== 'done' && ev.type !== 'error') {
    const next = advanceViewStatus(turn.status, 'start');
    if (next !== turn.status) {
      turn.status = next;
      agentStore.version++;
    }
  }
  applyEventToContent(turn.blocks, ev);
  if (ev.type === 'done') {
    turn.status = advanceViewStatus(turn.status, 'done');
    turn.usage = ev.usage;
    liveStreams.delete(msg.requestId);
    agentStore.version++;
  } else if (ev.type === 'error') {
    turn.status = advanceViewStatus(turn.status, 'error');
    liveStreams.delete(msg.requestId);
    agentStore.version++;
  }
}

/** 他端流被中止（撤销/删除/显式停止） */
export function handleStreamAborted(msg: StreamAbortedMessage): void {
  if (msg.treeId !== agentStore.treeId) return;
  const turn = agentStore.turns.get(msg.requestId) as TurnNode | undefined;
  if (turn) {
    const next = advanceViewStatus(turn.status, 'abort'); // 仅 streaming → interrupted
    if (next !== turn.status) {
      turn.status = next;
      agentStore.version++;
    }
  }
  liveStreams.delete(msg.requestId);
}

/** 在场端列表（presence） */
export function handlePresenceState(msg: PresenceStateMessage): void {
  if (msg.treeId !== agentStore.treeId) return;
  agentStore.peers = msg.peers as PresenceState[];
}

// ── 他端在途流缓冲 GC（定时回收超期条目，防内存泄漏） ──

/** GC 扫描周期：每分钟一次（与心跳 timer 同量级，低频扫描小 Map） */
const LIVE_STREAM_GC_INTERVAL_MS = 60_000;

let liveStreamGcTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 清理超期他端在途流缓冲（at + LIVE_STREAM_TTL_MS < now），并同步移除对应 turn 的孤儿
 * streaming 占位：turn 仍停 streaming 但对应在途流已超期未收到 done/error/abort，
 * 视为异常中止 → 转 interrupted（与 handleStreamAborted 同一处置，状态机单一真相）。
 */
export function gcLiveStreams(): void {
  const now = Date.now();
  for (const [rid, entry] of liveStreams) {
    if (now - entry.at > LIVE_STREAM_TTL_MS) {
      liveStreams.delete(rid);
      // 同步移除对应 turn 的孤儿 streaming 占位（与 handleStreamAborted 同一处置）：
      // 在途流超期未收到 done/error/abort → turn 仍停 streaming 视为异常中止 → interrupted
      const turn = agentStore.turns.get(rid) as TurnNode | undefined;
      if (turn && isStreamingStatus(turn.status)) {
        turn.status = advanceViewStatus(turn.status, 'abort');
        agentStore.version++;
      }
    }
  }
}

/** 启动周期 GC（模块加载时自动启动；测试可手动调用）。幂等：重复调用无副作用。 */
export function startLiveStreamGc(): void {
  if (liveStreamGcTimer !== null) return;
  liveStreamGcTimer = setInterval(gcLiveStreams, LIVE_STREAM_GC_INTERVAL_MS);
}

/** 停止周期 GC（模块清理/卸载时调用）。幂等。 */
export function stopLiveStreamGc(): void {
  if (liveStreamGcTimer !== null) {
    clearInterval(liveStreamGcTimer);
    liveStreamGcTimer = null;
  }
}

/**
 * 主动清理指定 requestId 的他端在途流缓冲。
 * 节点删除/撤销（deleteTurn/undoTurn）时调用——对应流不再需要，防残留驻留至 TTL。
 */
export function clearLiveStream(requestId: string): void {
  liveStreams.delete(requestId);
}

/** 仅测试用：查询 liveStreams 是否含某 requestId（不导出给生产消费方） */
export function __hasLiveStreamForTest(requestId: string): boolean {
  return liveStreams.has(requestId);
}

// 模块加载时启动周期 GC（生产/测试 jsdom 环境；fake timers 由测试接管）
if (typeof window !== 'undefined') {
  startLiveStreamGc();
}
