/**
 * 消息排队（per-tree，server 单写权威）单元测试
 *
 * 覆盖：enqueue / queueUpdate（reorder/remove/edit/mode）/ getQueueState /
 *       cleanupQueue / EventBus 通知 / tryDispatch dispatch 链 / 防重入 /
 *       动态父节点解析（挂在锚定链路 leaf 后）/ streaming 期间入队自动续发。
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/index.js';
import type { ConversationController } from '../src/index.js';
import { setup, flush, noopHooks, asstOf } from './helpers.js';

/** 取 user 节点的首个 text 块内容 */
const textOf = (n: { content: unknown[] }): string => (n.content[0] as { text: string }).text;

/** 建一棵含已完成 turn1 的树，返回 treeId */
async function makeTree(controller: ConversationController, sid = 'sess1'): Promise<string> {
  controller.createSession(sid, 'mock', null);
  controller.send(sid, '你好', { requestId: 'turn1' }, noopHooks);
  await flush(controller, sid);
  return controller.getSession(sid)!.treeId!;
}

/** 反复 flush 直到队列清空且无在途 dispatch（dispatch 链是级联异步，需多轮） */
async function flushUntilQueueEmpty(
  controller: ConversationController,
  sid: string,
  treeId: string,
  maxRounds = 12,
): Promise<void> {
  for (let i = 0; i < maxRounds; i++) {
    await flush(controller, sid);
    const st = controller.getQueueState(treeId);
    if (st.messages.length === 0 && st.dispatching === null) return;
  }
}

describe('消息排队：队列操作', () => {
  it('enqueue：追加到末尾 + order 递增 + 字段完整 + 默认 mode=queue', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    const m1 = controller.enqueue(treeId, { content: '排队1', anchorTurnId: 'turn1' });
    const m2 = controller.enqueue(treeId, {
      content: '排队2',
      anchorTurnId: 'turn1',
      mode: 'steer',
      model: 'ultimate',
      createdBy: 'conn-A',
    });

    expect(m1.id, '生成唯一 ID').toBeTruthy();
    expect(m1.order).toBe(0);
    expect(m2.order).toBe(1);
    expect(m1.mode, '缺省 mode=queue').toBe('queue');
    expect(m2.mode).toBe('steer');
    expect(m2.model).toBe('ultimate');
    expect(m2.createdBy).toBe('conn-A');
    expect(m1.anchorTurnId).toBe('turn1');

    const st = controller.getQueueState(treeId);
    expect(st.messages).toHaveLength(2);
    expect(st.dispatching).toBeNull();
  });

  it('enqueue/queueUpdate 经 EventBus emit queue:changed（携带 treeId）', async () => {
    const events = new EventBus();
    const seen: string[] = [];
    events.on('queue:changed', (e) => seen.push((e.payload as { treeId: string }).treeId));
    const { controller } = await setup(true, events);
    const treeId = await makeTree(controller);

    const m = controller.enqueue(treeId, { content: 'x', anchorTurnId: 'turn1' });
    controller.queueUpdate(treeId, m.id, { action: 'remove' });
    expect(seen, '入队与更新各通知一次').toEqual([treeId, treeId]);
  });

  it('queueUpdate reorder：移动位置 + 重编 order 稠密', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    const a = controller.enqueue(treeId, { content: 'A', anchorTurnId: 'turn1' });
    controller.enqueue(treeId, { content: 'B', anchorTurnId: 'turn1' });
    const c = controller.enqueue(treeId, { content: 'C', anchorTurnId: 'turn1' });

    controller.queueUpdate(treeId, c.id, { action: 'reorder', newIndex: 0 });
    const msgs = controller.getQueueState(treeId).messages;
    expect(
      msgs.map((m) => m.content),
      'C 移到最前',
    ).toEqual(['C', 'A', 'B']);
    expect(
      msgs.map((m) => m.order),
      'order 重编为 0/1/2',
    ).toEqual([0, 1, 2]);
    void a;
  });

  it('queueUpdate remove：移除 + 重编 order', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    const a = controller.enqueue(treeId, { content: 'A', anchorTurnId: 'turn1' });
    controller.enqueue(treeId, { content: 'B', anchorTurnId: 'turn1' });

    controller.queueUpdate(treeId, a.id, { action: 'remove' });
    const msgs = controller.getQueueState(treeId).messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('B');
    expect(msgs[0].order, '剩余消息 order 归零').toBe(0);
  });

  it('queueUpdate edit：更新 content/segments', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    const a = controller.enqueue(treeId, { content: '原内容', anchorTurnId: 'turn1' });
    controller.queueUpdate(treeId, a.id, { action: 'edit', content: '新内容' });
    expect(controller.getQueueState(treeId).messages[0].content).toBe('新内容');
  });

  it('queueUpdate mode：切换投递模式', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    const a = controller.enqueue(treeId, { content: 'A', anchorTurnId: 'turn1' });
    expect(controller.getQueueState(treeId).messages[0].mode).toBe('queue');
    controller.queueUpdate(treeId, a.id, { action: 'mode', mode: 'steer' });
    expect(controller.getQueueState(treeId).messages[0].mode).toBe('steer');
  });

  it('queueUpdate：未知 messageId 静默忽略（不抛错、不改队列）', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    controller.enqueue(treeId, { content: 'A', anchorTurnId: 'turn1' });
    controller.queueUpdate(treeId, 'nonexistent', { action: 'remove' });
    expect(controller.getQueueState(treeId).messages).toHaveLength(1);
  });

  it('cleanupQueue：释放锁域（排队消息清空）', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    controller.enqueue(treeId, { content: 'A', anchorTurnId: 'turn1' });
    expect(controller.getQueueState(treeId).messages).toHaveLength(1);
    controller.cleanupQueue(treeId);
    expect(controller.getQueueState(treeId).messages, '清理后队列为空').toHaveLength(0);
  });
});

