/**
 * 全业务流验证 — ConversationController + SessionManager 端到端业务逻辑
 *
 * 用可记录调用的 mock source 验证真实业务语义（resume / fork 截断点 / 分支隔离 / 状态机）。
 * 覆盖场景：
 *   1. 多轮对话 + 父节点解析（user→assistant 链接）
 *   2. 自动 fork（兄弟分支隔离 + 源 fork 截断点）
 *   3. 中断 + 继续（status 状态机）
 *   4. 重试（后代 undone + fork 截断 + user 节点复用）
 *   5. 撤销（undone + head 回退 + fork 截断）
 *   6. 删除（hidden）
 *   7. 显式 tree.fork（源级 fork）
 *   8. 崩溃恢复（streaming 文件）
 *   9. 持久化重载一致性
 *  10. 中止（abort）+ session 销毁清理
 *
 * 运行：node_modules/.bin/tsx scripts/verify-full-flow.mts
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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

// ── 可记录调用的 mock source ──

interface MockState {
  emitDone: boolean;
  hangUntilAbort: boolean;
  /** 首 token 前就挂起（模拟未出首 token 即中止） */
  hangBeforeYield: boolean;
}
interface MockCalls {
  prompts: { sessionId: string | null; text: string }[];
  forks: { sessionId: string; atMessage?: string }[];
  aborts: string[];
}

function makeMockSource(state: MockState, calls: MockCalls): ISource {
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
      opts: { signal?: AbortSignal },
    ): AsyncIterable<SourceEvent> {
      const text = (message[0] as { text?: string })?.text ?? '';
      calls.prompts.push({ sessionId, text });
      if (state.hangBeforeYield) {
        // 未出首 token 即挂起，直到中止
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) return resolve();
          opts.signal?.addEventListener('abort', () => resolve());
        });
        throw new Error('aborted');
      }
      yield { type: 'text', content: `回复[${text}]` };
      if (state.hangUntilAbort) {
        // 挂起直到中止（模拟长流被 abort）
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) return resolve();
          opts.signal?.addEventListener('abort', () => resolve());
        });
        throw new Error('aborted');
      }
      if (state.emitDone) {
        msgCounter++;
        yield {
          type: 'done',
          sessionId: sessionId ?? `sess-${msgCounter}`,
          sourceMessageId: `msg-${msgCounter}`,
        };
      }
    },
    abort(sessionId: string) {
      calls.aborts.push(sessionId);
    },
    async destroySession() {},
    isSessionAlive() {
      return true;
    },
    async forkSession(sessionId: string, atMessage?: string) {
      calls.forks.push({ sessionId, atMessage });
      return `${sessionId}-fork${calls.forks.length}`;
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

async function setup(emitDone = true) {
  const baseDir = await mkdtemp(join(tmpdir(), 'lattice-full-'));
  const sm = new SessionManager({ baseDir });
  const state: MockState = { emitDone, hangUntilAbort: false, hangBeforeYield: false };
  const calls: MockCalls = { prompts: [], forks: [], aborts: [] };
  const source = makeMockSource(state, calls);
  const sources = {
    registry: { getSource: (id: string) => (id === 'mock' ? source : undefined) },
  } as unknown as AgentSourceInstance;
  const controller = new ConversationController({ session: sm, sources });
  return { baseDir, sm, state, calls, controller };
}

const flush = (controller: ConversationController, sid: string) =>
  controller.getSession(sid)!.queue;

// ── 场景 1: 多轮对话 + 父节点解析 ──

async function scenario1() {
  console.log('\n场景 1: 多轮对话 + 父节点解析（user→assistant 链接，resume 同源）');
  const { sm, calls, controller } = await setup();
  controller.createSession('s1', 'mock', null);

  controller.send('s1', '第一轮', { requestId: 'turn1' }, noopHooks);
  await flush(controller, 's1');
  const tid = controller.getSession('s1')!.treeId!;
  const asst1 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'turn1')!;

  assert(calls.prompts[0].sessionId === null, '首轮 prompt 传 null（新建 session）');
  assert(
    sm.getTree(tid)!.branches[0].sourceSessionId === 'sess-1',
    'done 捕获 branch session = sess-1',
  );
  assert(asst1.metadata?.sourceMessageId === 'msg-1', 'asst1.sourceMessageId = msg-1');

  // 第二轮：parentNodeId=turn1（user 节点）→ 应链接到 asst1
  controller.send('s1', '第二轮', { requestId: 'turn2', parentNodeId: 'turn1' }, noopHooks);
  await flush(controller, 's1');
  const turn2 = sm.getNode(tid, 'turn2')!;
  assert(turn2.parentId === asst1.id, 'turn2 父节点解析为 asst1（链接 user→assistant）');
  assert(calls.prompts[1].sessionId === 'sess-1', '第二轮 resume 同一 session（sess-1）');
  const asst2 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'turn2')!;
  assert(asst2.metadata?.sourceMessageId === 'msg-2', 'asst2.sourceMessageId = msg-2');
  assert(sm.getTree(tid)!.branches[0].sourceSessionId === 'sess-1', 'resume 不改变 branch session');
}

