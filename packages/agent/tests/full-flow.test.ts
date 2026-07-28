/**
 * 全业务流测试 — ConversationController + SessionManager 端到端业务逻辑
 *
 * 由 scripts/verify-full-flow.mts 迁移。
 * 用可记录调用的 mock source 验证真实业务语义（resume / fork 截断点 / 分支隔离 / 状态机）。
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionManager } from '../src/index.js';
import { setup, flush, noopHooks } from './helpers.js';

describe('场景 1: 多轮对话 + 父节点解析（user→assistant 链接，resume 同源）', () => {
  it('首轮新建 session，第二轮 resume 同源', async () => {
    const { sm, calls, controller } = await setup();
    controller.createSession('s1', 'mock', null);

    controller.send('s1', '第一轮', { requestId: 'turn1' }, noopHooks);
    await flush(controller, 's1');
    const tid = controller.getSession('s1')!.treeId!;
    const asst1 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'turn1')!;

    expect(calls.prompts[0].sessionId, '首轮 prompt 传 null（新建 session）').toBeNull();
    expect(sm.getTree(tid)!.branches[0].sourceSessionId, 'done 捕获 branch session').toBe('sess-1');
    expect(asst1.metadata?.sourceMessageId, 'asst1.sourceMessageId').toBe('msg-1');

    // 第二轮：parentNodeId=turn1（user 节点）→ 应链接到 asst1
    controller.send('s1', '第二轮', { requestId: 'turn2', parentNodeId: 'turn1' }, noopHooks);
    await flush(controller, 's1');
    const turn2 = sm.getNode(tid, 'turn2')!;
    expect(turn2.parentId, 'turn2 父节点解析为 asst1').toBe(asst1.id);
    expect(calls.prompts[1].sessionId, '第二轮 resume 同一 session').toBe('sess-1');
    const asst2 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'turn2')!;
    expect(asst2.metadata?.sourceMessageId).toBe('msg-2');
    expect(sm.getTree(tid)!.branches[0].sourceSessionId, 'resume 不改变 branch session').toBe(
      'sess-1',
    );
  });
});

describe('场景 2: 自动 fork（父节点已有 user 子节点 → 兄弟分支 + 源 fork 截断）', () => {
  it('重复从同一父节点发起 → 新分支 + forked session', async () => {
    const { sm, calls, controller } = await setup();
    controller.createSession('s2', 'mock', null);
    controller.send('s2', '第一轮', { requestId: 't1' }, noopHooks);
    await flush(controller, 's2');
    const tid = controller.getSession('s2')!.treeId!;
    const asst1 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 't1')!;
    controller.send('s2', '第二轮', { requestId: 't2', parentNodeId: 't1' }, noopHooks);
    await flush(controller, 's2');

    const branchesBefore = sm.getTree(tid)!.branches.length;
    // 再次从 t1 发起（t1 已有 user 子节点 t2）→ 触发自动 fork
    controller.send('s2', '分支提问', { requestId: 't3', parentNodeId: 't1' }, noopHooks);
    await flush(controller, 's2');

    const tree = sm.getTree(tid)!;
    expect(tree.branches.length, '自动 fork 创建新分支').toBe(branchesBefore + 1);
    const t3 = sm.getNode(tid, 't3')!;
    expect(t3.parentId, '分支提问 t3 挂在 asst1 下').toBe(asst1.id);
    const newBranch = tree.branches.find((b) => b.id === t3.branchId)!;
    expect(newBranch.id, 't3 在新分支（非默认分支）').not.toBe(tree.defaultBranchId);
    expect(
      calls.forks.some((f) => f.sessionId === 'sess-1' && f.atMessage === 'msg-1'),
      'fork 截断点 = asst1 的 sourceMessageId',
    ).toBe(true);
    expect(newBranch.sourceSessionId, '新分支获得独立 forked session').toBe('sess-1-fork1');
    expect(calls.prompts.at(-1)!.sessionId, '分支提问用 forked session prompt').toBe(
      'sess-1-fork1',
    );
  });
});

describe('场景 3: 中断 + 继续（status: interrupted → active）', () => {
  it('未收到 done → interrupted；continue 追加并转 active', async () => {
    const { sm, state, controller } = await setup(false); // 不发 done
    controller.createSession('s3', 'mock', null);
    controller.send('s3', '会中断的提问', { requestId: 'ti' }, noopHooks);
    await flush(controller, 's3');
    const tid = controller.getSession('s3')!.treeId!;
    const asst = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'ti')!;
    expect(asst.status, '未收到 done → interrupted').toBe('interrupted');

    // 恢复后继续（源开始发 done）
    state.emitDone = true;
    const lenBefore = asst.content.length;
    controller.continue('s3', 'ti', 'ti-cont', noopHooks);
    await flush(controller, 's3');
    const asstAfter = sm.getNode(tid, asst.id)!;
    expect(asstAfter.content.length, 'continue 追加内容到原节点').toBeGreaterThan(lenBefore);
    expect(asstAfter.status, 'continue 成功 → active').toBe('active');
  });
});

describe('场景 4: 重试（后代 undone + fork 截断 + user 复用）', () => {
  it('retry 标记旧回复 undone、fork 截断到父节点、复用 user 节点', async () => {
    const { baseDir, sm, calls, controller } = await setup();
    controller.createSession('s4', 'mock', null);
    controller.send('s4', '第一轮', { requestId: 'r1' }, noopHooks);
    await flush(controller, 's4');
    const tid = controller.getSession('s4')!.treeId!;
    controller.send('s4', '第二轮', { requestId: 'r2', parentNodeId: 'r1' }, noopHooks);
    await flush(controller, 's4');
    const asst2 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'r2')!;

    calls.forks.length = 0;
    controller.retry('s4', 'r2', 'r2-retry', noopHooks);
    await flush(controller, 's4');

    expect(sm.getNode(tid, asst2.id)!.status, '旧回复 asst2 标记 undone').toBe('undone');
    const newAsst = sm
      .getNodes(tid)
      .find((n) => n.role === 'assistant' && n.parentId === 'r2' && n.status !== 'undone');
    expect(newAsst, '生成新 assistant（active）').toBeTruthy();
    expect(
      calls.forks.some((f) => f.sessionId === 'sess-1' && f.atMessage === 'msg-1'),
      'retry fork 截断点 = 父节点 asst1 的 msg-1',
    ).toBe(true);
    const r2Lines = (await readFile(join(baseDir, tid, 'nodes.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l.trim() && JSON.parse(l).id === 'r2').length;
    expect(r2Lines, 'retry 复用 user 节点 r2（JSONL 仅 1 行）').toBe(1);
    expect(calls.prompts.at(-1)!.sessionId, 'retry 用截断后的 forked session').toBe('sess-1-fork1');
  });
});

describe('场景 5: 撤销（undone + head 回退 + fork 截断）', () => {
  it('undo 标记目标+后代，head 回退父节点', async () => {
    const { sm, calls, controller } = await setup();
    controller.createSession('s5', 'mock', null);
    controller.send('s5', '第一轮', { requestId: 'u1' }, noopHooks);
    await flush(controller, 's5');
    const tid = controller.getSession('s5')!.treeId!;
    const asst1 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'u1')!;
    controller.send('s5', '第二轮', { requestId: 'u2', parentNodeId: 'u1' }, noopHooks);
    await flush(controller, 's5');
    const asst2 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'u2')!;

    calls.forks.length = 0;
    await controller.undo('s5', 'u2', noopHooks);

    expect(sm.getNode(tid, 'u2')!.status, 'undo: u2 标记 undone').toBe('undone');
    expect(sm.getNode(tid, asst2.id)!.status, 'undo: 后代 asst2 标记 undone').toBe('undone');
    expect(sm.getNode(tid, 'u1')!.status, 'undo: 祖先 u1 不受影响').toBeUndefined();
    expect(sm.getTree(tid)!.headNodeId, 'undo: head 回退到父节点 asst1').toBe(asst1.id);
    expect(
      calls.forks.some((f) => f.atMessage === 'msg-1'),
      'undo: fork 截断到父节点 asst1 的 msg-1',
    ).toBe(true);
  });
});

describe('场景 6: 删除（hidden）', () => {
  it('delete 标记 hidden', async () => {
    const { sm, controller } = await setup();
    controller.createSession('s6', 'mock', null);
    controller.send('s6', '第一轮', { requestId: 'd1' }, noopHooks);
    await flush(controller, 's6');
    const tid = controller.getSession('s6')!.treeId!;
    await controller.delete('s6', 'd1', noopHooks);
    expect(sm.getNode(tid, 'd1')!.status).toBe('hidden');
  });
});

describe('场景 7: 显式 tree.fork（源级 fork）', () => {
  it('fork 创建命名分支 + 源级截断', async () => {
    const { sm, calls, controller } = await setup();
    controller.createSession('s7', 'mock', null);
    controller.send('s7', '第一轮', { requestId: 'f1' }, noopHooks);
    await flush(controller, 's7');
    const tid = controller.getSession('s7')!.treeId!;
    const asst1 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'f1')!;

    calls.forks.length = 0;
    const branch = await controller.fork(tid, asst1.id, '我的分支');
    expect(branch?.name, 'fork 创建命名分支').toBe('我的分支');
    expect(
      calls.forks.some((f) => f.sessionId === 'sess-1' && f.atMessage === 'msg-1'),
      'tree.fork 源级截断点 = asst1 的 msg-1',
    ).toBe(true);
    expect(branch!.sourceSessionId, '新分支获得 forked session').toBe('sess-1-fork1');
  });
});

describe('场景 8: 崩溃恢复（streaming 中间态文件）', () => {
  it('检测中断 streaming；destroySession 仅移除 session 绑定（不拆树资源）', async () => {
    const { sm, controller } = await setup();
    const tree = await sm.createTree({});
    await sm.addNode(tree.id, {
      id: 'cu1',
      parentId: null,
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
    });
    // 模拟崩溃：写了 streaming 文件但没有最终 assistant 节点
    await sm.writeStreaming(tree.id, {
      requestId: 'crash-req',
      parentId: 'cu1',
      role: 'assistant',
      startedAt: Date.now(),
      content: [{ type: 'text', text: '部分回复' }],
    });
    const interrupted = await sm.getInterruptedStreams(tree.id);
    expect(interrupted.length, '检测到中断的 streaming').toBe(1);
    expect(interrupted[0].requestId).toBe('crash-req');
    expect(interrupted[0].content[0].type, 'streaming 内容可恢复').toBe('text');

    // 连接级销毁：仅移除 session 绑定，streaming 文件归属树（多端共享，他端可能在途）不清理
    controller.createSession('s8', 'mock', tree.id);
    await controller.destroySession('s8');
    expect(controller.getSession('s8'), 'destroySession 移除 session').toBeUndefined();
    expect(
      (await sm.getInterruptedStreams(tree.id)).length,
      'destroySession 不清理树级 streaming 文件',
    ).toBe(1);

    // 树级删除才回收 streaming 文件
    await sm.deleteTree(tree.id);
    expect((await sm.getInterruptedStreams(tree.id)).length, 'deleteTree 清理 streaming').toBe(0);
  });
});

describe('场景 9: 持久化重载一致性（新 SessionManager 从磁盘恢复）', () => {
  it('undone/sourceMessageId/branch session/head 均持久化', async () => {
    const { baseDir, sm: _sm, controller } = await setup();
    controller.createSession('s9', 'mock', null);
    controller.send('s9', '第一轮', { requestId: 'p1' }, noopHooks);
    await flush(controller, 's9');
    const tid = controller.getSession('s9')!.treeId!;
    controller.send('s9', '第二轮', { requestId: 'p2', parentNodeId: 'p1' }, noopHooks);
    await flush(controller, 's9');
    await controller.undo('s9', 'p2', noopHooks);

    // 全新 SessionManager 从磁盘重载
    const sm2 = new SessionManager({ baseDir });
    const reloaded = await sm2.loadTree(tid);
    expect(reloaded, '重载树成功').toBeTruthy();
    expect(sm2.getNode(tid, 'p2')!.status, '重载后 undone 状态持久化').toBe('undone');
    const asst1 = sm2.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'p1')!;
    expect(asst1.metadata?.sourceMessageId, '重载后 sourceMessageId 持久化').toBe('msg-1');
    expect(
      sm2.getTree(tid)!.branches[0].sourceSessionId,
      '重载后 branch session 持久化（undo fork 截断后）',
    ).toBe('sess-1-fork1');
    expect(sm2.getTree(tid)!.headNodeId, '重载后 headNodeId 持久化').toBe(asst1.id);
  });
});

describe('场景 10: 中止（abort 进行中的流）', () => {
  it('abort → interrupted + 部分内容保留', async () => {
    const { sm, state, controller } = await setup();
    state.hangUntilAbort = true;
    controller.createSession('s10', 'mock', null);
    controller.send('s10', '长任务', { requestId: 'a1' }, noopHooks);
    // 等流进入挂起态
    await new Promise((r) => setTimeout(r, 50));
    controller.abort('s10', 'a1');
    await flush(controller, 's10');
    const tid = controller.getSession('s10')!.treeId!;
    const asst = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'a1');
    expect(asst, 'abort 后 assistant 节点仍持久化').toBeTruthy();
    expect(asst!.status, 'abort → interrupted').toBe('interrupted');
    expect(
      asst!.content.some((c) => c.type === 'text' && c.text.includes('回复')),
      'abort 前已生成的部分内容保留',
    ).toBe(true);
  });
});

describe('场景 11: 删除对话树（deleteTree 统一清理）', () => {
  it('内存 + 磁盘统一清理', async () => {
    const { baseDir, sm, controller } = await setup();
    controller.createSession('s11', 'mock', null);
    controller.send('s11', '第一轮', { requestId: 'x1' }, noopHooks);
    await flush(controller, 's11');
    const tid = controller.getSession('s11')!.treeId!;
    expect(await sm.loadTree(tid), '删除前树存在').toBeTruthy();

    await sm.deleteTree(tid);
    const sm2 = new SessionManager({ baseDir });
    expect(await sm2.loadTree(tid), 'deleteTree 后磁盘树已删除').toBeUndefined();
    expect(sm.getTree(tid), 'deleteTree 后内存缓存已清除').toBeUndefined();
  });
});

describe('场景 12: 路径穿越防护（treeId / requestId 恶意输入）', () => {
  it('拒绝 ../ 与路径分隔符', async () => {
    const { sm } = await setup();
    const tree = await sm.createTree({});

    // treeId 穿越：loadTree 应安全返回 undefined（不报错也不越界）
    expect(await sm.loadTree('../evil'), 'loadTree(../evil) 被拦截').toBeUndefined();
    expect(await sm.loadTree('a/b'), 'loadTree(a/b) 被拦截').toBeUndefined();

    // deleteTree 穿越：应抛错（不会递归删除越界目录）
    await expect(sm.deleteTree('../../tmp/lattice-pwn'), 'deleteTree 穿越抛错').rejects.toThrow();

    // requestId 穿越：writeStreaming / clearStreaming 应抛错
    await expect(
      sm.writeStreaming(tree.id, {
        requestId: '../evil',
        parentId: 'p',
        role: 'assistant',
        startedAt: Date.now(),
        content: [],
      }),
      'writeStreaming(requestId=../evil) 抛错拦截',
    ).rejects.toThrow();
    await expect(
      sm.clearStreaming(tree.id, '../../evil'),
      'clearStreaming(requestId=../../evil) 抛错拦截',
    ).rejects.toThrow();

    // 合法 UUID 正常通过
    await sm.writeStreaming(tree.id, {
      requestId: 'req-ok-123',
      parentId: 'p',
      role: 'assistant',
      startedAt: Date.now(),
      content: [],
    });
    expect((await sm.getInterruptedStreams(tree.id)).length, '合法 requestId 正常写入').toBe(1);
  });
});

describe('场景 13: 首 token 前中止（空内容也持久化 interrupted 节点）', () => {
  it('空内容落盘 interrupted，reload 不丢状态', async () => {
    const { baseDir, sm, state, controller } = await setup();
    state.hangBeforeYield = true;
    controller.createSession('s13', 'mock', null);
    controller.send('s13', '提问', { requestId: 'z1' }, noopHooks);
    await new Promise((r) => setTimeout(r, 50));
    controller.abort('s13', 'z1');
    await flush(controller, 's13');
    const tid = controller.getSession('s13')!.treeId!;
    const asst = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'z1');
    expect(asst, '首 token 前中止仍持久化 assistant 节点').toBeTruthy();
    expect(asst!.status).toBe('interrupted');

    // reload 一致性：重载后仍为 interrupted（不会误判为 done 空节点）
    const sm2 = new SessionManager({ baseDir });
    await sm2.loadTree(tid);
    const reloaded = sm2.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'z1');
    expect(reloaded?.status, 'reload 后 interrupted 状态持久化').toBe('interrupted');
  });
});

describe('场景 14: 撤销不复活已删除（hidden）的后代', () => {
  it('undo 不使 hidden 后代重新浮现', async () => {
    const { sm, controller } = await setup();
    controller.createSession('s14', 'mock', null);
    // 链：w1 → w2 → w3
    controller.send('s14', '第一轮', { requestId: 'w1' }, noopHooks);
    await flush(controller, 's14');
    const tid = controller.getSession('s14')!.treeId!;
    controller.send('s14', '第二轮', { requestId: 'w2', parentNodeId: 'w1' }, noopHooks);
    await flush(controller, 's14');
    controller.send('s14', '第三轮', { requestId: 'w3', parentNodeId: 'w2' }, noopHooks);
    await flush(controller, 's14');

    // 先删除 w3（hidden）
    await controller.delete('s14', 'w3', noopHooks);
    expect(sm.getNode(tid, 'w3')!.status, 'w3 删除 → hidden').toBe('hidden');

    // 撤销 w2：w2 及后代 undone，但已删除的 w3 不应重新浮现
    await controller.undo('s14', 'w2', noopHooks);
    expect(sm.getNode(tid, 'w2')!.status, 'undo: w2 → undone').toBe('undone');
    const w2Asst = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'w2');
    expect(w2Asst?.status, 'undo: w2 的 assistant 后代 → undone').toBe('undone');
    expect(sm.getNode(tid, 'w3')!.status, 'undo 不复活 w3（保持 hidden）').toBe('hidden');
  });
});
