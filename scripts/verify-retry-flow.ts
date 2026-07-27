/**
 * 验证 retry 关键路径的 JSONL 不变量
 *
 * 核心断言：retry 复用原 user 节点（不重复写入），只新增 assistant 子节点。
 * 模拟 server 端 handleSessionRetry → handleSessionSend(reuseUserNodeId) 的操作序列。
 *
 * 运行：node_modules/.bin/tsx scripts/verify-retry-flow.ts
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../packages/agent/src/session/session-manager.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  cond ? passed++ : failed++;
}

/** 统计 nodes.jsonl 中某个 id 出现的行数 */
async function countNodeLines(baseDir: string, treeId: string, nodeId: string): Promise<number> {
  const file = join(baseDir, treeId, 'nodes.jsonl');
  const raw = await readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .filter((l) => (JSON.parse(l) as { id: string }).id === nodeId).length;
}

async function main() {
  const baseDir = await mkdtemp(join(tmpdir(), 'lattice-retry-flow-'));
  console.log(`临时目录: ${baseDir}\n`);

  try {
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

    console.log('测试 1: retry 标记旧 assistant 为 undone');
    await sm.updateNode(tid, 'asst1', { status: 'undone' });
    assert(sm.getNode(tid, 'asst1')?.status === 'undone', 'asst1 标记为 undone');

    console.log('\n测试 2: retry 复用 user 节点（关键：不重复写入 user1）');
    // 正确做法：reuseUserNodeId → 不调 addNode(user)，只新增 assistant 子节点
    await sm.addNode(tid, {
      id: 'asst1-new',
      parentId: 'user1',
      role: 'assistant',
      content: [{ type: 'text', text: '新回复' }],
      metadata: { sourceMessageId: 'src-2' },
    });
    const user1Lines = await countNodeLines(baseDir, tid, 'user1');
    assert(user1Lines === 1, `nodes.jsonl 中 user1 只有 1 行（实际 ${user1Lines}，复用了原节点）`);

    console.log('\n测试 3: retry 后树结构——user1 有两个 assistant 子节点');
    const sm2 = new SessionManager({ baseDir });
    await sm2.loadTree(tid);
    const assistantChildren = sm2
      .getNodes(tid)
      .filter((n) => n.role === 'assistant' && n.parentId === 'user1');
    assert(
      assistantChildren.length === 2,
      `user1 有 2 个 assistant 子节点（实际 ${assistantChildren.length}）`,
    );
    const active = assistantChildren.find((n) => n.status !== 'undone' && n.status !== 'hidden');
    assert(active?.id === 'asst1-new', 'active 子节点是 asst1-new（新回复）');
    const undone = assistantChildren.find((n) => n.status === 'undone');
    assert(undone?.id === 'asst1', 'undone 子节点是 asst1（旧回复）');

    console.log('\n测试 4: 对照——错误做法（重复 addNode user）会产生 2 行');
    // 演示如果不复用、直接 addNode 同 id 会造成的重复（验证检测手段有效）
    await sm2.addNode(tid, {
      id: 'user1',
      parentId: null,
      role: 'user',
      content: [{ type: 'text', text: '写个快排' }],
    });
    const user1LinesAfterDup = await countNodeLines(baseDir, tid, 'user1');
    assert(
      user1LinesAfterDup === 2,
      `重复 addNode 后 user1 变 2 行（实际 ${user1LinesAfterDup}，证明检测有效）`,
    );

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
