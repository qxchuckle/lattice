/**
 * 宿主压缩兜底测试（source 不压缩时的 host-polyfill 素材）
 *
 * 三条铁律：不静默截断（LLM 失败即抛）、未达阈值不调 LLM、已压缩节点不重复参与。
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConversationNode, NodeContent } from '../src/types.js';
import {
  compactConversation,
  shouldCompact,
  filterCompactedNodes,
} from '../src/session/compaction.js';

function node(id: string, overrides: Partial<ConversationNode> = {}): ConversationNode {
  return {
    id,
    parentId: null,
    role: 'user',
    content: [{ type: 'text', text: `内容-${id}` }],
    timestamp: Number(id.replace(/\D/g, '')) || 0,
    ...overrides,
  } as ConversationNode;
}

const createNode = async (
  content: NodeContent[],
  compactedFrom: string[],
): Promise<ConversationNode> =>
  node('sum', {
    role: 'aggregation',
    content,
    timestamp: 9999,
    metadata: { compactedFrom },
  } as Partial<ConversationNode>);

describe('compactConversation', () => {
  it('未达 keepRecent → 判定 compacted:false，且不调用 LLM', async () => {
    const summarize = vi.fn(async () => '摘要');
    const result = await compactConversation(
      [node('n1'), node('n2')],
      { keepRecent: 5 },
      summarize,
      createNode,
    );
    expect(result).toEqual({ compacted: false });
    expect(summarize).not.toHaveBeenCalled();
  });

  it('超出 keepRecent → 压缩最旧部分，保留最近 N 条', async () => {
    const nodes = [node('n1'), node('n2'), node('n3'), node('n4'), node('n5')];
    const result = await compactConversation(
      nodes,
      { keepRecent: 2 },
      async () => '摘要正文',
      createNode,
    );
    expect(result.compacted).toBe(true);
    if (!result.compacted) throw new Error('unreachable');
    expect(result.compactedNodeIds).toEqual(['n1', 'n2', 'n3']);
    expect(result.summaryNode.role).toBe('aggregation');
    expect(result.summaryNode.content[0]).toMatchObject({
      text: expect.stringContaining('摘要正文'),
    });
  });

  it('LLM 失败 → 抛错（不静默截断，由调用方告知用户）', async () => {
    const nodes = [node('n1'), node('n2'), node('n3')];
    await expect(
      compactConversation(
        nodes,
        { keepRecent: 1 },
        async () => {
          throw new Error('LLM 不可用');
        },
        createNode,
      ),
    ).rejects.toThrow('LLM 不可用');
  });

  it('已压缩节点与 aggregation 节点不再参与压缩', async () => {
    const nodes = [
      node('n1', { metadata: { compacted: true } } as Partial<ConversationNode>),
      node('n2', { role: 'aggregation' }),
      node('n3'),
      node('n4'),
    ];
    const result = await compactConversation(nodes, { keepRecent: 1 }, async () => 's', createNode);
    if (!result.compacted) throw new Error('unreachable');
    expect(result.compactedNodeIds).toEqual(['n3']);
  });

  it('branchId 限定 → 只压缩该分支', async () => {
    const nodes = [
      node('n1', { branchId: 'b1' }),
      node('n2', { branchId: 'b2' }),
      node('n3', { branchId: 'b1' }),
      node('n4', { branchId: 'b1' }),
    ];
    const result = await compactConversation(
      nodes,
      { keepRecent: 1, branchId: 'b1' },
      async () => 's',
      createNode,
    );
    if (!result.compacted) throw new Error('unreachable');
    expect(result.compactedNodeIds).toEqual(['n1', 'n3']);
  });

  it('单条内容截断到 2000 字符（防 token 爆炸），focus 透传给 LLM', async () => {
    const long = 'x'.repeat(5000);
    const seen: Array<{ messages: Array<{ content: string }>; focus?: string }> = [];
    const summarize = async (opts: {
      messages: Array<{ role: string; content: string }>;
      focus?: string;
    }) => {
      seen.push(opts);
      return 's';
    };
    await compactConversation(
      [node('n1', { content: [{ type: 'text', text: long }] }), node('n2'), node('n3')],
      { keepRecent: 1, focus: '只关注决策' },
      summarize,
      createNode,
    );
    expect(seen[0].messages[0].content).toHaveLength(2000);
    expect(seen[0].focus).toBe('只关注决策');
  });
});

describe('shouldCompact / filterCompactedNodes', () => {
  it('阈值仅计活跃节点（已压缩与摘要节点不计）', () => {
    const active = Array.from({ length: 5 }, (_, i) => node(`a${i}`));
    const inert = [
      node('c1', { metadata: { compacted: true } } as Partial<ConversationNode>),
      node('g1', { role: 'aggregation' }),
    ];
    expect(shouldCompact([...active, ...inert], 5)).toBe(false);
    expect(shouldCompact([...active, node('a6'), ...inert], 5)).toBe(true);
  });

  it('加载过滤：剔除已压缩节点并按时间排序（摘要节点保留在其时间位）', () => {
    const nodes = [
      node('n3'),
      node('n1', { metadata: { compacted: true } } as Partial<ConversationNode>),
      node('n2'),
      node('sum', { role: 'aggregation', timestamp: 5 }),
    ];
    expect(filterCompactedNodes(nodes).map((n) => n.id)).toEqual(['n2', 'n3', 'sum']);
  });
});
