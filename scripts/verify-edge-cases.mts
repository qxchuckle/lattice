/**
 * 边界条件与操作组合验证 — 系统性遍历树对话各操作情形
 *
 * 用 mock source 驱动 ConversationController，覆盖状态机边界：
 *   1. retry 不应复活已删除（hidden）的后代（与 undo 同类）
 *   2. auto-fork 不应把已删除/撤销的子节点计入（避免多余分支）
 *   3. undo→delete / delete→undo 的状态叠加
 *   4. retry 后 continue（新 active assistant）
 *   5. retry 一个 interrupted turn
 *   6. 多层链 undo（深层后代）
 *   7. 多次 retry（多 assistant 子节点，active 选择）
 *   8. headNodeId 跟踪
 *   9. undo 后从该处重新提问
 *  10. 只读节点（undone/hidden）的 server 侧防护
 *
 * 运行：node_modules/.bin/tsx scripts/verify-edge-cases.mts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, ConversationController } from '../packages/agent/src/index.js';
import type {
  ConversationHooks,
  SourceEvent,
  AgentSourceInstance,
} from '../packages/agent/src/index.js';
import type { ISource, ContentBlock } from '@qcqx/lattice-agent-protocol';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  cond ? passed++ : failed++;
}

function makeMockSource(): ISource {
  let msgCounter = 0;
  return {
    id: 'mock',
    displayName: 'Mock',
    version: '1.0.0',
    modelPolicy: 'open',
    capabilities: {
      executionMode: 'delegated',
      builtinTools: [],
      sessionResume: true,
      mcpSupport: false,
      maxConcurrentSessions: 0,
    },
    systemPromptPolicy: { hasBuiltin: false, canOverride: true, canAppend: true },
    async init() {},
    async dispose() {},
    async listModels() {
      return [];
    },
    getAuthRequirements() {
      return [];
    },
    async checkAuth() {
      return { status: 'authenticated' as const };
    },
    getBuiltinTools() {
      return [];
    },
    injectTools() {},
    async *prompt(
      sessionId: string | null,
      message: ContentBlock[],
      _opts: unknown,
    ): AsyncIterable<SourceEvent> {
      const text = (message[0] as { text?: string })?.text ?? '';
      msgCounter++;
      yield { type: 'text', content: `回复[${text}]` };
      yield {
        type: 'done',
        sessionId: sessionId ?? `sess-${msgCounter}`,
        sourceMessageId: `msg-${msgCounter}`,
      };
    },
    abort() {},
    async destroySession() {},
    isSessionAlive() {
      return true;
    },
    async forkSession(sessionId: string) {
      return `${sessionId}-fork`;
    },
    async renameSession() {},
  } as unknown as ISource;
}

const noopHooks: ConversationHooks = {
  onEvent: () => {},
  onError: () => {},
  onTreeUpdated: () => {},
  onTreeCreated: () => {},
};

async function setup() {
  const baseDir = await mkdtemp(join(tmpdir(), 'lattice-edge-'));
  const sm = new SessionManager({ baseDir });
  const source = makeMockSource();
  const sources = {
    registry: { getSource: (id: string) => (id === 'mock' ? source : undefined) },
  } as unknown as AgentSourceInstance;
  const controller = new ConversationController({ session: sm, sources });
  controller.createSession('s', 'mock', null);
  return { baseDir, sm, controller };
}

const flush = (c: ConversationController) => c.getSession('s')!.queue;
const tid = (c: ConversationController) => c.getSession('s')!.treeId!;
const asstOf = (sm: SessionManager, t: string, parentId: string) =>
  sm.getNodes(t).find((n) => n.role === 'assistant' && n.parentId === parentId);

/** 构建链：u1 → u2 → u3（每轮 send 挂上一轮的 user 节点下） */
async function buildChain(c: ConversationController, sm: SessionManager, depth: number) {
  c.send('s', '第一轮', { requestId: 'u1' }, noopHooks);
  await flush(c);
  for (let i = 2; i <= depth; i++) {
    c.send('s', `第${i}轮`, { requestId: `u${i}`, parentNodeId: `u${i - 1}` }, noopHooks);
    await flush(c);
  }
  return tid(c);
}

// ── 1. retry 不应复活已删除（hidden）的后代 ──
async function case1() {
  console.log('\n[1] retry 不应复活已删除（hidden）的后代');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 3); // u1→u2→u3
  // 删除 u3（hidden）
  await controller.delete('s', 'u3', noopHooks);
  assert(sm.getNode(t, 'u3')!.status === 'hidden', 'u3 删除 → hidden');
  // retry u1 → 后代 u2/u3/asst 应 undone，但 u3（hidden）不应复活
  controller.retry('s', 'u1', 'u1-r', noopHooks);
  await flush(controller);
  assert(sm.getNode(t, 'u2')!.status === 'undone', 'retry: u2 → undone');
  assert(
    sm.getNode(t, 'u3')!.status === 'hidden',
    'retry 不复活 u3（保持 hidden，未被覆盖 undone）',
  );
}

