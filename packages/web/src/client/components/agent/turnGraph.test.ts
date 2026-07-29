/**
 * client 纯函数测试（turnGraph / agentLayout）
 *
 * 由 scripts/verify-turn-graph.mts 迁移。
 * 覆盖 loadTree / handleSourceEvent / AgentCanvas 抽离的数据逻辑。
 */
import { describe, it, expect } from 'vitest';
import {
  buildTurnsFromNodes,
  restoreStreamingTurns,
  fillInterruptedStreams,
  applyStreamEvent,
  getVisibleTurns,
  getVisibleChildIds,
} from './turnGraph';
import { layoutTree } from './agentLayout';
import type { ConversationNode, NodeStatus } from '@qcqx/lattice-agent-protocol';
import type { TurnNode } from './types';

function node(
  id: string,
  role: 'user' | 'assistant',
  opts: {
    parentId?: string | null;
    status?: NodeStatus;
    text?: string;
    agentId?: string;
    metadata?: ConversationNode['metadata'];
  } = {},
): ConversationNode {
  return {
    id,
    parentId: opts.parentId ?? null,
    branchId: 'b',
    role,
    content: [{ type: 'text', text: opts.text ?? id }],
    timestamp: Number(id.replace(/\D/g, '')) || 0,
    status: opts.status,
    agentId: opts.agentId,
    metadata: opts.metadata,
  };
}

function turn(partial: Partial<TurnNode> & { id: string }): TurnNode {
  return {
    parentTurnId: null,
    userMessage: '',
    blocks: [],
    status: 'done',
    timestamp: 0,
    sourceId: 'qoder',
    modelId: '',
    ...partial,
  };
}

describe('buildTurnsFromNodes（nodes→turns 重建）', () => {
  it('简单配对：1 个 user+assistant → 1 个 turn', () => {
    const turns = buildTurnsFromNodes([
      node('u1', 'user'),
      node('a1', 'assistant', { parentId: 'u1', text: '回答' }),
    ]);
    expect(turns.size).toBe(1);
    const t1 = turns.get('u1')!;
    expect(t1.blocks.length).toBe(1);
    expect((t1.blocks[0] as { text: string }).text, 'turn.blocks = assistant 内容').toBe('回答');
    expect(t1.status, '正常完成 → done').toBe('done');
    expect(t1.parentTurnId, '顶级 turn parentTurnId = null').toBeNull();
  });

  it('链式：u2.parentTurnId = u1（经 a1）', () => {
    const turns = buildTurnsFromNodes([
      node('u1', 'user'),
      node('a1', 'assistant', { parentId: 'u1' }),
      node('u2', 'user', { parentId: 'a1' }),
      node('a2', 'assistant', { parentId: 'u2' }),
    ]);
    expect(turns.get('u2')!.parentTurnId).toBe('u1');
  });

  it('retry 后多 assistant：优先取 active', () => {
    const turns = buildTurnsFromNodes([
      node('u1', 'user'),
      node('a-old', 'assistant', { parentId: 'u1', status: 'undone', text: '旧' }),
      node('a-new', 'assistant', { parentId: 'u1', text: '新' }),
    ]);
    expect((turns.get('u1')!.blocks[0] as { text: string }).text).toBe('新');
  });

  it('状态投影：interrupted / error', () => {
    const ti = buildTurnsFromNodes([
      node('u1', 'user'),
      node('a1', 'assistant', { parentId: 'u1', status: 'interrupted' }),
    ]);
    expect(ti.get('u1')!.status).toBe('interrupted');

    const errNode = node('a1', 'assistant', { parentId: 'u1' });
    errNode.content = [{ type: 'error', message: 'boom' }];
    const te = buildTurnsFromNodes([node('u1', 'user'), errNode]);
    expect(te.get('u1')!.status).toBe('error');
  });

  it('旧格式：只有 assistant → assistant = turn（done）', () => {
    const turns = buildTurnsFromNodes([node('a1', 'assistant', { text: '旧回复' })]);
    expect(turns.size).toBe(1);
    expect(turns.get('a1')!.status).toBe('done');
  });

  it('元数据重建：源/模型/参数/usage 从 assistant 优先，回退 user', () => {
    const turns = buildTurnsFromNodes([
      node('u1', 'user', {
        agentId: 'qoder',
        metadata: { model: 'ultimate', thinkingLevel: 'high', contextWindow: 400000 },
      }),
      node('a1', 'assistant', {
        parentId: 'u1',
        agentId: 'qoder',
        metadata: {
          model: 'ultimate',
          thinkingLevel: 'high',
          contextWindow: 400000,
          usage: { input: 100, output: 50 },
        },
      }),
    ]);
    const t = turns.get('u1')!;
    expect(t.sourceId).toBe('qoder');
    expect(t.modelId).toBe('ultimate');
    expect(t.thinkingLevel, 'thinkingLevel 重建').toBe('high');
    expect(t.contextWindow, 'contextWindow 重建').toBe(400000);
    expect(t.usage?.input, 'usage 重建（reload 后上下文指示可用）').toBe(100);
  });

  it('元数据重建：assistant 缺失时回退 user 节点落盘值', () => {
    const turns = buildTurnsFromNodes([
      node('u1', 'user', {
        agentId: 'pi',
        metadata: { model: 'claude', thinkingLevel: 'low', contextWindow: 128000 },
      }),
    ]);
    const t = turns.get('u1')!;
    expect(t.sourceId, 'sourceId 回退 user.agentId').toBe('pi');
    expect(t.modelId, 'modelId 回退 user.metadata').toBe('claude');
    expect(t.thinkingLevel).toBe('low');
    expect(t.contextWindow).toBe(128000);
  });
});

