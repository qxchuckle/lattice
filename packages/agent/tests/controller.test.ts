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
import { setup, flush, noopHooks } from './helpers.js';

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
});