// ── 2. auto-fork 不应把已删除的子节点计入 ──
async function case2() {
  console.log('\n[2] auto-fork 不应把已删除/撤销的子节点计入');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 2); // u1→u2
  const branchesBefore = sm.getTree(t)!.branches.length;
  // 删除 u2（hidden）
  await controller.delete('s', 'u2', noopHooks);
  // 再次从 u1 提问：u1 的 assistant 子节点的 user 子节点（u2）已 hidden，不应触发 auto-fork
  controller.send('s', '重新提问', { requestId: 'u2b', parentNodeId: 'u1' }, noopHooks);
  await flush(controller);
  const branchesAfter = sm.getTree(t)!.branches.length;
  assert(
    branchesAfter === branchesBefore,
    `已删除子节点不计入 auto-fork（分支数 ${branchesBefore} → ${branchesAfter}，应不变）`,
  );
}

// ── 3. undo→delete / delete→undo 状态叠加 ──
async function case3() {
  console.log('\n[3] undo→delete / delete→undo 状态叠加');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 2);
  // undo u2 → undone，再 delete u2 → hidden
  await controller.undo('s', 'u2', noopHooks);
  assert(sm.getNode(t, 'u2')!.status === 'undone', 'undo u2 → undone');
  await controller.delete('s', 'u2', noopHooks);
  assert(sm.getNode(t, 'u2')!.status === 'hidden', 'undo 后 delete u2 → hidden');
}

// ── 4. retry 后 continue（新 active assistant） ──
async function case4() {
  console.log('\n[4] retry 后 continue 作用于新 active assistant');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 1); // u1
  controller.retry('s', 'u1', 'u1-r', noopHooks);
  await flush(controller);
  const activeAsst = sm
    .getNodes(t)
    .find((n) => n.role === 'assistant' && n.parentId === 'u1' && n.status !== 'undone')!;
  const lenBefore = activeAsst.content.length;
  // continue（client 发 turnId=u1，server 应选 active assistant 续写）
  controller.continue('s', 'u1', 'u1-c', noopHooks);
  await flush(controller);
  const after = sm.getNode(t, activeAsst.id)!;
  assert(after.content.length > lenBefore, 'continue 追加到 retry 后的 active assistant');
  assert(after.status === 'active', 'continue 完成 → active');
}

// ── 5. retry 一个 interrupted turn ──
async function case5() {
  console.log('\n[5] retry 一个 interrupted turn');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 1);
  // 手动把 asst 标记 interrupted（模拟中断）
  const asst = asstOf(sm, t, 'u1')!;
  await sm.updateNode(t, asst.id, { status: 'interrupted' });
  controller.retry('s', 'u1', 'u1-r', noopHooks);
  await flush(controller);
  assert(sm.getNode(t, asst.id)!.status === 'undone', 'retry: 旧 interrupted assistant → undone');
  const newAsst = sm
    .getNodes(t)
    .find((n) => n.role === 'assistant' && n.parentId === 'u1' && n.status !== 'undone');
  assert(!!newAsst && newAsst.status !== 'interrupted', 'retry 生成新 active assistant');
}

// ── 6. 多层链 undo（深层后代全部 undone） ──
async function case6() {
  console.log('\n[6] 多层链 undo（深层后代）');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 4); // u1→u2→u3→u4
  await controller.undo('s', 'u2', noopHooks);
  assert(sm.getNode(t, 'u2')!.status === 'undone', 'undo u2 → undone');
  assert(sm.getNode(t, 'u3')!.status === 'undone', '后代 u3 → undone');
  assert(sm.getNode(t, 'u4')!.status === 'undone', '深层后代 u4 → undone');
  assert(sm.getNode(t, 'u1')!.status === undefined, '祖先 u1 不受影响');
  assert(sm.getTree(t)!.headNodeId === asstOf(sm, t, 'u1')!.id, 'head 回退到 u1 的 assistant');
}

// ── 7. 多次 retry（多 assistant 子节点，active 选择） ──
async function case7() {
  console.log('\n[7] 多次 retry（active assistant 选择）');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 1);
  controller.retry('s', 'u1', 'r1', noopHooks);
  await flush(controller);
  controller.retry('s', 'u1', 'r2', noopHooks);
  await flush(controller);
  const assistants = sm.getNodes(t).filter((n) => n.role === 'assistant' && n.parentId === 'u1');
  const active = assistants.filter((n) => n.status !== 'undone' && n.status !== 'hidden');
  assert(assistants.length === 3, '3 次生成 → 3 个 assistant 子节点');
  assert(active.length === 1, '仅 1 个 active assistant（其余 undone）');
}

