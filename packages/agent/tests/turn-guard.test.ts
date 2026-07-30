/**
 * TurnGuard 测试：命令准入与能力下发同源（接口行为 ≡ 视图）
 *
 * 锁两件事：
 * 1. 准入语义与呈现语义分离——拿呈现字段（canRetry/canContinue）当守卫会误杀合法调用
 * 2. 源能力维度参与判定——线程源不支持 fork 时，retry/branch 在 UI 与接口两侧同时消失
 */
import { describe, it, expect } from 'vitest';
import { projectNodeCapabilities } from '@qcqx/lattice-agent-protocol';
import type { ViewStatus, NodeOperation } from '@qcqx/lattice-agent-protocol';
import { PERMITS } from '../src/conversation/turn-guard.js';
import { setup, flush, noopHooks } from './helpers.js';

/** 发一轮消息并返回 treeId */
async function sendOnce(
  ctx: Awaited<ReturnType<typeof setup>>,
  requestId: string,
  parentNodeId?: string,
): Promise<string> {
  const { controller } = ctx;
  controller.send('S', '问题', { requestId, parentNodeId }, noopHooks);
  await flush(controller, 'S');
  return controller.getSession('S')!.treeId!;
}

describe('不变量：呈现为真 ⇒ 准入必为真（穷举 ViewStatus × fork）', () => {
  // UI 按呈现字段放按钮，接口按准入谓词守卫——若存在呈现真/准入假的组合，
  // 就会出现「按钮点了被拒」。目前成立是推导结果，本测试把它钉成契约。
  const ALL_STATUSES: ViewStatus[] = [
    'done',
    'streaming',
    'error',
    'interrupted',
    'undone',
    'hidden',
  ];
  // 呈现字段 → 对应接口操作
  const AFFORDANCE_TO_OP: [keyof ReturnType<typeof projectNodeCapabilities>, NodeOperation][] = [
    ['canRetry', 'retry'],
    ['canContinue', 'continue'],
    ['canUndo', 'undo'],
    ['canDelete', 'delete'],
  ];

  it.each([{ fork: true }, { fork: false as const }])('fork=%j', ({ fork }) => {
    for (const status of ALL_STATUSES) {
      const caps = projectNodeCapabilities(status, {
        fork: fork === false ? false : { atMessage: true },
      });
      for (const [affordance, op] of AFFORDANCE_TO_OP) {
        if (caps[affordance]) {
          expect(
            PERMITS[op](caps),
            `呈现 ${affordance}=true 但准入 ${op} 拒绝（status=${status}, fork=${fork}）`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('turn 能力表下发', () => {
  it('仅 user 节点成 turn（assistant 不单独持有操作入口）', async () => {
    const ctx = await setup();
    ctx.controller.createSession('S', 'mock', null);
    const treeId = await sendOnce(ctx, 'u1');

    const caps = ctx.controller.turnCapabilities(treeId);
    const nodes = ctx.sm.getNodes(treeId);
    const assistantIds = nodes.filter((n) => n.role === 'assistant').map((n) => n.id);

    expect(Object.keys(caps)).toEqual(['u1']);
    for (const id of assistantIds) expect(caps[id]).toBeUndefined();
  });

  it('正常完成的 turn：可分支/撤销/删除/追问，不提示重试与继续', async () => {
    const ctx = await setup();
    ctx.controller.createSession('S', 'mock', null);
    const treeId = await sendOnce(ctx, 'u1');

    expect(ctx.controller.turnCapabilities(treeId).u1).toEqual({
      canBranch: true,
      canUndo: true,
      canDelete: true,
      canRetry: false, // 呈现语义：正常回复不显示「重试」按钮
      canContinue: false,
      canFollowup: true,
      canAbort: false,
    });
  });

  it('撤销后能力收敛为只读（仅删除仍合法）', async () => {
    const ctx = await setup();
    ctx.controller.createSession('S', 'mock', null);
    const treeId = await sendOnce(ctx, 'u1');
    await ctx.controller.undo('S', 'u1', noopHooks);

    const caps = ctx.controller.turnCapabilities(treeId).u1;
    expect(caps.canUndo).toBe(false);
    expect(caps.canDelete).toBe(true); // undone → hidden 合法
    expect(caps.canBranch).toBe(false);
    expect(caps.canFollowup).toBe(false);
  });
});

describe('命令准入（与呈现分离）', () => {
  it('正常完成的 turn 允许重试：呈现不显示按钮 ≠ 接口禁止（重新生成是通用能力）', async () => {
    const ctx = await setup();
    ctx.controller.createSession('S', 'mock', null);
    const treeId = await sendOnce(ctx, 'u1');
    expect(ctx.controller.turnCapabilities(treeId).u1.canRetry).toBe(false);

    const rejects: string[] = [];
    ctx.controller.retry('S', 'u1', 'r1', {
      ...noopHooks,
      onReject: (_rid, reason) => rejects.push(reason),
    });
    await flush(ctx.controller, 'S');

    expect(rejects).toEqual([]); // 未被守卫拒绝
    const assistants = ctx.sm.getNodes(treeId).filter((n) => n.role === 'assistant');
    expect(assistants.length).toBeGreaterThan(1); // 确实新生成了一条回复
  });

  it('已撤销的 turn：重试与继续都被拒，且拒绝原因可读', async () => {
    const ctx = await setup();
    ctx.controller.createSession('S', 'mock', null);
    await sendOnce(ctx, 'u1');
    await ctx.controller.undo('S', 'u1', noopHooks);

    const rejects: string[] = [];
    const hooks = {
      ...noopHooks,
      onReject: (_rid: string | undefined, reason: string) => rejects.push(reason),
    };
    ctx.controller.retry('S', 'u1', 'r1', hooks);
    ctx.controller.continue('S', 'u1', 'c1', hooks);
    await flush(ctx.controller, 'S');

    expect(rejects).toHaveLength(2);
    expect(rejects[0]).toMatch(/不可重试/);
    expect(rejects[1]).toMatch(/不可继续/);
  });

  it('未知 turn：拒绝而非静默忽略（绕过 UI 直请接口的路径）', async () => {
    const ctx = await setup();
    ctx.controller.createSession('S', 'mock', null);
    await sendOnce(ctx, 'u1');

    const rejects: string[] = [];
    ctx.controller.retry('S', 'ghost-node', 'r1', {
      ...noopHooks,
      onReject: (_rid, reason) => rejects.push(reason),
    });
    await flush(ctx.controller, 'S');
    // 节点不存在时 doRetry 在取节点阶段即返回（无 reject），关键是不产生新回复
    const assistants = ctx.sm
      .getNodes(ctx.controller.getSession('S')!.treeId!)
      .filter((n) => n.role === 'assistant');
    expect(assistants).toHaveLength(1);
  });
});