// ── 场景 2: 自动 fork（兄弟分支隔离） ──

async function scenario2() {
  console.log('\n场景 2: 自动 fork（父节点已有 user 子节点 → 兄弟分支 + 源 fork 截断）');
  const { sm, calls, controller } = await setup();
  controller.createSession('s2', 'mock', null);
  controller.send('s2', '第一轮', { requestId: 't1' }, noopHooks);
  await flush(controller, 's2');
  const tid = controller.getSession('s2')!.treeId!;
  const asst1 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 't1')!;
  // 正常第二轮
  controller.send('s2', '第二轮', { requestId: 't2', parentNodeId: 't1' }, noopHooks);
  await flush(controller, 's2');

  const branchesBefore = sm.getTree(tid)!.branches.length;
  // 再次从 t1 发起（t1 已有 user 子节点 t2）→ 触发自动 fork
  controller.send('s2', '分支提问', { requestId: 't3', parentNodeId: 't1' }, noopHooks);
  await flush(controller, 's2');

  const tree = sm.getTree(tid)!;
  assert(tree.branches.length === branchesBefore + 1, '自动 fork 创建新分支');
  const t3 = sm.getNode(tid, 't3')!;
  assert(t3.parentId === asst1.id, '分支提问 t3 挂在 asst1 下');
  const newBranch = tree.branches.find((b) => b.id === t3.branchId)!;
  assert(newBranch.id !== tree.defaultBranchId, 't3 在新分支（非默认分支）');
  assert(
    calls.forks.some((f) => f.sessionId === 'sess-1' && f.atMessage === 'msg-1'),
    'fork 截断点 = asst1 的 sourceMessageId（msg-1）',
  );
  assert(newBranch.sourceSessionId === 'sess-1-fork1', '新分支获得独立 forked session');
  assert(calls.prompts.at(-1)!.sessionId === 'sess-1-fork1', '分支提问用 forked session prompt');
}

// ── 场景 3: 中断 + 继续（status 状态机） ──

async function scenario3() {
  console.log('\n场景 3: 中断 + 继续（status: interrupted → active）');
  const { sm, state, controller } = await setup(false); // 不发 done
  controller.createSession('s3', 'mock', null);
  controller.send('s3', '会中断的提问', { requestId: 'ti' }, noopHooks);
  await flush(controller, 's3');
  const tid = controller.getSession('s3')!.treeId!;
  const asst = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'ti')!;
  assert(asst.status === 'interrupted', '未收到 done → status=interrupted');

  // 恢复后继续（源开始发 done）
  state.emitDone = true;
  const lenBefore = asst.content.length;
  controller.continue('s3', 'ti', 'ti-cont', noopHooks);
  await flush(controller, 's3');
  const asstAfter = sm.getNode(tid, asst.id)!;
  assert((asstAfter.content.length ?? 0) > lenBefore, 'continue 追加内容到原节点');
  assert(asstAfter.status === 'active', 'continue 成功 → status=active');
}

