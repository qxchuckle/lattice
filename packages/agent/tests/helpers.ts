/**
 * agent 测试共享工具
 *
 * mock source 基于 agent-source 的 driver 形态 + defineSource 工厂（真实事件泵/守卫/握手），
 * 不再手写 ISource——测试跑在与生产一致的链路上。
 *
 * mock source 行为约定：
 * - prompt 固定分两段 emit 文本 `回复[` + `<text>]`（用于验证连续 text 事件合并）
 * - emitDone=true 时工厂发 done，sessionId 缺省为 `sess-<n>`（n 按轮次递增），
 *   sourceMessageId 为 `msg-<n>`
 * - forkSession 返回 `<sessionId>-fork<k>`（k 按 fork 次数递增）
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, ConversationController } from '../src/index.js';
import type { ConversationHooks } from '../src/index.js';
import type { AgentSourceInstance } from '@qcqx/lattice-agent-source';
import { createSourceProfileProvider } from '../src/conversation/source-profiles.js';
import type {
  ISource,
  ContentBlock,
  PromptOpts,
  ResolvedManifest,
} from '@qcqx/lattice-agent-protocol';
import { defineSource } from '@qcqx/lattice-agent-source';
import { createScriptedDriver } from '@qcqx/lattice-agent-source/testing';
import type {
  SourceDriver,
  DriverSessionHandle,
  DriverEmit,
  DriverPromptOutcome,
} from '@qcqx/lattice-agent-source';

export interface MockState {
  emitDone: boolean;
  /** 首段文本后挂起直到中止（模拟长流被 abort） */
  hangUntilAbort: boolean;
  /** 首 token 前就挂起（模拟未出首 token 即中止） */
  hangBeforeYield: boolean;
  /** done 前追发 compaction+notice 事件（模拟源内部自动压缩/resume 降级警告） */
  emitCompaction?: boolean;
}

export interface MockCalls {
  prompts: {
    sessionId: string | null;
    text: string;
    model?: string;
    thinkingLevel?: string;
    contextWindow?: number;
  }[];
  forks: { sessionId: string; atMessage?: string }[];
  aborts: string[];
}

export function makeMockSource(state: MockState, calls: MockCalls): ISource {
  let msgCounter = 0;
  const base = createScriptedDriver({
    id: 'mock',
    capabilities: {
      execution: { mode: 'delegated', contextOwnership: 'source' },
      session: {
        resume: true,
        fork: { atMessage: true },
        rename: true,
        maxConcurrentSessions: 'unlimited',
      },
      prompt: {
        images: false,
        systemPrompt: { builtin: 'none', override: true, append: true },
        slashCommands: false,
        permissionModes: false,
      },
    },
  });

  const driver: SourceDriver = {
    ...base,

    async connect(sessionId: string | null): Promise<DriverSessionHandle> {
      // 无状态语义：真实会话 ID 由 prompt 回填（对齐 Qoder 形态）
      const id = sessionId ?? 'pending';
      return {
        id,
        abort: () => {
          calls.aborts.push(id);
        },
      };
    },

    async prompt(
      session: DriverSessionHandle,
      message: ContentBlock[],
      opts: PromptOpts,
      emit: DriverEmit,
    ): Promise<DriverPromptOutcome> {
      const text = (message[0] as { text?: string })?.text ?? '';
      const incoming = session.id === 'pending' ? null : session.id;
      calls.prompts.push({
        sessionId: incoming,
        text,
        model: opts.model,
        thinkingLevel: opts.thinkingLevel,
        contextWindow: opts.contextWindow,
      });

      const waitAbort = () =>
        new Promise<void>((resolve) => {
          if (opts.signal?.aborted) return resolve();
          opts.signal?.addEventListener('abort', () => resolve(), { once: true });
        });

      if (state.hangBeforeYield) {
        await waitAbort();
        // 中止是正常结局（driver 铁律）：不抛错，返回已知会话
        return { sessionId: incoming ?? undefined };
      }
      emit({ type: 'text', content: '回复[' });
      emit({ type: 'text', content: `${text}]` });
      if (state.hangUntilAbort) {
        await waitAbort();
        return { sessionId: incoming ?? undefined };
      }
      if (state.emitCompaction) {
        emit({ type: 'compaction', trigger: 'auto', preTokens: 37418 });
        emit({ type: 'notice', level: 'warning', message: '会话恢复失败，已新建会话继续' });
      }
      if (!state.emitDone) {
        // 无 done 语义：流未正常结束（模拟源异常断流）
        throw new Error('stream ended without done');
      }
      msgCounter++;
      return {
        sessionId: incoming ?? `sess-${msgCounter}`,
        sourceMessageId: `msg-${msgCounter}`,
        usage: { input: 100, output: 50, total: 150 },
      };
    },

    async forkNative(sessionId: string, atMessage?: string) {
      calls.forks.push({ sessionId, atMessage });
      return `${sessionId}-fork${calls.forks.length}`;
    },

    async renameNative() {},
  };

  return defineSource(driver);
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
  await source.init();
  const sources = {
    registry: {
      getSource: (id: string) => (id === 'mock' ? source : undefined),
      getManifest: (id: string) => (id === 'mock' ? mockManifest(source) : undefined),
      listResources: async () => ({ bySource: {}, warnings: [] }),
    },
  } as unknown as AgentSourceInstance;
  // 能力消费层真走 pipeline（与生产一致）：管线、守卫、归一化均生效
  const profiles = createSourceProfileProvider({
    registry: sources.registry,
    listLocalSkills: () => [],
  });
  const controller = new ConversationController({ session: sm, sources, profiles });
  return { baseDir, sm, state, calls, controller };
}

/** mock 源的握手产物（declared 能力即 verified，无降准） */
export function mockManifest(source: ISource): ResolvedManifest {
  const declared = source.describe();
  return {
    info: declared.info,
    capabilities: declared.capabilities,
    available: true,
    authSnapshot: { status: 'configured' },
    downgrades: [],
    resolvedAt: 0,
  };
}

/** 等待 session 结构队列 + 全部分支流队列排空（锁域 per-tree；首发后 bootstrap→tree 迁移，每轮重取 runtime） */
export const flush = async (controller: ConversationController, sid: string): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    const rt = controller.getRuntime(sid);
    if (!rt) return;
    await rt.queue;
    await Promise.all([...rt.streamQueues.values()]);
  }
};

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
