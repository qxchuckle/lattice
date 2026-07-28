/**
 * ConversationController 编排核心测试（下沉后的关键路径）
 *
 * 由 scripts/verify-controller.mts 迁移。
 * 验证：send / continue / retry / undo / delete / interrupted 及 hooks 触发。
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConversationHooks } from '../src/index.js';
import { setup, flush, noopHooks, asstOf } from './helpers.js';

function makeLogHooks(log: string[]): ConversationHooks {
  return {
    onEvent: () => {},
    onError: (m) => log.push(`error:${m}`),
    onTreeUpdated: (_t, head) => log.push(`treeUpdated:${head}`),
    onTreeCreated: (t) => log.push(`treeCreated:${t}`),
  };
}

describe('ConversationController 编排核心', () => {
  it('send：懒创建树、user+assistant 节点、text 合并、done 捕获', async () => {
    const { sm, controller } = await setup();
    const log: string[] = [];
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '你好', { requestId: 'turn1' }, makeLogHooks(log));
    await flush(controller, 'sess1');

    const treeId = controller.getSession('sess1')!.treeId!;
    expect(treeId, '懒创建树').toBeTruthy();
    expect(
      log.some((l) => l.startsWith('treeCreated')),
      '触发 onTreeCreated',
    ).toBe(true);
    const userNode = sm.getNode(treeId, 'turn1');
    expect(userNode?.role, 'user 节点 turn1 已创建').toBe('user');
    const assistant = sm
      .getNodes(treeId)
      .find((n) => n.role === 'assistant' && n.parentId === 'turn1');
    expect(assistant, 'assistant 子节点已创建').toBeTruthy();
    expect(assistant!.content.length, '连续 text 事件合并为单块').toBe(1);
    expect((assistant!.content[0] as { text: string }).text).toBe('回复[你好]');
    const branch = sm.getTree(treeId)!.branches[0];
    expect(branch.sourceSessionId, 'branch.sourceSessionId 从 done 捕获').toBe('sess-1');
    expect(assistant!.metadata?.sourceMessageId, 'sourceMessageId 已持久化').toBeTruthy();
  });

  it('interrupted：source 不发 done → status=interrupted', async () => {
    const { sm, controller } = await setup(false); // 不发 done
    controller.createSession('sess2', 'mock', null);
    controller.send('sess2', '测试中断', { requestId: 'turn-int' }, noopHooks);
    await flush(controller, 'sess2');
    const treeId = controller.getSession('sess2')!.treeId!;
    const asst = sm
      .getNodes(treeId)
      .find((n) => n.role === 'assistant' && n.parentId === 'turn-int');
    expect(asst?.status, '未收到 done → interrupted').toBe('interrupted');
  });

  it('retry：旧 assistant undone + 新建 active + user 节点复用', async () => {
    const { baseDir, sm, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '你好', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;

    controller.retry('sess1', 'turn1', 'turn1-retry', noopHooks);
    await flush(controller, 'sess1');
    const assistants = sm
      .getNodes(treeId)
      .filter((n) => n.role === 'assistant' && n.parentId === 'turn1');
    expect(assistants.length, 'retry 后 turn1 有 2 个 assistant 子节点').toBe(2);
    expect(
      assistants.some((n) => n.status === 'undone'),
      '旧 assistant 标记 undone',
    ).toBe(true);
    expect(
      assistants.some((n) => n.status !== 'undone' && n.status !== 'hidden'),
      '新 assistant 为 active',
    ).toBe(true);
    const user1Lines = (await readFile(join(baseDir, treeId, 'nodes.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l.trim() && JSON.parse(l).id === 'turn1').length;
    expect(user1Lines, 'retry 复用 user 节点（JSONL 中 turn1 仅 1 行）').toBe(1);
  });

  it('undo：标记目标 + 后代为 undone；delete：标记 hidden', async () => {
    const { sm, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;
    controller.send('sess1', '第二轮', { requestId: 'turn2', parentNodeId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    expect(sm.getNode(treeId, 'turn2'), '第二轮 user 节点已创建').toBeTruthy();

    await controller.undo('sess1', 'turn2', noopHooks);
    expect(sm.getNode(treeId, 'turn2')?.status, 'undo: turn2 → undone').toBe('undone');
    const turn2Asst = sm
      .getNodes(treeId)
      .find((n) => n.role === 'assistant' && n.parentId === 'turn2');
    expect(turn2Asst?.status, 'undo: assistant 后代 → undone').toBe('undone');

    await controller.delete('sess1', 'turn2', noopHooks);
    expect(sm.getNode(treeId, 'turn2')?.status, 'delete: turn2 → hidden').toBe('hidden');
  });

  it('continue：在原节点追加内容', async () => {
    const { sm, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '你好', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;
    const asst = sm.getNodes(treeId).find((n) => n.role === 'assistant' && n.parentId === 'turn1')!;
    const beforeLen = asst.content.length;

    controller.continue('sess1', 'turn1', 'turn1-cont', noopHooks);
    await flush(controller, 'sess1');
    const after = sm.getNode(treeId, asst.id);
    expect(after!.content.length, 'continue 在原节点追加内容').toBeGreaterThan(beforeLen);
  });

  it('undo 不排队：另一节点流式进行中时立即生效，不等生成结束', async () => {
    const { sm, state, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    // 第一轮正常完成
    controller.send('sess1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;

    // 第二轮（新第一层线程）挂起不结束，模拟在途流式
    state.hangUntilAbort = true;
    controller.send('sess1', '第二轮', { requestId: 'turn2' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30)); // 等流进入挂起态
    const rt = controller.getRuntime('sess1')!;
    expect(rt.abortControllers.has('turn2'), 'turn2 流式在途').toBe(true);

    // 在途流式期间撤销 turn1：必须立即完成（旧实现会排队卡到流结束，这里会超时）
    await controller.undo('sess1', 'turn1', noopHooks);
    expect(sm.getNode(treeId, 'turn1')?.status, '流式期间 undo 立即生效').toBe('undone');
    expect(rt.abortControllers.has('turn2'), '不相干的在途流不受影响').toBe(true);

    // 收尾：中止在途流避免泄漏
    controller.abort('sess1', 'turn2');
    await flush(controller, 'sess1');
  });

  it('撤销正在流式的节点：中止在途请求，assistant 以同只读状态落盘且不推进 head', async () => {
    const { sm, state, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;

    state.hangUntilAbort = true;
    controller.send('sess1', '第二轮', { requestId: 'turn2', parentNodeId: 'turn1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));

    // 删除正在流式的 turn2：在途请求被中止，不用等流结束
    await controller.delete('sess1', 'turn2', noopHooks);
    expect(sm.getNode(treeId, 'turn2')?.status, 'turn2 立即 hidden').toBe('hidden');

    await flush(controller, 'sess1');
    // 流结束后落盘的 assistant 不得以 active/interrupted 挂在已删除节点下
    const asst = sm.getNodes(treeId).find((n) => n.role === 'assistant' && n.parentId === 'turn2');
    if (asst) {
      expect(asst.status, '迟到落盘的 assistant 随父只读').toBe('hidden');
      expect(sm.getTree(treeId)!.headNodeId, 'head 不推进到只读 assistant').not.toBe(asst.id);
    }
  });

  it('并行流式：两个第一层线程同时在途，互不阻塞', async () => {
    const { state, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    state.hangUntilAbort = true;

    controller.send('sess1', '线程A', { requestId: 'ta' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));
    controller.send('sess1', '线程B', { requestId: 'tb' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));

    const rt = controller.getRuntime('sess1')!;
    // 旧实现：B 排在 session 队列里等 A 流结束，永远不会同时在途
    expect(rt.abortControllers.has('ta'), '线程 A 流式在途').toBe(true);
    expect(rt.abortControllers.has('tb'), '线程 B 同时在途（跨分支并行）').toBe(true);

    controller.abort('sess1', 'ta');
    controller.abort('sess1', 'tb');
    await flush(controller, 'sess1');
  });

  it('同分支排队中被删除：不再请求模型 API', async () => {
    const { sm, state, calls, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    state.hangUntilAbort = true;

    // turn1 流式挂起；turn2 作为同分支追问排在其后（尚未起流）
    controller.send('sess1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));
    controller.send('sess1', '排队追问', { requestId: 'turn2', parentNodeId: 'turn1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));
    const treeId = controller.getSession('sess1')!.treeId!;

    // 删除排队中的 turn2，再结束 turn1 的流
    await controller.delete('sess1', 'turn2', noopHooks);
    expect(sm.getNode(treeId, 'turn2')?.status, 'turn2 立即 hidden').toBe('hidden');
    controller.abort('sess1', 'turn1');
    await flush(controller, 'sess1');

    // turn2 的流任务启动时发现节点已只读 → 根本不调模型（前后端一致，不白烧 token）
    expect(
      calls.prompts.some((p) => p.text === '排队追问'),
      '被删除的排队请求不调模型 API',
    ).toBe(false);
  });
});

describe('ConversationController 参数数据流（模型/思考/上下文 + usage）', () => {
  it('send 显式参数：落盘 user+assistant metadata 并传给源', async () => {
    const { sm, calls, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send(
      'sess1',
      '你好',
      { requestId: 'turn1', model: 'ultimate', thinkingLevel: 'high', contextWindow: 400000 },
      noopHooks,
    );
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;

    const user = sm.getNode(treeId, 'turn1');
    expect(user?.metadata?.model, 'user 节点落盘 model').toBe('ultimate');
    expect(user?.metadata?.thinkingLevel, 'user 节点落盘 thinkingLevel').toBe('high');
    expect(user?.metadata?.contextWindow, 'user 节点落盘 contextWindow').toBe(400000);

    const asst = asstOf(sm, treeId, 'turn1');
    expect(asst?.metadata?.model, 'assistant 落盘 model').toBe('ultimate');
    expect(asst?.metadata?.thinkingLevel, 'assistant 落盘 thinkingLevel').toBe('high');
    expect(asst?.metadata?.contextWindow, 'assistant 落盘 contextWindow').toBe(400000);

    const prompt = calls.prompts.find((p) => p.text === '你好');
    expect(prompt?.model, '参数传给源：model').toBe('ultimate');
    expect(prompt?.thinkingLevel, '参数传给源：thinkingLevel').toBe('high');
    expect(prompt?.contextWindow, '参数传给源：contextWindow').toBe(400000);
  });

  it('追问未显式指定：沿线程继承上一轮参数', async () => {
    const { sm, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send(
      'sess1',
      '第一轮',
      { requestId: 'u1', thinkingLevel: 'high', contextWindow: 400000 },
      noopHooks,
    );
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;

    // 追问不带参数 → 继承线程上一轮
    controller.send('sess1', '第二轮', { requestId: 'u2', parentNodeId: 'u1' }, noopHooks);
    await flush(controller, 'sess1');

    const u2 = sm.getNode(treeId, 'u2');
    expect(u2?.metadata?.thinkingLevel, '追问继承 thinkingLevel').toBe('high');
    expect(u2?.metadata?.contextWindow, '追问继承 contextWindow').toBe(400000);
    const a2 = asstOf(sm, treeId, 'u2');
    expect(a2?.metadata?.thinkingLevel, 'assistant 同样继承').toBe('high');
  });

  it('追问显式指定：覆盖线程继承（节点作用域编辑生效）', async () => {
    const { sm, calls, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '第一轮', { requestId: 'u1', thinkingLevel: 'high' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;

    // 节点作用域编辑后追问：显式 low 覆盖继承的 high
    controller.send(
      'sess1',
      '第二轮',
      { requestId: 'u2', parentNodeId: 'u1', thinkingLevel: 'low', contextWindow: 128000 },
      noopHooks,
    );
    await flush(controller, 'sess1');

    const u2 = sm.getNode(treeId, 'u2');
    expect(u2?.metadata?.thinkingLevel, '显式参数覆盖继承').toBe('low');
    expect(u2?.metadata?.contextWindow).toBe(128000);
    const prompt = calls.prompts.find((p) => p.text === '第二轮');
    expect(prompt?.thinkingLevel, '覆盖值传给源').toBe('low');
  });

  it("thinkingLevel='none'：归一化为不传给源（关闭思考哨兵值）", async () => {
    const { calls, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '你好', { requestId: 'turn1', thinkingLevel: 'none' }, noopHooks);
    await flush(controller, 'sess1');
    const prompt = calls.prompts.find((p) => p.text === '你好');
    expect(prompt?.thinkingLevel, "'none' 不传给源").toBeUndefined();
  });

  it('usage：done 事件用量落盘 assistant metadata（reload 后上下文指示可用）', async () => {
    const { sm, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '你好', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;
    const asst = asstOf(sm, treeId, 'turn1');
    expect(asst?.metadata?.usage?.input, 'usage.input 落盘').toBe(100);
    expect(asst?.metadata?.usage?.output, 'usage.output 落盘').toBe(50);
  });

  it('abortTreeStreams：订阅者归零宽限到期时中止该树全部在途流', async () => {
    const { sm, state, controller } = await setup();
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sess1');
    const treeId = controller.getSession('sess1')!.treeId!;

    // 两个分支的流同时挂起（跨分支并行）
    state.hangUntilAbort = true;
    controller.send('sess1', '线程A', { requestId: 'ta' }, noopHooks);
    controller.send('sess1', '线程B', { requestId: 'tb' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));
    const rt = controller.getRuntime('sess1')!;
    expect(rt.abortControllers.has('ta') && rt.abortControllers.has('tb'), '两流在途').toBe(true);

    // 宽限到期：一次性中止该树全部在途流
    controller.abortTreeStreams(treeId);
    expect(rt.abortControllers.size, '在途流全部中止').toBe(0);
    await flush(controller, 'sess1');
    // 中止后落盘为 interrupted（不丢节点）
    const asstA = sm.getNodes(treeId).find((n) => n.role === 'assistant' && n.parentId === 'ta');
    expect(asstA?.status, '中止的流落盘 interrupted').toBe('interrupted');
  });

  it('多客户端同树：共享 per-tree 锁域（getRuntime 同一实例）', async () => {
    const { controller } = await setup();
    controller.createSession('sA', 'mock', null);
    controller.send('sA', '第一轮', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sA');
    const treeId = controller.getSession('sA')!.treeId!;

    // 另一客户端连到同一树
    controller.createSession('sB', 'mock', treeId);
    expect(controller.getRuntime('sB'), '同树共享同一运行时锁域').toBe(controller.getRuntime('sA'));
  });

  it('多客户端同树：A 撤销中止 B 的在途流 + 同源 session 不并发 prompt', async () => {
    const { sm, state, controller } = await setup();
    controller.createSession('sA', 'mock', null);
    controller.send('sA', '第一轮', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 'sA');
    const treeId = controller.getSession('sA')!.treeId!;
    controller.createSession('sB', 'mock', treeId);

    // B 发起流式（挂起）
    state.hangUntilAbort = true;
    controller.send('sB', 'B提问', { requestId: 'turnB', parentNodeId: 'turn1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 30));
    const rt = controller.getRuntime('sA')!;
    expect(rt.abortControllers.has('turnB'), 'B 的流在途（共享锁域可见）').toBe(true);

    // A 撤销 B 正在回复的节点 → 跨连接中止 B 的在途流
    await controller.undo('sA', 'turnB', noopHooks);
    expect(rt.abortControllers.has('turnB'), 'A 撤销中止了 B 的流').toBe(false);
    expect(sm.getNode(treeId, 'turnB')?.status, 'turnB 标记 undone').toBe('undone');
    await flush(controller, 'sA');
    await flush(controller, 'sB');
  });
});
