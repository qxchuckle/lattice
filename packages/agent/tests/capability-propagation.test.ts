/**
 * 源能力 → 宿主行为的传导测试（能力缺失即功能缺失，且不静默假装支持）
 *
 * 审查思路：源不支持的能力，上层必须变成"不支持的操作"，而不是
 *   - 照常调用让源报错（表现为莫名错误）
 *   - 或静默降级让宿主以为成功（表现为数据不一致）
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSourceInstance } from '@qcqx/lattice-agent-source';
import { createSourceProfileProvider } from '../src/conversation/source-profiles.js';
import type { SourceCapabilities } from '@qcqx/lattice-agent-protocol';
import { SessionManager } from '../src/session/session-manager.js';
import { ConversationController } from '../src/conversation/conversation-controller.js';
import {
  makeMockSource,
  mockManifest,
  flush,
  noopHooks,
  type MockCalls,
  type MockState,
} from './helpers.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

/** 用指定能力覆盖搭一套编排环境（能力差异是唯一变量） */
async function setupWithCaps(override: (caps: SourceCapabilities) => SourceCapabilities) {
  const baseDir = await mkdtemp(join(tmpdir(), 'lattice-caps-'));
  dirs.push(baseDir);
  const sm = new SessionManager({ baseDir });
  const state: MockState = { emitDone: true, hangUntilAbort: false, hangBeforeYield: false };
  const calls: MockCalls = { prompts: [], forks: [], aborts: [] };
  const source = makeMockSource(state, calls);
  await source.init();

  const baseManifest = mockManifest(source);
  const manifest = { ...baseManifest, capabilities: override(baseManifest.capabilities) };
  const sources = {
    registry: {
      getSource: (id: string) => (id === 'mock' ? source : undefined),
      getManifest: (id: string) => (id === 'mock' ? manifest : undefined),
      listResources: async () => [],
    },
  } as unknown as AgentSourceInstance;
  const profiles = createSourceProfileProvider({
    registry: sources.registry,
    listLocalSkills: () => [],
  });
  const controller = new ConversationController({ session: sm, sources, profiles });
  return { sm, calls, controller };
}

describe('fork 降级告知（不静默）', () => {
  it('源侧 fork 失败 → 分支仍建但带 notice 且 contextCarried=false', async () => {
    const { sm, controller } = await setupWithCaps((c) => c);
    controller.createSession('S', 'mock', null);
    controller.send('S', '第一轮', { requestId: 'u1' }, noopHooks);
    await flush(controller, 'S');
    const treeId = controller.getSession('S')!.treeId!;
    const assistant1 = sm.getNodes(treeId).find((n) => n.role === 'assistant')!;

    // 让源的 forkSession 报错（模拟会话过期/锚点不存在）
    const source = controller['deps'].sources.registry.getSource('mock')!;
    const original = source.forkSession.bind(source);
    source.forkSession = async () => {
      throw new Error('session expired');
    };

    const outcome = await controller.fork(treeId, assistant1.id, '新分支');
    source.forkSession = original;

    expect(outcome?.branch, '分支仍应创建（树是宿主真相）').toBeTruthy();
    expect(outcome?.contextCarried, '源侧 fork 失败 → 上下文未继承').toBe(false);
    expect(outcome?.notice, '必须带降级提示（否则用户不知道 AI 不记得前文）').toBeTruthy();
    expect(outcome!.notice).toContain('上下文');
  });

  it('retry 时 fork 截断失败 → 发 notice（新回复可能被旧回复污染）', async () => {
    const { sm, controller } = await setupWithCaps((c) => c);
    controller.createSession('S', 'mock', null);
    controller.send('S', '第一轮', { requestId: 'u1' }, noopHooks);
    await flush(controller, 'S');
    const treeId = controller.getSession('S')!.treeId!;
    const assistant1 = sm.getNodes(treeId).find((n) => n.role === 'assistant')!;
    // 追问一轮，使得 u2 有父节点（retry 才会走 fork 截断分支）
    controller.send('S', '追问', { requestId: 'u2', parentNodeId: assistant1.id }, noopHooks);
    await flush(controller, 'S');

    const source = controller['deps'].sources.registry.getSource('mock')!;
    const original = source.forkSession.bind(source);
    source.forkSession = async () => {
      throw new Error('fork unavailable');
    };

    const notices: string[] = [];
    controller.retry('S', 'u2', 'r1', {
      ...noopHooks,
      onEvent: (e) => {
        if (e.type === 'notice') notices.push(e.message);
      },
    });
    await flush(controller, 'S');
    source.forkSession = original;

    expect(
      notices.some((m) => m.includes('旧回复')),
      '截断失败必须告知污染风险',
    ).toBe(true);
  });

  it('undo 时源侧截断失败 → 发 notice（AI 可能仍记得已撤销内容）', async () => {
    const { sm, controller } = await setupWithCaps((c) => c);
    controller.createSession('S', 'mock', null);
    controller.send('S', '第一轮', { requestId: 'u1' }, noopHooks);
    await flush(controller, 'S');
    const treeId = controller.getSession('S')!.treeId!;
    const assistant1 = sm.getNodes(treeId).find((n) => n.role === 'assistant')!;
    controller.send('S', '追问', { requestId: 'u2', parentNodeId: assistant1.id }, noopHooks);
    await flush(controller, 'S');

    const source = controller['deps'].sources.registry.getSource('mock')!;
    const original = source.forkSession.bind(source);
    source.forkSession = async () => {
      throw new Error('fork unavailable');
    };

    const notices: string[] = [];
    await controller.undo('S', 'u2', {
      ...noopHooks,
      onEvent: (e) => {
        if (e.type === 'notice') notices.push(e.message);
      },
    });
    source.forkSession = original;

    expect(
      notices.some((m) => m.includes('撤销') && m.includes('AI')),
      '源侧未同步必须告知',
    ).toBe(true);
  });
});

