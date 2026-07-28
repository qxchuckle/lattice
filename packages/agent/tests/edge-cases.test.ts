/**
 * 边界条件与操作组合测试 — 系统性遍历树对话各操作情形
 *
 * 由 scripts/verify-edge-cases.mts 迁移。
 * 用 mock source 驱动 ConversationController，覆盖状态机边界。
 */
import { describe, it, expect } from 'vitest';
import { setup, flush as flushSid, noopHooks, asstOf, buildChain } from './helpers.js';
import type { TestContext } from './helpers.js';

// 本套用例统一用 session id 's'
async function setupS(): Promise<TestContext> {
  const ctx = await setup();
  ctx.controller.createSession('s', 'mock', null);
  return ctx;
}
const flush = (ctx: TestContext) => flushSid(ctx.controller, 's');
const chain = (ctx: TestContext, depth: number) => buildChain(ctx.controller, 's', depth);

describe('边界条件与操作组合', () => {
  it('[1] retry 不应复活已删除（hidden）的后代', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 3); // u1→u2→u3
    await controller.delete('s', 'u3', noopHooks);
    expect(sm.getNode(t, 'u3')!.status, 'u3 删除 → hidden').toBe('hidden');
    // retry u1 → 后代 u2/asst 应 undone，但 u3（hidden）不应复活
    controller.retry('s', 'u1', 'u1-r', noopHooks);
    await flush(ctx);
    expect(sm.getNode(t, 'u2')!.status, 'retry: u2 → undone').toBe('undone');
    expect(sm.getNode(t, 'u3')!.status, 'retry 不复活 u3').toBe('hidden');
  });

  it('[2] auto-fork 不应把已删除/撤销的子节点计入', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 2); // u1→u2
    const branchesBefore = sm.getTree(t)!.branches.length;
    await controller.delete('s', 'u2', noopHooks);
    // 再次从 u1 提问：u2 已 hidden，不应触发 auto-fork
    controller.send('s', '重新提问', { requestId: 'u2b', parentNodeId: 'u1' }, noopHooks);
    await flush(ctx);
    expect(sm.getTree(t)!.branches.length, '已删除子节点不计入 auto-fork').toBe(branchesBefore);
  });

  it('[3] undo→delete 状态叠加', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 2);
    await controller.undo('s', 'u2', noopHooks);
    expect(sm.getNode(t, 'u2')!.status, 'undo u2 → undone').toBe('undone');
    await controller.delete('s', 'u2', noopHooks);
    expect(sm.getNode(t, 'u2')!.status, 'undo 后 delete u2 → hidden').toBe('hidden');
  });

  it('[4] retry 后 continue 作用于新 active assistant', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 1); // u1
    controller.retry('s', 'u1', 'u1-r', noopHooks);
    await flush(ctx);
    const activeAsst = sm
      .getNodes(t)
      .find((n) => n.role === 'assistant' && n.parentId === 'u1' && n.status !== 'undone')!;
    const lenBefore = activeAsst.content.length;
    controller.continue('s', 'u1', 'u1-c', noopHooks);
    await flush(ctx);
    const after = sm.getNode(t, activeAsst.id)!;
    expect(after.content.length, 'continue 追加到 retry 后的 active assistant').toBeGreaterThan(
      lenBefore,
    );
    expect(after.status, 'continue 完成 → active').toBe('active');
  });

  it('[5] retry 一个 interrupted turn', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 1);
    const asst = asstOf(sm, t, 'u1')!;
    await sm.updateNode(t, asst.id, { status: 'interrupted' });
    controller.retry('s', 'u1', 'u1-r', noopHooks);
    await flush(ctx);
    expect(sm.getNode(t, asst.id)!.status, '旧 interrupted assistant → undone').toBe('undone');
    const newAsst = sm
      .getNodes(t)
      .find((n) => n.role === 'assistant' && n.parentId === 'u1' && n.status !== 'undone');
    expect(newAsst, 'retry 生成新 active assistant').toBeTruthy();
    expect(newAsst!.status).not.toBe('interrupted');
  });

  it('[6] 多层链 undo（深层后代全部 undone）', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 4); // u1→u2→u3→u4
    await controller.undo('s', 'u2', noopHooks);
    expect(sm.getNode(t, 'u2')!.status).toBe('undone');
    expect(sm.getNode(t, 'u3')!.status, '后代 u3 → undone').toBe('undone');
    expect(sm.getNode(t, 'u4')!.status, '深层后代 u4 → undone').toBe('undone');
    expect(sm.getNode(t, 'u1')!.status, '祖先 u1 不受影响').toBeUndefined();
    expect(sm.getTree(t)!.headNodeId, 'head 回退到 u1 的 assistant').toBe(asstOf(sm, t, 'u1')!.id);
  });

  it('[7] 多次 retry（active assistant 选择）', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 1);
    controller.retry('s', 'u1', 'r1', noopHooks);
    await flush(ctx);
    controller.retry('s', 'u1', 'r2', noopHooks);
    await flush(ctx);
    const assistants = sm.getNodes(t).filter((n) => n.role === 'assistant' && n.parentId === 'u1');
    const active = assistants.filter((n) => n.status !== 'undone' && n.status !== 'hidden');
    expect(assistants.length, '3 次生成 → 3 个 assistant 子节点').toBe(3);
    expect(active.length, '仅 1 个 active assistant').toBe(1);
  });

  it('[8] undo 后从父节点重新提问', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 2);
    await controller.undo('s', 'u2', noopHooks);
    controller.send('s', '新分支提问', { requestId: 'u2-new', parentNodeId: 'u1' }, noopHooks);
    await flush(ctx);
    const u2new = sm.getNode(t, 'u2-new');
    expect(u2new, 'undo 后可从父节点重新提问').toBeTruthy();
    expect(u2new!.parentId, '新提问挂在 u1 的 assistant 下').toBe(asstOf(sm, t, 'u1')!.id);
  });

  it('[9] delete 子树后隐藏一致性', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 3);
    await controller.delete('s', 'u2', noopHooks);
    expect(sm.getNode(t, 'u2')!.status, 'delete u2 → hidden').toBe('hidden');
    expect(sm.getNode(t, 'u3')!.status, '后代 u3 → hidden').toBe('hidden');
    expect(sm.getNode(t, 'u1')!.status, 'u1 保持可见').toBeUndefined();
  });

  it('[10] continue 对 undone assistant 的防护', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 1);
    const asst = asstOf(sm, t, 'u1')!;
    await sm.updateNode(t, asst.id, { status: 'undone' });
    const lenBefore = asst.content.length;
    controller.continue('s', 'u1', 'c1', noopHooks);
    await flush(ctx);
    const after = sm.getNode(t, asst.id)!;
    expect(after.content.length, 'continue 不修改 undone assistant 内容').toBe(lenBefore);
    expect(after.status, 'continue 不修改 undone 状态').toBe('undone');
  });

  it('[11] 只读终态防护（server 侧纵深防御）', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 2);
    // delete u2 → hidden；再 undo 不应复活、不应无谓 fork
    await controller.delete('s', 'u2', noopHooks);
    expect(sm.getNode(t, 'u2')!.status).toBe('hidden');
    const branchesBefore = sm.getTree(t)!.branches.length;
    await controller.undo('s', 'u2', noopHooks);
    expect(sm.getNode(t, 'u2')!.status, 'undo 对 hidden 无效（不复活）').toBe('hidden');
    expect(sm.getTree(t)!.branches.length, 'undo 对 hidden 不触发无谓 fork').toBe(branchesBefore);
    // retry 对 hidden 的 user 节点无效
    controller.retry('s', 'u2', 'u2-r', noopHooks);
    await flush(ctx);
    const newAsst = sm
      .getNodes(t)
      .filter(
        (n) =>
          n.role === 'assistant' &&
          n.parentId === 'u2' &&
          n.status !== 'undone' &&
          n.status !== 'hidden',
      );
    expect(newAsst.length, 'retry 对 hidden user 节点无效').toBe(0);

    // undo 对已 undone 节点无效（不无谓 fork）
    const ctx3 = await setupS();
    const t3 = await chain(ctx3, 2);
    await ctx3.controller.undo('s', 'u2', noopHooks);
    const b3 = ctx3.sm.getTree(t3)!.branches.length;
    await ctx3.controller.undo('s', 'u2', noopHooks);
    expect(ctx3.sm.getTree(t3)!.branches.length, 'undo 对已 undone 节点不触发无谓 fork').toBe(b3);
  });

  it('[12] 并发：同 session 写操作串行化（无落盘竞态）', async () => {
    const ctx = await setupS();
    const { sm, controller } = ctx;
    const t = await chain(ctx, 2); // u1→u2
    // 并发发起多个写操作（均入队串行，不应交错损坏）
    await Promise.all([
      controller.undo('s', 'u2', noopHooks),
      new Promise<void>((resolve) => {
        controller.send('s', '并发提问', { requestId: 'u3', parentNodeId: 'u1' }, noopHooks);
        void controller.getSession('s')!.queue.then(() => resolve());
      }),
    ]);
    expect(sm.getNode(t, 'u2')!.status, '并发后 undo(u2) 生效').toBe('undone');
    expect(sm.getNode(t, 'u3'), '并发后 send(u3) 生效').toBeTruthy();
    // 树结构完整性：所有节点可追溯，无损坏
    const allNodes = sm.getNodes(t);
    const ids = new Set(allNodes.map((n) => n.id));
    const orphans = allNodes.filter((n) => n.parentId !== null && !ids.has(n.parentId));
    expect(orphans.length, '无孤儿节点（树结构完整）').toBe(0);
  });
});