// ── 场景 4: 重试（后代 undone + fork 截断 + user 复用） ──

async function scenario4() {
  console.log('\n场景 4: 重试（后代 undone + fork 截断到父节点 + user 节点复用）');
  const { baseDir, sm, calls, controller } = await setup();
  controller.createSession('s4', 'mock', null);
  controller.send('s4', '第一轮', { requestId: 'r1' }, noopHooks);
  await flush(controller, 's4');
  const tid = controller.getSession('s4')!.treeId!;
  const asst1 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'r1')!;
  controller.send('s4', '第二轮', { requestId: 'r2', parentNodeId: 'r1' }, noopHooks);
  await flush(controller, 's4');
  const asst2 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'r2')!;

  calls.forks.length = 0;
  controller.retry('s4', 'r2', 'r2-retry', noopHooks);
  await flush(controller, 's4');

  assert(sm.getNode(tid, asst2.id)!.status === 'undone', '旧回复 asst2 标记 undone');
  const newAsst = sm
    .getNodes(tid)
    .find((n) => n.role === 'assistant' && n.parentId === 'r2' && n.status !== 'undone');
  assert(!!newAsst, '生成新 assistant（active）');
  assert(
    calls.forks.some((f) => f.sessionId === 'sess-1' && f.atMessage === 'msg-1'),
    'retry fork 截断点 = 父节点 asst1 的 msg-1（排除 r2 及其回复）',
  );
  const r2Lines = (await readFile(join(baseDir, tid, 'nodes.jsonl'), 'utf8'))
    .split('\n')
    .filter((l) => l.trim() && JSON.parse(l).id === 'r2').length;
  assert(r2Lines === 1, 'retry 复用 user 节点 r2（JSONL 仅 1 行）');
  assert(
    calls.prompts.at(-1)!.sessionId === 'sess-1-fork1',
    'retry 用截断后的 forked session 重新 prompt',
  );
}

// ── 场景 5: 撤销（undone + head 回退 + fork 截断） ──

async function scenario5() {
  console.log('\n场景 5: 撤销（目标+后代 undone，head 回退父节点，fork 截断）');
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

  assert(sm.getNode(tid, 'u2')!.status === 'undone', 'undo: u2 标记 undone');
  assert(sm.getNode(tid, asst2.id)!.status === 'undone', 'undo: 后代 asst2 标记 undone');
  assert(sm.getNode(tid, 'u1')!.status === undefined, 'undo: 祖先 u1 不受影响');
  assert(sm.getTree(tid)!.headNodeId === asst1.id, 'undo: head 回退到父节点 asst1');
  assert(
    calls.forks.some((f) => f.atMessage === 'msg-1'),
    'undo: fork 截断到父节点 asst1 的 msg-1',
  );
}

// ── 场景 6: 删除（hidden） ──

async function scenario6() {
  console.log('\n场景 6: 删除（hidden，树中不展示）');
  const { sm, controller } = await setup();
  controller.createSession('s6', 'mock', null);
  controller.send('s6', '第一轮', { requestId: 'd1' }, noopHooks);
  await flush(controller, 's6');
  const tid = controller.getSession('s6')!.treeId!;
  await controller.delete('s6', 'd1', noopHooks);
  assert(sm.getNode(tid, 'd1')!.status === 'hidden', 'delete: d1 标记 hidden');
}

// ── 场景 7: 显式 tree.fork（源级 fork） ──

async function scenario7() {
  console.log('\n场景 7: 显式 tree.fork（新分支 + 源级 fork 截断）');
  const { sm, calls, controller } = await setup();
  controller.createSession('s7', 'mock', null);
  controller.send('s7', '第一轮', { requestId: 'f1' }, noopHooks);
  await flush(controller, 's7');
  const tid = controller.getSession('s7')!.treeId!;
  const asst1 = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'f1')!;

  calls.forks.length = 0;
  const branch = await controller.fork(tid, asst1.id, '我的分支');
  assert(!!branch && branch.name === '我的分支', 'fork 创建命名分支');
  assert(
    calls.forks.some((f) => f.sessionId === 'sess-1' && f.atMessage === 'msg-1'),
    'tree.fork 源级截断点 = asst1 的 msg-1',
  );
  assert(branch!.sourceSessionId === 'sess-1-fork1', '新分支获得 forked session');
}

