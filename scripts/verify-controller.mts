/**
 * 验证 ConversationController 编排核心（下沉后的关键路径）
 *
 * 用 mock source 验证：send / continue / retry / undo / delete / interrupted。
 * 运行：node_modules/.bin/tsx scripts/verify-controller.mts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, ConversationController } from '../packages/agent/src/index.js';
import type { ConversationHooks, SourceEvent } from '../packages/agent/src/index.js';
import type { ISource } from '@qcqx/lattice-agent-protocol';
import type { AgentSourceInstance } from '@qcqx/lattice-agent-source';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  cond ? passed++ : failed++;
}

/** 可控 mock source：emitDone=false 模拟中断（不发 done 事件） */
function makeMockSource(emitDone: boolean): ISource {
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
    // eslint-disable-next-line require-yield
    async *prompt(
      sessionId: string | null,
      _message: unknown,
      _opts: unknown,
    ): AsyncIterable<SourceEvent> {
      yield { type: 'text', content: 'Hello ' };
      yield { type: 'text', content: 'world' };
      if (emitDone) {
        yield {
          type: 'done',
          sessionId: sessionId ?? 'new-session-1',
          sourceMessageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
        };
      }
    },
    abort() {},
    async destroySession() {},
    isSessionAlive() {
      return true;
    },
    async forkSession(sessionId: string) {
      return `${sessionId}-forked`;
    },
    async renameSession() {},
  } as unknown as ISource;
}

function makeHooks(log: string[]): ConversationHooks {
  return {
    onEvent: () => {},
    onError: (m) => log.push(`error:${m}`),
    onTreeUpdated: (_t, head) => log.push(`treeUpdated:${head}`),
    onTreeCreated: (t) => log.push(`treeCreated:${t}`),
  };
}