// ── 8. undo 后从该处重新提问（fork 行为） ──
async function case8() {
  console.log('\n[8] undo 后从父节点重新提问');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 2);
  await controller.undo('s', 'u2', noopHooks);
  // 从 u1 重新提问（u2 已 undone）
  controller.send('s', '新分支提问', { requestId: 'u2-new', parentNodeId: 'u1' }, noopHooks);
  await flush(controller);
  const u2new = sm.getNode(t, 'u2-new');
  assert(!!u2new, 'undo 后可从父节点重新提问');
  assert(u2new!.parentId === asstOf(sm, t, 'u1')!.id, '新提问挂在 u1 的 assistant 下');
}

// ── 9. delete 整个子树后，树视图只剩可见节点 ──
async function case9() {
  console.log('\n[9] delete 子树后隐藏一致性');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 3);
  await controller.delete('s', 'u2', noopHooks);
  assert(sm.getNode(t, 'u2')!.status === 'hidden', 'delete u2 → hidden');
  assert(sm.getNode(t, 'u3')!.status === 'hidden', '后代 u3 → hidden');
  assert(sm.getNode(t, 'u1')!.status === undefined, 'u1 保持可见');
}

// ── 10. continue 不应作用于 undone 的 assistant（只读防护） ──
async function case10() {
  console.log('\n[10] continue 对 undone assistant 的防护');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 1);
  const asst = asstOf(sm, t, 'u1')!;
  await sm.updateNode(t, asst.id, { status: 'undone' });
  const lenBefore = asst.content.length;
  controller.continue('s', 'u1', 'c1', noopHooks);
  await flush(controller);
  const after = sm.getNode(t, asst.id)!;
  assert(
    after.content.length === lenBefore && after.status === 'undone',
    'continue 不修改 undone assistant（只读，内容/状态不变）',
  );
}

// ── 11. 只读终态防护（server 侧纵深防御） ──
async function case11() {
  console.log('\n[11] 只读终态防护（server 侧）');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 2);
  // delete u2 → hidden；再 undo 不应复活、不应无谓 fork
  await controller.delete('s', 'u2', noopHooks);
  assert(sm.getNode(t, 'u2')!.status === 'hidden', 'delete u2 → hidden');
  const branchesBefore = sm.getTree(t)!.branches.length;
  await controller.undo('s', 'u2', noopHooks);
  assert(sm.getNode(t, 'u2')!.status === 'hidden', 'undo 对 hidden 无效（保持 hidden，不复活）');
  assert(sm.getTree(t)!.branches.length === branchesBefore, 'undo 对 hidden 不触发无谓 fork');
  // retry 对 hidden 的 user 节点无效
  controller.retry('s', 'u2', 'u2-r', noopHooks);
  await flush(controller);
  const newAsst = sm
    .getNodes(t)
    .filter(
      (n) =>
        n.role === 'assistant' &&
        n.parentId === 'u2' &&
        n.status !== 'undone' &&
        n.status !== 'hidden',
    );
  assert(newAsst.length === 0, 'retry 对 hidden user 节点无效（不生成新 assistant）');
  // undo 对已 undone 节点无效（不无谓 fork）
  const { sm: sm3, controller: c3 } = await setup();
  const t3 = await buildChain(c3, sm3, 2);
  await c3.undo('s', 'u2', noopHooks);
  const b3 = sm3.getTree(t3)!.branches.length;
  await c3.undo('s', 'u2', noopHooks);
  assert(sm3.getTree(t3)!.branches.length === b3, 'undo 对已 undone 节点不触发无谓 fork');
}

// ── 12. 并发：send/undo/delete 同 session 串行化（无落盘竞态） ──
async function case12() {
  console.log('\n[12] 并发：同 session 写操作串行化');
  const { sm, controller } = await setup();
  const t = await buildChain(controller, sm, 2); // u1→u2
  // 并发发起多个写操作（均入队串行，不应交错损坏）
  await Promise.all([
    controller.undo('s', 'u2', noopHooks),
    new Promise<void>((resolve) => {
      controller.send('s', '并发提问', { requestId: 'u3', parentNodeId: 'u1' }, noopHooks);
      controller.getSession('s')!.queue.then(() => resolve());
    }),
  ]);
  // 两个操作都应生效（串行顺序无关，结果一致）
  assert(sm.getNode(t, 'u2')!.status === 'undone', '并发后 undo(u2) 生效');
  assert(!!sm.getNode(t, 'u3'), '并发后 send(u3) 生效（节点已落盘）');
  // 树结构完整性：所有节点可追溯，无损坏
  const allNodes = sm.getNodes(t);
  const ids = new Set(allNodes.map((n) => n.id));
  const orphans = allNodes.filter((n) => n.parentId !== null && !ids.has(n.parentId));
  assert(orphans.length === 0, '无孤儿节点（树结构完整，无竞态损坏）');
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  边界条件与操作组合验证');
  console.log('═══════════════════════════════════════════');
  await case1();
  await case2();
  await case3();
  await case4();
  await case5();
  await case6();
  await case7();
  await case8();
  await case9();
  await case10();
  await case11();
  await case12();
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  结果: ${passed} 通过, ${failed} 失败`);
  console.log(`═══════════════════════════════════════════`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('测试异常:', err);
  process.exit(1);
});
