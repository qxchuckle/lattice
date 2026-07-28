/**
 * agent 测试共享工具
 *
 * 由 scripts/verify-*.mts 迁移而来：统一 mock source（可控 done/挂起/调用记录）、
 * noop hooks、mkdtemp 隔离的 setup、链式建树等公共能力。
 *
 * mock source 行为约定：
 * - prompt 固定分两段 yield 文本 `回复[` + `<text>]`（用于验证连续 text 事件合并）
 * - emitDone=true 时发 done，sessionId 缺省为 `sess-<n>`（n 按 done 次数递增），
 *   sourceMessageId 为 `msg-<n>`
 * - forkSession 返回 `<sessionId>-fork<k>`（k 按 fork 次数递增）
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, ConversationController } from '../src/index.js';
import type { ConversationHooks, SourceEvent, AgentSourceInstance } from '../src/index.js';
import type { ISource, ContentBlock } from '@qcqx/lattice-agent-protocol';

export interface MockState {
  emitDone: boolean;
  /** 首段文本后挂起直到中止（模拟长流被 abort） */
  hangUntilAbort: boolean;
  /** 首 token 前就挂起（模拟未出首 token 即中止） */
  hangBeforeYield: boolean;
}

export interface MockCalls {
  prompts: { sessionId: string | null; text: string }[];
  forks: { sessionId: string; atMessage?: string }[];
  aborts: string[];
}

export function makeMockSource(state: MockState, calls: MockCalls): ISource {
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
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) return resolve();
          opts.signal?.addEventListener('abort', () => resolve());
        });
        throw new Error('aborted');
      }
      yield { type: 'text', content: '回复[' };
      yield { type: 'text', content: `${text}]` };
      if (state.hangUntilAbort) {
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

export const noopHooks: ConversationHooks = {
  onEvent: () => {},
  onError: () => {},
  onTreeUpdated: () => {},
  onTreeCreated: () => {},
};

export interface TestContext {
  baseDir: string;
  sm: SessionManager;
  state: MockState;
  calls: MockCalls;
  controller: ConversationController;
}

/** mkdtemp 隔离环境 + mock source + controller（目录清理交由 OS 临时目录策略） */
export async function setup(emitDone = true): Promise<TestContext> {
  const baseDir = await mkdtemp(join(tmpdir(), 'lattice-agent-test-'));
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

/** 等待 session 写队列排空 */
export const flush = (controller: ConversationController, sid: string) =>
  controller.getSession(sid)!.queue;

/** 取某 user 节点下的 assistant 子节点 */
export const asstOf = (sm: SessionManager, treeId: string, parentId: string) =>
  sm.getNodes(treeId).find((n) => n.role === 'assistant' && n.parentId === parentId);

/** 构建线性链：u1 → u2 → … → u<depth>（每轮挂上一轮 user 节点下），返回 treeId */
export async function buildChain(
  controller: ConversationController,
  sid: string,
  depth: number,
): Promise<string> {
  controller.send(sid, '第一轮', { requestId: 'u1' }, noopHooks);
  await flush(controller, sid);
  for (let i = 2; i <= depth; i++) {
    controller.send(sid, `第${i}轮`, { requestId: `u${i}`, parentNodeId: `u${i - 1}` }, noopHooks);
    await flush(controller, sid);
  }
  return controller.getSession(sid)!.treeId!;
}