describe('session.resume 传导', () => {
  // 注意：必须用**追问**（指定 parentNodeId）而非两条根消息。
  // lattice 的第一层线程隔离：每条根级 user 消息 = 一段全新源对话（独立分支/独立会话），
  // 所以两条根消息的 sourceSessionId 本就都是 null，测不出 resume 差异。
  it('resume=true：追问复用源会话 ID（上下文连续）', async () => {
    const { sm, calls, controller } = await setupWithCaps((c) => ({
      ...c,
      session: { ...c.session, resume: true },
    }));
    controller.createSession('S', 'mock', null);
    controller.send('S', '第一轮', { requestId: 'u1' }, noopHooks);
    await flush(controller, 'S');
    const treeId = controller.getSession('S')!.treeId!;
    const assistant1 = sm.getNodes(treeId).find((n) => n.role === 'assistant')!;

    controller.send('S', '追问', { requestId: 'u2', parentNodeId: assistant1.id }, noopHooks);
    await flush(controller, 'S');

    expect(calls.prompts).toHaveLength(2);
    expect(calls.prompts[0].sessionId, '首轮无历史会话').toBeNull();
    expect(calls.prompts[1].sessionId, 'resume 支持 → 追问复用源会话').not.toBeNull();
  });

  it('resume=false：追问也不传旧 ID（不把旧会话塞给不支持恢复的源）', async () => {
    const { sm, calls, controller } = await setupWithCaps((c) => ({
      ...c,
      session: { ...c.session, resume: false },
    }));
    controller.createSession('S', 'mock', null);
    controller.send('S', '第一轮', { requestId: 'u1' }, noopHooks);
    await flush(controller, 'S');
    const treeId = controller.getSession('S')!.treeId!;
    const assistant1 = sm.getNodes(treeId).find((n) => n.role === 'assistant')!;

    controller.send('S', '追问', { requestId: 'u2', parentNodeId: assistant1.id }, noopHooks);
    await flush(controller, 'S');

    expect(calls.prompts).toHaveLength(2);
    // 关键：不支持 resume 的源不该收到旧 sessionId
    // （否则源要么报错、要么静默新建而宿主以为续上了）
    expect(calls.prompts[1].sessionId, 'resume=false → 不传旧会话 ID').toBeNull();
  });
});

describe('session.fork 传导（能力→节点能力→操作可用性）', () => {
  it('fork=false：全部节点都不可分支/重试，但追问仍可用', async () => {
    const { controller } = await setupWithCaps((c) => ({
      ...c,
      session: { ...c.session, fork: false },
    }));
    controller.createSession('S', 'mock', null);
    controller.send('S', '问题', { requestId: 'u1' }, noopHooks);
    await flush(controller, 'S');
    const treeId = controller.getSession('S')!.treeId!;

    const caps = controller.turnCapabilities(treeId).u1;
    expect(caps.canBranch, 'fork 不支持 → 不可分支').toBe(false);
    expect(caps.canFollowup, '追问不需要 fork').toBe(true);
    expect(caps.canUndo, '撤销不需要 fork').toBe(true);
  });

  it('fork.atMessage=false：末尾可分支、中间节点不可（线形对话源）', async () => {
    const { sm, controller } = await setupWithCaps((c) => ({
      ...c,
      session: { ...c.session, fork: { atMessage: false } },
    }));
    controller.createSession('S', 'mock', null);
    controller.send('S', '第一轮', { requestId: 'u1' }, noopHooks);
    await flush(controller, 'S');
    const treeId = controller.getSession('S')!.treeId!;
    const assistant1 = sm.getNodes(treeId).find((n) => n.role === 'assistant')!;
    controller.send('S', '第二轮', { requestId: 'u2', parentNodeId: assistant1.id }, noopHooks);
    await flush(controller, 'S');

    const caps = controller.turnCapabilities(treeId);
    expect(caps.u1.canBranch, '中间节点：源做不到从任意锚点分叉').toBe(false);
    expect(caps.u2.canBranch, '末尾节点：从会话末尾分叉做得到').toBe(true);
    // 非 fork 类操作不受影响
    expect(caps.u1.canFollowup).toBe(true);
    expect(caps.u1.canDelete).toBe(true);
  });

  it('中间节点的 retry 被守卫拒绝（接口行为 ≡ 视图）', async () => {
    const { sm, controller } = await setupWithCaps((c) => ({
      ...c,
      session: { ...c.session, fork: { atMessage: false } },
    }));
    controller.createSession('S', 'mock', null);
    controller.send('S', '第一轮', { requestId: 'u1' }, noopHooks);
    await flush(controller, 'S');
    const treeId = controller.getSession('S')!.treeId!;
    const assistant1 = sm.getNodes(treeId).find((n) => n.role === 'assistant')!;
    controller.send('S', '第二轮', { requestId: 'u2', parentNodeId: assistant1.id }, noopHooks);
    await flush(controller, 'S');

    // 绕过 UI 直接对中间节点发 retry → 必须被拒
    const rejects: string[] = [];
    controller.retry('S', 'u1', 'r1', {
      ...noopHooks,
      onReject: (_rid, reason) => rejects.push(reason),
    });
    await flush(controller, 'S');
    expect(rejects, '中间节点 retry 应被守卫拒绝').toHaveLength(1);
    expect(rejects[0]).toMatch(/不可重试/);
  });
});