describe('restoreStreamingTurns（在途流式恢复）', () => {
  it('重建后空 blocks → 恢复为 streaming', () => {
    const turns = new Map([['u1', turn({ id: 'u1', userMessage: 'q' })]]);
    restoreStreamingTurns(turns, new Map([['u1', [{ type: 'text', text: '流式内容' }]]]));
    expect(turns.get('u1')!.status).toBe('streaming');
    expect((turns.get('u1')!.blocks[0] as { text: string }).text).toBe('流式内容');
  });

  it('重建后已有内容（server 已落盘）→ 不覆盖', () => {
    const turns = new Map([
      ['u1', turn({ id: 'u1', userMessage: 'q', blocks: [{ type: 'text', text: '已落盘' }] })],
    ]);
    restoreStreamingTurns(turns, new Map([['u1', [{ type: 'text', text: '旧流式' }]]]));
    expect((turns.get('u1')!.blocks[0] as { text: string }).text).toBe('已落盘');
  });

  it('只读 turn 不恢复', () => {
    const turns = new Map([['u1', turn({ id: 'u1', userMessage: 'q', status: 'undone' })]]);
    restoreStreamingTurns(turns, new Map([['u1', [{ type: 'text', text: 'x' }]]]));
    expect(turns.get('u1')!.status).toBe('undone');
    expect(turns.get('u1')!.blocks.length).toBe(0);
  });
});

describe('fillInterruptedStreams（崩溃恢复填充）', () => {
  it('填充部分内容并标记 interrupted', () => {
    const turns = new Map([['u1', turn({ id: 'u1', userMessage: 'q' })]]);
    fillInterruptedStreams(turns, [
      { requestId: 'r', parentId: 'u1', content: [{ type: 'text', text: '部分' }] },
    ]);
    expect(turns.get('u1')!.status).toBe('interrupted');
    expect((turns.get('u1')!.blocks[0] as { text: string }).text).toBe('部分');
  });
});

describe('applyStreamEvent（事件→turn）', () => {
  it('连续 text 合并；done 记录 usage', () => {
    const t = turn({ id: 'u1', userMessage: 'q', status: 'streaming' });
    applyStreamEvent(t, { type: 'text', content: 'Hello ' });
    applyStreamEvent(t, { type: 'text', content: 'world' });
    expect(t.blocks.length).toBe(1);
    expect((t.blocks[0] as { text: string }).text).toBe('Hello world');
    applyStreamEvent(t, { type: 'done', usage: { input: 10, output: 5 } });
    expect(t.status).toBe('done');
    expect(t.usage?.input).toBe(10);
  });

  it('error 事件 → status error + error 块入 blocks', () => {
    const t = turn({ id: 'u1', userMessage: 'q', status: 'streaming' });
    applyStreamEvent(t, {
      type: 'error',
      message: 'err',
      code: 'unknown',
      retryable: false,
      source: { id: 's', name: 'S' },
    });
    expect(t.status).toBe('error');
    expect(t.blocks.some((b) => b.type === 'error')).toBe(true);
  });

  it('compaction 事件 → 块入 blocks，不改变流式状态（源压缩透传观察）', () => {
    const t = turn({ id: 'u1', userMessage: 'q', status: 'streaming' });
    applyStreamEvent(t, { type: 'compaction', trigger: 'auto', preTokens: 37418 });
    expect(t.status, '压缩不终止流式').toBe('streaming');
    expect(t.blocks[0]).toEqual({ type: 'compaction', trigger: 'auto', preTokens: 37418 });
  });

  it('notice 事件 → 块入 blocks，不影响状态（resume 降级警告非 error）', () => {
    const t = turn({ id: 'u1', userMessage: 'q', status: 'streaming' });
    applyStreamEvent(t, { type: 'notice', level: 'warning', message: '会话恢复失败' });
    applyStreamEvent(t, { type: 'done' });
    expect(t.status, 'notice 不改变终态投影').toBe('done');
    expect(t.blocks[0]).toEqual({ type: 'notice', level: 'warning', text: '会话恢复失败' });
  });
});

describe('getVisibleTurns / getVisibleChildIds（可见性）', () => {
  it('排除 hidden 节点与子节点', () => {
    const turns: TurnNode[] = [
      turn({ id: 'u1', timestamp: 1 }),
      turn({ id: 'u2', parentTurnId: 'u1', status: 'hidden', timestamp: 2 }),
      turn({ id: 'u3', parentTurnId: 'u1', timestamp: 3 }),
    ];
    expect(getVisibleTurns(turns).length).toBe(2);
    expect(getVisibleChildIds(turns, 'u1')).toEqual(['u3']);
  });
});

describe('layoutTree（布局）', () => {
  it('同层顶对齐、水平分开、父节点在上', () => {
    const { positions } = layoutTree([
      { id: 'root', parentId: null, width: 340, height: 80, childIds: ['a', 'b'] },
      { id: 'a', parentId: 'root', width: 340, height: 260, childIds: [] },
      { id: 'b', parentId: 'root', width: 340, height: 260, childIds: [] },
    ]);
    expect(positions.size).toBe(3);
    const a = positions.get('a')!;
    const b = positions.get('b')!;
    expect(a.y, '同层节点顶对齐').toBe(b.y);
    expect(a.x, '同层节点水平分开').not.toBe(b.x);
    expect(positions.get('root')!.y, '父节点在上').toBeLessThan(a.y);
  });
});