async function main() {
  const baseDir = await mkdtemp(join(tmpdir(), 'lattice-controller-'));
  console.log(`临时目录: ${baseDir}\n`);

  try {
    const sm = new SessionManager({ baseDir });
    const mockSource = makeMockSource(true);
    const sources = {
      registry: { getSource: (id: string) => (id === 'mock' ? mockSource : undefined) },
    } as unknown as AgentSourceInstance;
    const controller = new ConversationController({ session: sm, sources });

    // ── 测试 1: send 创建 user+assistant，合并文本，捕获 sessionId/sourceMessageId ──
    console.log('测试 1: send');
    const log: string[] = [];
    controller.createSession('sess1', 'mock', null);
    controller.send('sess1', '你好', { requestId: 'turn1' }, makeHooks(log));
    await controller.getSession('sess1')!.queue;

    const ctx = controller.getSession('sess1')!;
    const treeId = ctx.treeId!;
    assert(
      !!treeId && log.some((l) => l.startsWith('treeCreated')),
      '懒创建树并触发 onTreeCreated',
    );
    const userNode = sm.getNode(treeId, 'turn1');
    assert(userNode?.role === 'user', 'user 节点 turn1 已创建');
    const assistant = sm
      .getNodes(treeId)
      .find((n) => n.role === 'assistant' && n.parentId === 'turn1');
    assert(!!assistant, 'assistant 子节点已创建');
    assert(
      assistant?.content.length === 1 &&
        (assistant.content[0] as { text: string }).text === 'Hello world',
      '连续 text 事件合并为单块 "Hello world"',
    );
    const branch = sm.getTree(treeId)!.branches[0];
    assert(branch.sourceSessionId === 'new-session-1', 'branch.sourceSessionId 从 done 捕获');
    assert(!!assistant?.metadata?.sourceMessageId, 'assistant.metadata.sourceMessageId 已持久化');

    // ── 测试 2: interrupted（source 不发 done）→ status='interrupted' ──
    console.log('\n测试 2: interrupted 状态');
    const sm2dir = await mkdtemp(join(tmpdir(), 'lattice-controller-int-'));
    const sm2 = new SessionManager({ baseDir: sm2dir });
    const intSource = makeMockSource(false); // 不发 done
    const sources2 = {
      registry: { getSource: (id: string) => (id === 'mock' ? intSource : undefined) },
    } as unknown as AgentSourceInstance;
    const controller2 = new ConversationController({ session: sm2, sources: sources2 });
    controller2.createSession('sess2', 'mock', null);
    controller2.send('sess2', '测试中断', { requestId: 'turn-int' }, makeHooks([]));
    await controller2.getSession('sess2')!.queue;
    const treeId2 = controller2.getSession('sess2')!.treeId!;
    const intAssistant = sm2
      .getNodes(treeId2)
      .find((n) => n.role === 'assistant' && n.parentId === 'turn-int');
    assert(intAssistant?.status === 'interrupted', '未收到 done → assistant.status=interrupted');
    await rm(sm2dir, { recursive: true, force: true });

    // ── 测试 3: retry 标记旧 assistant undone + 新建 active assistant ──
    console.log('\n测试 3: retry');
    controller.retry('sess1', 'turn1', 'turn1-retry', makeHooks([]));
    await controller.getSession('sess1')!.queue;
    const assistantsAfterRetry = sm
      .getNodes(treeId)
      .filter((n) => n.role === 'assistant' && n.parentId === 'turn1');
    assert(assistantsAfterRetry.length === 2, 'retry 后 turn1 有 2 个 assistant 子节点');
    assert(
      assistantsAfterRetry.some((n) => n.status === 'undone'),
      '旧 assistant 标记 undone',
    );
    assert(
      assistantsAfterRetry.some((n) => n.status !== 'undone' && n.status !== 'hidden'),
      '新 assistant 为 active',
    );
    const user1Lines = (await import('node:fs/promises'))
      .readFile(join(baseDir, treeId, 'nodes.jsonl'), 'utf8')
      .then((r) => r.split('\n').filter((l) => l.trim() && JSON.parse(l).id === 'turn1').length);
    assert((await user1Lines) === 1, 'retry 复用 user 节点（JSONL 中 turn1 仅 1 行）');

    // ── 测试 4: undo 标记目标 + 后代为 undone ──
    console.log('\n测试 4: undo');
    // 先加第二轮：turn2（挂在 turn1 的 active assistant 下）
    const activeAssistant = assistantsAfterRetry.find((n) => n.status !== 'undone')!;
    controller.send(
      'sess1',
      '第二轮',
      { requestId: 'turn2', parentNodeId: 'turn1' },
      makeHooks([]),
    );
    await controller.getSession('sess1')!.queue;
    const turn2 = sm.getNodes(treeId).find((n) => n.id === 'turn2');
    assert(!!turn2, '第二轮 user 节点 turn2 已创建');
    // undo turn2
    await controller.undo('sess1', 'turn2', makeHooks([]));
    assert(sm.getNode(treeId, 'turn2')?.status === 'undone', 'undo: turn2 标记 undone');
    const turn2Assistant = sm
      .getNodes(treeId)
      .find((n) => n.role === 'assistant' && n.parentId === 'turn2');
    assert(turn2Assistant?.status === 'undone', 'undo: turn2 的 assistant 后代标记 undone');

    // ── 测试 5: delete 标记为 hidden ──
    console.log('\n测试 5: delete');
    await controller.delete('sess1', 'turn2', makeHooks([]));
    assert(sm.getNode(treeId, 'turn2')?.status === 'hidden', 'delete: turn2 标记 hidden');

    // ── 测试 6: continue 在原节点追加内容 ──
    console.log('\n测试 6: continue');
    const beforeLen = activeAssistant.content.length;
    controller.continue('sess1', 'turn1', 'turn1-cont', makeHooks([]));
    await controller.getSession('sess1')!.queue;
    const afterAssistant = sm.getNode(treeId, activeAssistant.id);
    assert(
      (afterAssistant?.content.length ?? 0) > beforeLen,
      `continue 在原节点追加内容（${beforeLen} → ${afterAssistant?.content.length}）`,
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