// ── 场景 8: 崩溃恢复（streaming 文件） ──

async function scenario8() {
  console.log('\n场景 8: 崩溃恢复（streaming 中间态文件）');
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
  assert(
    interrupted.length === 1 && interrupted[0].requestId === 'crash-req',
    '检测到中断的 streaming',
  );
  assert(interrupted[0].content[0].type === 'text', 'streaming 内容可恢复');

  // session 销毁应清理 streaming 文件
  controller.createSession('s8', 'mock', tree.id);
  await controller.destroySession('s8');
  const afterDestroy = await sm.getInterruptedStreams(tree.id);
  assert(afterDestroy.length === 0, 'destroySession 清理 streaming 文件');
  assert(controller.getSession('s8') === undefined, 'destroySession 移除 session');
}

// ── 场景 9: 持久化重载一致性 ──

async function scenario9() {
  console.log('\n场景 9: 持久化重载一致性（新 SessionManager 从磁盘恢复）');
  const { baseDir, sm, controller } = await setup();
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
  assert(!!reloaded, '重载树成功');
  assert(sm2.getNode(tid, 'p2')!.status === 'undone', '重载后 undone 状态持久化');
  const asst1 = sm2.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'p1')!;
  assert(asst1.metadata?.sourceMessageId === 'msg-1', '重载后 sourceMessageId 持久化');
  assert(
    sm2.getTree(tid)!.branches[0].sourceSessionId === 'sess-1-fork1',
    '重载后 branch session 持久化（undo fork 截断后为 sess-1-fork1）',
  );
  assert(sm2.getTree(tid)!.headNodeId === asst1.id, '重载后 headNodeId 持久化');
}

// ── 场景 10: 中止（abort） ──

async function scenario10() {
  console.log('\n场景 10: 中止（abort 进行中的流 → interrupted + 部分内容保留）');
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
  assert(!!asst, 'abort 后 assistant 节点仍持久化（部分内容）');
  assert(asst!.status === 'interrupted', 'abort → status=interrupted');
  assert(
    asst!.content.some((c) => c.type === 'text' && c.text.includes('回复')),
    'abort 前已生成的部分内容保留',
  );
}

// ── 场景 11: 删除对话树（deleteTree 统一清理） ──

async function scenario11() {
  console.log('\n场景 11: 删除对话树（内存 + 磁盘统一清理）');
  const { baseDir, sm, controller } = await setup();
  controller.createSession('s11', 'mock', null);
  controller.send('s11', '第一轮', { requestId: 'x1' }, noopHooks);
  await flush(controller, 's11');
  const tid = controller.getSession('s11')!.treeId!;
  assert(!!(await sm.loadTree(tid)), '删除前树存在');

  await sm.deleteTree(tid);
  // 新 SessionManager 从磁盘验证目录已删
  const sm2 = new SessionManager({ baseDir });
  assert((await sm2.loadTree(tid)) === undefined, 'deleteTree 后磁盘树已删除');
  assert(sm.getTree(tid) === undefined, 'deleteTree 后内存缓存已清除');
}

// ── 场景 12: 路径穿越防护（treeId / requestId 恶意输入） ──

