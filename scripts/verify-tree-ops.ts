/**
 * 验证 SessionManager 树操作关键路径（undo/delete/retry 依赖的能力）
 *
 * 测试点：
 * 1. updateNode 持久化 status/content/metadata（重写 nodes.jsonl）
 * 2. 重新 loadTree 后状态正确恢复（undone/hidden/interrupted）
 * 3. 后代收集逻辑（getDescendantIds 等价实现）
 * 4. retry 场景：一个 user 多个 assistant 子节点，优先取 active
 *
 * 运行：node_modules/.bin/tsx scripts/verify-tree-ops.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../packages/agent/src/session/session-manager.js';

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

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

async function main() {
  const baseDir = await mkdtemp(join(tmpdir(), 'lattice-tree-ops-'));
  console.log(`临时目录: ${baseDir}\n`);

  try {
    // ── 构建树：user1 → assistant1 → user2 → assistant2 ──
    const sm = new SessionManager({ baseDir });
    const tree = await sm.createTree({ title: 'test' });
    const tid = tree.id;

    const user1 = await sm.addNode(tid, {
      id: 'user1',
      parentId: null,
      role: 'user',
      content: [{ type: 'text', text: '修复 bug' }],
    });
    const asst1 = await sm.addNode(tid, {
      id: 'asst1',
      parentId: 'user1',
      role: 'assistant',
      content: [{ type: 'text', text: '已修复' }],
      metadata: { sourceMessageId: 'src-msg-1' },
    });
    const user2 = await sm.addNode(tid, {
      id: 'user2',
      parentId: 'asst1',
      role: 'user',
      content: [{ type: 'text', text: '再优化' }],
    });
    const asst2 = await sm.addNode(tid, {
      id: 'asst2',
      parentId: 'user2',
      role: 'assistant',
      content: [{ type: 'text', text: '已优化' }],
      metadata: { sourceMessageId: 'src-msg-2' },
    });

    console.log('测试 1: 后代收集');
    const descOfUser1 = getDescendantIds(sm, tid, 'user1');
    assert(
      descOfUser1.length === 3 &&
        descOfUser1.includes('asst1') &&
        descOfUser1.includes('user2') &&
        descOfUser1.includes('asst2'),
      `user1 的后代 = [asst1, user2, asst2]（实际: ${descOfUser1.join(',')}）`,
    );
    const descOfUser2 = getDescendantIds(sm, tid, 'user2');
    assert(descOfUser2.length === 1 && descOfUser2[0] === 'asst2', 'user2 的后代 = [asst2]');

    console.log('\n测试 2: updateNode 持久化 status');
    await sm.updateNode(tid, 'user2', { status: 'undone' });
    await sm.updateNode(tid, 'asst2', { status: 'undone' });
    assert(sm.getNode(tid, 'user2')?.status === 'undone', '内存中 user2.status = undone');

    // 用新的 SessionManager 从磁盘重载，验证持久化
    const sm2 = new SessionManager({ baseDir });
    const reloaded = await sm2.loadTree(tid);
    assert(reloaded !== undefined, '重载树成功');
    assert(
      sm2.getNode(tid, 'user2')?.status === 'undone',
      '重载后 user2.status = undone（已持久化）',
    );
    assert(
      sm2.getNode(tid, 'asst2')?.status === 'undone',
      '重载后 asst2.status = undone（已持久化）',
    );
    assert(sm2.getNode(tid, 'user1')?.status === undefined, 'user1 未被标记（无 status）');

    console.log('\n测试 3: updateNode 持久化 content（continue 追加场景）');
    await sm2.updateNode(tid, 'asst1', {
      content: [
        { type: 'text', text: '已修复' },
        { type: 'text', text: '（续写部分）' },
      ],
      metadata: { sourceMessageId: 'src-msg-1', interrupted: undefined },
    });
    const sm3 = new SessionManager({ baseDir });
    await sm3.loadTree(tid);
    const asst1Reloaded = sm3.getNode(tid, 'asst1');
    assert(asst1Reloaded?.content.length === 2, 'asst1 重载后有 2 个 content 块（续写已持久化）');

    console.log('\n测试 4: retry 场景——多个 assistant 子节点优先取 active');
    // 模拟 retry：user2 有旧 assistant（undone）+ 新 assistant（active）
    await sm3.addNode(tid, {
      id: 'asst2-new',
      parentId: 'user2',
      role: 'assistant',
      content: [{ type: 'text', text: '重新优化的结果' }],
    });
    // asst2 已是 undone，asst2-new 是 active
    const assistants = sm3
      .getNodes(tid)
      .filter((n) => n.role === 'assistant' && n.parentId === 'user2');
    const activeAssistant =
      assistants.find((n) => n.status !== 'undone' && n.status !== 'hidden') ?? assistants[0];
    assert(
      activeAssistant?.id === 'asst2-new',
      '优先选中 active 的 asst2-new（而非 undone 的 asst2）',
    );

    console.log('\n测试 5: hidden 状态');
    await sm3.updateNode(tid, 'asst2-new', { status: 'hidden' });
    const sm4 = new SessionManager({ baseDir });
    await sm4.loadTree(tid);
    assert(sm4.getNode(tid, 'asst2-new')?.status === 'hidden', 'hidden 状态已持久化');

    console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
    if (failed > 0) process.exit(1);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('测试异常:', err);
  process.exit(1);
});