describe('消息排队：tryDispatch dispatch 链', () => {
  it('未注册 queueHooks 不 dispatch（纯 agent 场景，消息留在队列）', async () => {
    const { calls, controller } = await setup();
    const treeId = await makeTree(controller);
    controller.enqueue(treeId, { content: '排队', anchorTurnId: 'turn1' });
    const before = calls.prompts.length;

    controller.tryDispatch(treeId);
    await flush(controller, 'sess1');

    expect(calls.prompts.length, '未调源').toBe(before);
    expect(controller.getQueueState(treeId).messages, '消息仍在队列').toHaveLength(1);
  });

  it('空队列 tryDispatch no-op（不抛错）', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    controller.setQueueHooks(noopHooks);
    controller.tryDispatch(treeId);
    expect(controller.getQueueState(treeId).messages).toHaveLength(0);
    expect(controller.getQueueState(treeId).dispatching).toBeNull();
  });

  it('dispatch：排队消息走 send 路径生成真实节点，挂在锚定链路 leaf 后', async () => {
    const { sm, controller } = await setup();
    const treeId = await makeTree(controller);
    controller.setQueueHooks(noopHooks);
    const turn1Asst = asstOf(sm, treeId, 'turn1')!;

    controller.enqueue(treeId, { content: '排队消息', anchorTurnId: 'turn1' });
    controller.tryDispatch(treeId);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    // 排队消息成为 user 节点，父节点 = turn1 的 assistant（链路 leaf），而非 turn1 本身
    const queuedUser = sm
      .getNodes(treeId)
      .find((n) => n.role === 'user' && n.parentId === turn1Asst.id);
    expect(queuedUser, '挂在链路 leaf（turn1 的 assistant）后').toBeTruthy();
    expect(textOf(queuedUser!)).toBe('排队消息');
    expect(asstOf(sm, treeId, queuedUser!.id), '排队消息得到回复').toBeTruthy();
    expect(controller.getQueueState(treeId).messages).toHaveLength(0);
    expect(controller.getQueueState(treeId).dispatching, 'dispatch 标记已清').toBeNull();
  });

  it('dispatch 链：turn 落定后自动续发下一条，按 order 顺序串成链', async () => {
    const { sm, controller } = await setup();
    const treeId = await makeTree(controller);
    controller.setQueueHooks(noopHooks);
    controller.enqueue(treeId, { content: '第一条', anchorTurnId: 'turn1' });
    controller.enqueue(treeId, { content: '第二条', anchorTurnId: 'turn1' });
    controller.enqueue(treeId, { content: '第三条', anchorTurnId: 'turn1' });

    controller.tryDispatch(treeId);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    // 三条都成为 user 节点，且按序串链：turn1-asst → 第一条 → 其 asst → 第二条 → 其 asst → 第三条
    const turn1Asst = asstOf(sm, treeId, 'turn1')!;
    const first = sm
      .getNodes(treeId)
      .find((n) => n.role === 'user' && n.parentId === turn1Asst.id)!;
    expect(textOf(first), '第一条挂在 turn1 链路 leaf 后').toBe('第一条');
    const second = sm
      .getNodes(treeId)
      .find((n) => n.role === 'user' && n.parentId === asstOf(sm, treeId, first.id)!.id)!;
    expect(textOf(second), '第二条挂在第一条回复后（动态解析 leaf）').toBe('第二条');
    const third = sm
      .getNodes(treeId)
      .find((n) => n.role === 'user' && n.parentId === asstOf(sm, treeId, second.id)!.id)!;
    expect(textOf(third), '第三条挂在第二条回复后').toBe('第三条');

    expect(controller.getQueueState(treeId).messages).toHaveLength(0);
    expect(controller.getQueueState(treeId).dispatching).toBeNull();
  });

  it('pendingDispatching 防重入：dispatch 后、turn 落定前再调 tryDispatch 不发第二条', async () => {
    const { controller } = await setup();
    const treeId = await makeTree(controller);
    controller.setQueueHooks(noopHooks);
    controller.enqueue(treeId, { content: '第一条', anchorTurnId: 'turn1' });
    controller.enqueue(treeId, { content: '第二条', anchorTurnId: 'turn1' });

    controller.tryDispatch(treeId); // dispatch 第一条（send 异步，turn 未落定）
    expect(controller.getQueueState(treeId).dispatching, 'dispatching 已标记').toBeTruthy();
    controller.tryDispatch(treeId); // 应被 pendingDispatching 挡住

    expect(
      controller.getQueueState(treeId).messages.map((m) => m.content),
      '第二条仍在队列（未被提前 dispatch）',
    ).toEqual(['第二条']);

    await flushUntilQueueEmpty(controller, 'sess1', treeId);
    expect(controller.getQueueState(treeId).messages, '落定后第二条续发').toHaveLength(0);
  });

  it('streaming 期间入队 + turn 落定 → 自动 dispatch（无需手动 tryDispatch）', async () => {
    const { sm, state, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    state.hangUntilAbort = true;
    controller.send('sess1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30)); // turn1 流式挂起中
    const treeId = controller.getSession('sess1')!.treeId!;
    controller.setQueueHooks(noopHooks);
    controller.enqueue(treeId, { content: '排队消息', anchorTurnId: 'turn1' });

    state.hangUntilAbort = false; // 后续 turn 正常完成（不影响已挂起的 turn1）
    controller.abort('sess1', 'turn1'); // turn1 落定（interrupted）→ onTreeUpdated → 自动 dispatch
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    const queuedUser = sm
      .getNodes(treeId)
      .find((n) => n.role === 'user' && textOf(n) === '排队消息');
    expect(queuedUser, '排队消息被自动 dispatch').toBeTruthy();
    expect(asstOf(sm, treeId, queuedUser!.id), '得到回复').toBeTruthy();
    expect(controller.getQueueState(treeId).messages).toHaveLength(0);
  });
});

describe('消息排队：错误路径 dispatch 链收敛（审查 #1/#2）', () => {
  it('dispatched 消息终结性失败（锚定节点被删）→ 队列续发不卡死 (#1)', async () => {
    const { sm, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '线程A', { requestId: 'turnA' }, noopHooks);
    await flush(controller, 'sess1');
    controller.send('sess1', '线程B', { requestId: 'turnB' }, noopHooks); // 第二第一层线程（独立分支）
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;
    controller.setQueueHooks(noopHooks);

    // msg1 锚定 turnA（即将被删），msg2 锚定 turnB（有效）
    controller.enqueue(treeId, { content: '将失败', anchorTurnId: 'turnA' });
    controller.enqueue(treeId, { content: '将成功', anchorTurnId: 'turnB' });

    // 删除 turnA 子树 → 只读；msg1 的 dispatch 将命中 doSend 只读守卫终结报错（无 onTreeUpdated）
    await controller.delete('sess1', 'turnA', noopHooks);

    controller.tryDispatch(treeId);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    // 关键：msg1 终结失败后 msg2 仍被续发（修复前队列会永久卡住 msg2）
    const nodes = sm.getNodes(treeId);
    expect(
      nodes.some((n) => n.role === 'user' && textOf(n) === '将成功'),
      'msg2 被续发',
    ).toBe(true);
    expect(controller.getQueueState(treeId).messages, '队列排空（两条都已尝试）').toHaveLength(0);
    expect(controller.getQueueState(treeId).dispatching).toBeNull();
  });

  it('锚定节点被物理删除（tree.delete）→ dispatch 不建孤儿节点，队列续发 (审查警告)', async () => {
    const { sm, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    // 追问 turn2（非根节点，挂在 turn1 的 assistant 下）
    controller.send('sess1', '第二轮', { requestId: 'turn2', parentNodeId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;
    controller.setQueueHooks(noopHooks);

    // msg1 锚定 turn2（即将被物理删），msg2 锚定 turn1（有效）
    controller.enqueue(treeId, { content: '将失败', anchorTurnId: 'turn2' });
    controller.enqueue(treeId, { content: '将成功', anchorTurnId: 'turn1' });

    // 物理删除 turn2 及子树（节点不复存在，区别于 markNodes 的只读标记；根节点不可删故删追问节点）
    await sm.deleteNodes(treeId, ['turn2']);

    controller.tryDispatch(treeId);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    const nodes = sm.getNodes(treeId);
    // 关键：不产生挂在已删 turn2 下的孤儿节点（修复前 addNode 会挂出 UI 不可达孤儿，消息静默丢失）
    expect(
      nodes.some((n) => n.parentId === 'turn2'),
      '不建孤儿节点',
    ).toBe(false);
    expect(
      nodes.some((n) => n.role === 'user' && textOf(n) === '将成功'),
      'msg2 仍被续发',
    ).toBe(true);
    expect(controller.getQueueState(treeId).messages, '队列排空').toHaveLength(0);
  });

  it('流内 error 事件不提前释放 dispatch 锁（落定后续发）(#2)', async () => {
    const { state, controller } = await setup();
    const treeId = await makeTree(controller);
    controller.setQueueHooks(noopHooks);
    controller.enqueue(treeId, { content: '第一条', anchorTurnId: 'turn1' });
    controller.enqueue(treeId, { content: '第二条', anchorTurnId: 'turn1' });

    state.emitMidError = true; // 第一条的 turn 发流内 error 事件（流继续）
    state.hangUntilAbort = true; // 然后挂起
    controller.tryDispatch(treeId); // dispatch 第一条
    await new Promise((r) => setTimeout(r, 50)); // 等流式启动 + error 事件处理

    // 流内 error 不应提前释放锁：第二条仍在队列，dispatching 仍为第一条
    const st = controller.getQueueState(treeId);
    expect(
      st.messages.map((m) => m.content),
      '流内错误不触发提前 dispatch',
    ).toEqual(['第二条']);
    expect(st.dispatching, 'dispatch 锁仍持有').toBeTruthy();

    // 中止第一条 → 落定 → 第二条续发
    state.emitMidError = false;
    state.hangUntilAbort = false;
    controller.abort('sess1', st.dispatching!);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);
    expect(controller.getQueueState(treeId).messages, '第二条最终被续发').toHaveLength(0);
  });
});

describe('消息排队：第三轮审查修复（跨分支并发 / 无订阅者）', () => {
  it('锚定 turn 流式中（assistant 未落盘）→ dispatch 让位，防 user→user (审查 #1)', async () => {
    const { sm, state, controller } = await setup();
    const treeId = await makeTree(controller); // turn1 完成
    controller.setQueueHooks(noopHooks);

    // turn2 追问流式挂起（assistant 未落盘）
    state.hangUntilAbort = true;
    controller.send('sess1', 'turn2', { requestId: 'turn2', parentNodeId: 'turn1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));

    // M 锚定 turn2（流式中）：tryDispatch 应让位（turn2 链路 leaf 是未落定 user 节点）
    controller.enqueue(treeId, { content: 'M', anchorTurnId: 'turn2' });
    controller.tryDispatch(treeId);
    expect(
      controller.getQueueState(treeId).messages.map((m) => m.content),
      '锚定流式中 → 不 dispatch（防 user→user）',
    ).toEqual(['M']);
    expect(
      sm.getNodes(treeId).some((n) => n.role === 'user' && n.parentId === 'turn2'),
      '不挂 user→user',
    ).toBe(false);

    // 中止 turn2 → 落定（interrupted，assistant 落盘）→ M 被续发挂在 turn2 的 assistant 后
    state.hangUntilAbort = false;
    controller.abort('sess1', 'turn2');
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    const turn2Asst = asstOf(sm, treeId, 'turn2')!;
    expect(turn2Asst?.status, 'turn2 落 interrupted').toBe('interrupted');
    const mUser = sm.getNodes(treeId).find((n) => n.role === 'user' && textOf(n) === 'M');
    expect(mUser, 'M 被 dispatch').toBeTruthy();
    expect(mUser!.parentId, 'M 挂在 turn2 的 assistant 后（非 user→user）').toBe(turn2Asst.id);
  });

  it('无订阅者（全断连）→ 不 dispatch，避免无人空烧 token (审查 #2)', async () => {
    const { sm, controller } = await setup();
    const treeId = await makeTree(controller);
    controller.setQueueHooks(noopHooks);
    controller.setSubscriberCheck(() => false); // 模拟无订阅者
    controller.enqueue(treeId, { content: 'M', anchorTurnId: 'turn1' });

    controller.tryDispatch(treeId);
    await flush(controller, 'sess1');
    expect(controller.getQueueState(treeId).messages, '无订阅者 → 不 dispatch').toHaveLength(1);
    expect(
      sm.getNodes(treeId).some((n) => n.role === 'user' && textOf(n) === 'M'),
      'M 未发出',
    ).toBe(false);

    // 订阅者恢复（重连）→ 恢复 dispatch
    controller.setSubscriberCheck(() => true);
    controller.tryDispatch(treeId);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);
    expect(controller.getQueueState(treeId).messages, '有订阅者后续发').toHaveLength(0);
    expect(
      sm.getNodes(treeId).some((n) => n.role === 'user' && textOf(n) === 'M'),
      'M 已发出',
    ).toBe(true);
  });
});

describe('消息排队：第四轮审查修复（readonly-skipped 不卡死）', () => {
  it('锚定只读且无 assistant 的 user 节点（readonly-skipped）→ 不让位，守卫报错自愈续发 (审查 r4)', async () => {
    const { sm, state, controller } = await setup();
    const treeId = await makeTree(controller); // turn1 完成
    controller.setQueueHooks(noopHooks);

    // turnA 追问流式挂起，占用分支流队列
    state.hangUntilAbort = true;
    controller.send('sess1', 'turnA', { requestId: 'turnA', parentNodeId: 'turn1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));
    // U 追问 turnA：doSend 建 U 的 user 节点，但 runTurn 排在 turnA 之后（尚未执行）
    controller.send('sess1', 'U', { requestId: 'U', parentNodeId: 'turnA' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));

    // 在 U 的 runTurn 执行前撤销 U → U 只读（undone），runTurn 未起无 assistant
    await controller.undo('sess1', 'U', noopHooks);
    expect(sm.getNode(treeId, 'U')?.status, 'U 已 undone').toBe('undone');

    // M 锚定 U；结束 turnA → U 的 runTurn 走 readonly-skipped（不落 assistant）→ 触发 tryDispatch
    controller.enqueue(treeId, { content: 'M', anchorTurnId: 'U' });
    state.hangUntilAbort = false;
    controller.abort('sess1', 'turnA');
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    // 关键：只读 U（无 assistant）不让位/卡死；M 走 doSend 守卫报错排空队列（自愈）
    expect(
      sm.getNodes(treeId).some((n) => n.role === 'assistant' && n.parentId === 'U'),
      'U 无 assistant（readonly-skipped）',
    ).toBe(false);
    expect(controller.getQueueState(treeId).messages, '队列排空（未卡死）').toHaveLength(0);
    expect(controller.getQueueState(treeId).dispatching).toBeNull();
    expect(
      sm.getNodes(treeId).some((n) => n.role === 'user' && textOf(n) === 'M'),
      'M 未建节点（守卫拦截）',
    ).toBe(false);
  });

  it('锚定 turn 零内容正常完成（不落 assistant）→ 不卡死，放行续发自愈 (审查 r5)', async () => {
    const { sm, state, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    state.zeroContent = true;
    controller.send('sess1', '零内容回复', { requestId: 'turnZ' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;
    // turnZ 正常完成但零内容：user 节点活跃、无 assistant（openTurn 已落定注销）
    expect(sm.getNode(treeId, 'turnZ')?.role, 'turnZ user 节点存在').toBe('user');
    expect(
      sm.getNodes(treeId).some((n) => n.role === 'assistant' && n.parentId === 'turnZ'),
      '零内容不落 assistant',
    ).toBe(false);

    state.zeroContent = false;
    controller.setQueueHooks(noopHooks);
    controller.enqueue(treeId, { content: 'M', anchorTurnId: 'turnZ' });
    controller.tryDispatch(treeId);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    // 关键：不永久卡死——M 被 dispatch（挂在 turnZ 下自愈）并得到回复
    expect(controller.getQueueState(treeId).messages, '队列排空（不卡死）').toHaveLength(0);
    expect(controller.getQueueState(treeId).dispatching).toBeNull();
    const mUser = sm.getNodes(treeId).find((n) => n.role === 'user' && textOf(n) === 'M');
    expect(mUser, 'M 被 dispatch').toBeTruthy();
    expect(asstOf(sm, treeId, mUser!.id), 'M 得到回复').toBeTruthy();
  });
});

describe('消息排队：steer 引导（P3a abort+restart）', () => {
  it('steer：中止当前流（落 interrupted）+ steer 消息插队最先 dispatch', async () => {
    const { sm, state, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    state.hangUntilAbort = true;
    controller.send('sess1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30)); // turn1 流式挂起中
    const treeId = controller.getSession('sess1')!.treeId!;
    controller.setQueueHooks(noopHooks);
    controller.enqueue(treeId, { content: '排队1', anchorTurnId: 'turn1' });
    const steerMsg = controller.enqueue(treeId, { content: 'steer消息', anchorTurnId: 'turn1' });
    controller.enqueue(treeId, { content: '排队2', anchorTurnId: 'turn1' });

    state.hangUntilAbort = false; // 后续 turn 正常完成
    controller.steer(treeId, steerMsg.id);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    // 当前回复被中止落 interrupted（可续写恢复）
    const turn1Asst = asstOf(sm, treeId, 'turn1');
    expect(turn1Asst?.status, '当前回复中止落 interrupted').toBe('interrupted');

    // steer 消息被 dispatch（挂在 turn1 链路 leaf 后），且先于排队1/排队2
    const nodes = sm.getNodes(treeId);
    const steerUser = nodes.find((n) => n.role === 'user' && textOf(n) === 'steer消息');
    expect(steerUser, 'steer 消息被 dispatch').toBeTruthy();
    expect(steerUser!.parentId, '挂在 turn1 的 assistant 后').toBe(turn1Asst!.id);
    expect(asstOf(sm, treeId, steerUser!.id), 'steer 消息得到回复').toBeTruthy();

    // 排队1/排队2 随后也被 dispatch（steer 插队不影响其余消息）
    expect(
      nodes.some((n) => n.role === 'user' && textOf(n) === '排队1'),
      '排队1 被 dispatch',
    ).toBe(true);
    expect(
      nodes.some((n) => n.role === 'user' && textOf(n) === '排队2'),
      '排队2 被 dispatch',
    ).toBe(true);
    expect(controller.getQueueState(treeId).messages, '队列清空').toHaveLength(0);
  });

  it('steer：无在途流时直接 dispatch（插队到最前）', async () => {
    const { sm, controller } = await setup();
    const treeId = await makeTree(controller);
    controller.setQueueHooks(noopHooks);
    controller.enqueue(treeId, { content: '排队1', anchorTurnId: 'turn1' });
    const steerMsg = controller.enqueue(treeId, { content: 'steer消息', anchorTurnId: 'turn1' });

    controller.steer(treeId, steerMsg.id);
    await flushUntilQueueEmpty(controller, 'sess1', treeId);

    const nodes = sm.getNodes(treeId);
    const turn1Asst = asstOf(sm, treeId, 'turn1')!;
    // steer 消息最先 dispatch（挂在 turn1-asst 后），排队1 跟在其后
    const steerUser = nodes.find((n) => n.role === 'user' && n.parentId === turn1Asst.id)!;
    expect(textOf(steerUser), 'steer 插队最先').toBe('steer消息');
    const queued1 = nodes.find((n) => n.role === 'user' && textOf(n) === '排队1');
    expect(queued1!.parentId, '排队1 跟在 steer 回复后').toBe(asstOf(sm, treeId, steerUser.id)!.id);
  });
});