async function scenario12() {
  console.log('\n场景 12: 路径穿越防护（拒绝 ../ 与路径分隔符）');
  const { sm } = await setup();
  const tree = await sm.createTree({});

  // treeId 穿越：loadTree 应安全返回 undefined（不报错也不越界）
  assert(
    (await sm.loadTree('../evil')) === undefined,
    'loadTree(../evil) 被拦截（返回 undefined）',
  );
  assert((await sm.loadTree('a/b')) === undefined, 'loadTree(a/b) 被拦截');

  // deleteTree 穿越：应抛错（不会递归删除越界目录）
  let threw = false;
  try {
    await sm.deleteTree('../../tmp/lattice-pwn');
  } catch {
    threw = true;
  }
  assert(threw, 'deleteTree(../../…) 抛错拦截');

  // requestId 穿越：writeStreaming / clearStreaming 应抛错
  let wsThrew = false;
  try {
    await sm.writeStreaming(tree.id, {
      requestId: '../evil',
      parentId: 'p',
      role: 'assistant',
      startedAt: Date.now(),
      content: [],
    });
  } catch {
    wsThrew = true;
  }
  assert(wsThrew, 'writeStreaming(requestId=../evil) 抛错拦截');

  let csThrew = false;
  try {
    await sm.clearStreaming(tree.id, '../../evil');
  } catch {
    csThrew = true;
  }
  assert(csThrew, 'clearStreaming(requestId=../../evil) 抛错拦截');

  // 合法 UUID 正常通过
  await sm.writeStreaming(tree.id, {
    requestId: 'req-ok-123',
    parentId: 'p',
    role: 'assistant',
    startedAt: Date.now(),
    content: [],
  });
  assert((await sm.getInterruptedStreams(tree.id)).length === 1, '合法 requestId 正常写入');
}

// ── 场景 13: 首 token 前中止（空内容也持久化 interrupted 节点） ──

async function scenario13() {
  console.log('\n场景 13: 首 token 前中止（空内容也落盘 interrupted，reload 不丢状态）');
  const { baseDir, sm, state, controller } = await setup();
  state.hangBeforeYield = true;
  controller.createSession('s13', 'mock', null);
  controller.send('s13', '提问', { requestId: 'z1' }, noopHooks);
  await new Promise((r) => setTimeout(r, 50));
  controller.abort('s13', 'z1');
  await flush(controller, 's13');
  const tid = controller.getSession('s13')!.treeId!;
  const asst = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'z1');
  assert(!!asst, '首 token 前中止：仍持久化 assistant 节点（不再丢失）');
  assert(asst!.status === 'interrupted', 'assistant.status=interrupted');

  // reload 一致性：重载后仍为 interrupted（不会误判为 done 空节点）
  const sm2 = new SessionManager({ baseDir });
  await sm2.loadTree(tid);
  const reloaded = sm2.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'z1');
  assert(reloaded?.status === 'interrupted', 'reload 后 interrupted 状态持久化（继续按钮可恢复）');
}

// ── 场景 14: 撤销不使已删除（hidden）的后代重新浮现 ──

async function scenario14() {
  console.log('\n场景 14: 撤销不复活已删除（hidden）的后代');
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
  assert(sm.getNode(tid, 'w3')!.status === 'hidden', 'w3 删除 → hidden');

  // 撤销 w2：w2 及后代 undone，但已删除的 w3 不应重新浮现
  await controller.undo('s14', 'w2', noopHooks);
  assert(sm.getNode(tid, 'w2')!.status === 'undone', 'undo: w2 → undone');
  const w3Asst = sm.getNodes(tid).find((n) => n.role === 'assistant' && n.parentId === 'w2');
  assert(w3Asst?.status === 'undone', 'undo: w2 的 assistant 后代 → undone');
  assert(
    sm.getNode(tid, 'w3')!.status === 'hidden',
    'undo 不复活 w3（保持 hidden，未被覆盖为 undone）',
  );
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Lattice Agent 全业务流验证');
  console.log('═══════════════════════════════════════════');
  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();
  await scenario5();
  await scenario6();
  await scenario7();
  await scenario8();
  await scenario9();
  await scenario10();
  await scenario11();
  await scenario12();
  await scenario13();
  await scenario14();
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  结果: ${passed} 通过, ${failed} 失败`);
  console.log(`═══════════════════════════════════════════`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('测试异常:', err);
  process.exit(1);
});
