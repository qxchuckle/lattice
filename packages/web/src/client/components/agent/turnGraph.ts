/**
 * turnGraph — turn 图构建（纯函数，可测试）
 *
 * 从 loadTree 抽离的核心数据逻辑：从持久化节点重建客户端 turn 视图。
 * 纯函数：不触碰 agentStore / fetch，入参传入、结果返回。
 * api.ts 的 loadTree 是调用这些纯函数 + 读写 store 的薄壳。
 */
import type { ConversationNode, NodeContent, SourceEvent } from '@qcqx/lattice-agent-protocol';
import { isReadOnly, applyEventToContent } from '@qcqx/lattice-agent-protocol';
import type { TurnNode } from './types';
import { deriveTurnStatus } from './turnState';

/**
 * 从持久化节点重建客户端 turn 视图。
 * - 新格式：user + assistant 配对（一个 user 节点 = 一个 turn，取其 active assistant 的内容）
 * - 旧格式兼容：只有 assistant 节点时，每个 assistant = 一个 turn
 */
export function buildTurnsFromNodes(nodes: ConversationNode[]): Map<string, TurnNode> {
  const turns = new Map<string, TurnNode>();
  const userNodes = nodes.filter((n) => n.role === 'user');

  if (userNodes.length > 0) {
    for (const un of userNodes) {
      // 一个 user 可能有多个 assistant 子节点（retry 后旧的被标记 undone），优先取 active 的
      const assistantChildren = nodes.filter((n) => n.role === 'assistant' && n.parentId === un.id);
      const assistant =
        assistantChildren.find((n) => !isReadOnly(n.status)) ?? assistantChildren[0];
      const userText = un.content?.find((c) => c.type === 'text')?.text ?? '';

      // 父 turn = 父 assistant 的父 user（user→assistant→user 链）
      let parentTurnId: string | null = null;
      if (un.parentId) {
        const parentAssistant = nodes.find((n) => n.id === un.parentId && n.role === 'assistant');
        parentTurnId = parentAssistant?.parentId ?? un.parentId;
      }

      const turn: TurnNode = {
        id: un.id,
        parentTurnId,
        userMessage: userText,
        blocks: assistant?.content ?? [],
        status: deriveTurnStatus(un, assistant),
        timestamp: un.timestamp,
        // 源/模型/参数标注：assistant 优先（实际回答方），回退 user 节点（prompt 前已落盘）
        sourceId: assistant?.agentId ?? un.agentId ?? 'qoder',
        modelId: assistant?.metadata?.model ?? un.metadata?.model ?? '',
        thinkingLevel: assistant?.metadata?.thinkingLevel ?? un.metadata?.thinkingLevel,
        contextWindow: assistant?.metadata?.contextWindow ?? un.metadata?.contextWindow,
        usage: assistant?.metadata?.usage,
      };
      turns.set(turn.id, turn);
    }
  } else {
    // 兼容旧格式：只有 assistant 节点
    for (const an of nodes.filter((n) => n.role === 'assistant')) {
      const text = an.content?.find((c) => c.type === 'text')?.text ?? '';
      const turn: TurnNode = {
        id: an.id,
        parentTurnId: an.parentId,
        userMessage: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
        blocks: an.content ?? [],
        status: 'done',
        timestamp: an.timestamp,
        sourceId: an.agentId ?? 'qoder',
        modelId: an.metadata?.model ?? '',
        usage: an.metadata?.usage,
      };
      turns.set(turn.id, turn);
    }
  }

  return turns;
}

/**
 * 恢复在途流式 turn 的内容：server 端尚未落盘时，以客户端实时累积为准。
 * 仅恢复「重建后无内容且非只读」的 turn（避免覆盖已落盘内容或复活只读节点）。
 */
export function restoreStreamingTurns(
  turns: Map<string, TurnNode>,
  liveStreaming: Map<string, NodeContent[]>,
): void {
  for (const [id, blocks] of liveStreaming) {
    const turn = turns.get(id);
    if (turn && turn.blocks.length === 0 && turn.status !== 'undone' && turn.status !== 'hidden') {
      turn.blocks = [...blocks];
      turn.status = 'streaming';
    }
  }
}

/** 填充中断的 streaming（上次未完成的回复，崩溃恢复用） */
export function fillInterruptedStreams(
  turns: Map<string, TurnNode>,
  streams: { requestId: string; parentId: string; content: NodeContent[] }[],
): void {
  for (const stream of streams) {
    const turn = turns.get(stream.parentId);
    if (turn && turn.blocks.length === 0) {
      turn.blocks = stream.content;
      turn.status = 'interrupted';
    }
  }
}

/**
 * 将流式事件应用到 turn（纯函数：只改传入的 turn，不碰全局 store / streamingMap）。
 * 内容累积复用 protocol 的 applyEventToContent（与 server 同一实现）；
 * 终态（done/error）更新 turn 状态。
 */
export function applyStreamEvent(turn: TurnNode, event: SourceEvent): void {
  applyEventToContent(turn.blocks, event);
  if (event.type === 'done') {
    turn.status = 'done';
    turn.usage = event.usage;
  } else if (event.type === 'error') {
    turn.status = 'error';
  }
}

/** 可见 turn（排除 hidden/已删除——delete = 树中不展示） */
export function getVisibleTurns(turns: TurnNode[]): TurnNode[] {
  return turns.filter((t) => t.status !== 'hidden');
}

/** 某 turn 的可见子 turn ID（排除 hidden，按时间序） */
export function getVisibleChildIds(turns: TurnNode[], turnId: string): string[] {
  return turns
    .filter((t) => t.parentTurnId === turnId && t.status !== 'hidden')
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((t) => t.id);
}
