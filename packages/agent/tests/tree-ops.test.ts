/**
 * SessionManager 树操作与 retry JSONL 不变量测试
 *
 * 由 scripts/verify-tree-ops.ts + scripts/verify-retry-flow.ts 迁移。
 * 覆盖：updateNode 持久化、loadTree 恢复、后代收集、retry 复用 user 节点的 JSONL 行数不变量。
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../src/index.js';

function getDescendantIds(sm: SessionManager, treeId: string, nodeId: string): string[] {
  const nodes = sm.getNodes(treeId);
  const result: string[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of nodes.filter((n) => n.parentId === current)) {
      result.push(child.id);
      queue.push(child.id);
    }
  }
  return result;
}

/** 统计 nodes.jsonl 中某个 id 出现的行数 */
async function countNodeLines(baseDir: string, treeId: string, nodeId: string): Promise<number> {
  const raw = await readFile(join(baseDir, treeId, 'nodes.jsonl'), 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .filter((l) => (JSON.parse(l) as { id: string }).id === nodeId).length;
}

async function newBase() {
  return mkdtemp(join(tmpdir(), 'lattice-tree-ops-'));
}

describe('SessionManager 树操作', () => {
  it('后代收集 / updateNode 持久化 / 重载恢复 / active 选择 / hidden', async () => {
    const baseDir = await newBase();
    // ── 构建树：user1 → asst1 → user2 → asst2 ──
    const sm = new SessionManager({ baseDir });
    const tree = await sm.createTree({ title: 'test' });
    const tid = tree.id;

    await sm.addNode(tid, {
      id: 'user1',
      parentId: null,
      role: 'user',
      content: [{ type: 'text', text: '修复 bug' }],
    });
    await sm.addNode(tid, {
      id: 'asst1',
      parentId: 'user1',
      role: 'assistant',
      content: [{ type: 'text', text: '已修复' }],
      metadata: { sourceMessageId: 'src-msg-1' },
    });
    await sm.addNode(tid, {
      id: 'user2',
      parentId: 'asst1',
      role: 'user',
      content: [{ type: 'text', text: '再优化' }],
    });
    await sm.addNode(tid, {
      id: 'asst2',
      parentId: 'user2',
      role: 'assistant',
      content: [{ type: 'text', text: '已优化' }],
      metadata: { sourceMessageId: 'src-msg-2' },
    });

    // 后代收集
    const descOfUser1 = getDescendantIds(sm, tid, 'user1');
    expect(descOfUser1.sort(), 'user1 的后代 = [asst1, user2, asst2]').toEqual([
      'asst1',
      'asst2',
      'user2',
    ]);
    expect(getDescendantIds(sm, tid, 'user2'), 'user2 的后代 = [asst2]').toEqual(['asst2']);

    // updateNode 持久化 status → 新 SessionManager 从磁盘重载验证
    await sm.updateNode(tid, 'user2', { status: 'undone' });
    await sm.updateNode(tid, 'asst2', { status: 'undone' });
    const sm2 = new SessionManager({ baseDir });
    expect(await sm2.loadTree(tid), '重载树成功').toBeTruthy();
    expect(sm2.getNode(tid, 'user2')?.status, '重载后 user2 undone 持久化').toBe('undone');
    expect(sm2.getNode(tid, 'asst2')?.status, '重载后 asst2 undone 持久化').toBe('undone');
    expect(sm2.getNode(tid, 'user1')?.status, 'user1 未被标记').toBeUndefined();

    // updateNode 持久化 content（continue 追加场景）
    await sm2.updateNode(tid, 'asst1', {
      content: [
        { type: 'text', text: '已修复' },
        { type: 'text', text: '（续写部分）' },
      ],
      metadata: { sourceMessageId: 'src-msg-1' },
    });
    const sm3 = new SessionManager({ baseDir });
    await sm3.loadTree(tid);
    expect(sm3.getNode(tid, 'asst1')?.content.length, '续写内容已持久化').toBe(2);

    // retry 场景：多 assistant 子节点优先取 active
    await sm3.addNode(tid, {
      id: 'asst2-new',
      parentId: 'user2',
      role: 'assistant',
      content: [{ type: 'text', text: '重新优化的结果' }],
    });
    const assistants = sm3
      .getNodes(tid)
      .filter((n) => n.role === 'assistant' && n.parentId === 'user2');
    const active =
      assistants.find((n) => n.status !== 'undone' && n.status !== 'hidden') ?? assistants[0];
    expect(active?.id, '优先选中 active 的 asst2-new').toBe('asst2-new');

    // hidden 持久化
    await sm3.updateNode(tid, 'asst2-new', { status: 'hidden' });
    const sm4 = new SessionManager({ baseDir });
    await sm4.loadTree(tid);
    expect(sm4.getNode(tid, 'asst2-new')?.status, 'hidden 状态已持久化').toBe('hidden');
  });
});

describe('retry JSONL 不变量', () => {
  it('retry 复用原 user 节点（不重复写入），只新增 assistant 子节点', async () => {
    const baseDir = await newBase();
    const sm = new SessionManager({ baseDir });
    const tree = await sm.createTree({ title: 'retry test' });
    const tid = tree.id;

    // 首轮：user1 → asst1
    await sm.addNode(tid, {
      id: 'user1',
      parentId: null,
      role: 'user',
      content: [{ type: 'text', text: '写个快排' }],
    });
    await sm.addNode(tid, {
      id: 'asst1',
      parentId: 'user1',
      role: 'assistant',
      content: [{ type: 'text', text: '旧回复' }],
      metadata: { sourceMessageId: 'src-1' },
    });

    // retry 标记旧 assistant 为 undone
    await sm.updateNode(tid, 'asst1', { status: 'undone' });
    expect(sm.getNode(tid, 'asst1')?.status).toBe('undone');

    // 正确做法：reuseUserNodeId → 不调 addNode(user)，只新增 assistant 子节点
    await sm.addNode(tid, {
      id: 'asst1-new',
      parentId: 'user1',
      role: 'assistant',
      content: [{ type: 'text', text: '新回复' }],
      metadata: { sourceMessageId: 'src-2' },
    });
    expect(await countNodeLines(baseDir, tid, 'user1'), 'user1 只有 1 行（复用原节点）').toBe(1);

    // retry 后树结构：user1 有两个 assistant 子节点
    const sm2 = new SessionManager({ baseDir });
    await sm2.loadTree(tid);
    const assistantChildren = sm2
      .getNodes(tid)
      .filter((n) => n.role === 'assistant' && n.parentId === 'user1');
    expect(assistantChildren.length, 'user1 有 2 个 assistant 子节点').toBe(2);
    const active = assistantChildren.find((n) => n.status !== 'undone' && n.status !== 'hidden');
    expect(active?.id, 'active 子节点是 asst1-new').toBe('asst1-new');
    const undone = assistantChildren.find((n) => n.status === 'undone');
    expect(undone?.id, 'undone 子节点是 asst1').toBe('asst1');

    // 对照：错误做法（重复 addNode user）会产生 2 行（证明检测手段有效）
    await sm2.addNode(tid, {
      id: 'user1',
      parentId: null,
      role: 'user',
      content: [{ type: 'text', text: '写个快排' }],
    });
    expect(await countNodeLines(baseDir, tid, 'user1'), '重复 addNode 后 user1 变 2 行').toBe(2);
  });
});
