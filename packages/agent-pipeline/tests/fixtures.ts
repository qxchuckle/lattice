/**
 * 测试夹具：三种典型能力画像（对齐真实源实测差异）
 *
 * - PI_LIKE：local 执行 / 原生 slash / 原生 skills 注入 / fork 带锚点 / 压缩带摘要
 * - QODER_LIKE：delegated / 宿主展开 slash / MCP 桥注入 / 压缩无摘要 / 权限模式四档
 * - ACP_LIKE：fork 无锚点 / 无压缩面 / 无图片 / systemPrompt 只读不可改（最贫瘠画像）
 */
import type {
  SourceCapabilities,
  ResolvedManifest,
  SourceManifest,
  ISource,
  SourceEvent,
  PromptOpts,
  ContentBlock,
} from '@qcqx/lattice-agent-protocol';
import { SourceEventStream, CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';

export const PI_LIKE: SourceCapabilities = {
  execution: { mode: 'local', contextOwnership: 'source' },
  session: {
    resume: true,
    fork: { atMessage: true },
    rename: false,
    maxConcurrentSessions: 'unlimited',
  },
  prompt: {
    images: true,
    systemPrompt: { builtin: 'none', override: true, append: true },
    slashCommands: { interpret: true },
    permissionModes: false,
  },
  tools: { builtin: [{ name: 'read', semantic: 'file-read' }], injection: 'in-process' },
  context: { compaction: { trigger: 'both', reportsSummary: true, reportsTokens: true } },
  models: { policy: 'open', tuning: true },
  resources: { kinds: ['command', 'skill', 'rule'] },
  skills: { nativeInjection: true },
};

export const QODER_LIKE: SourceCapabilities = {
  execution: { mode: 'delegated', contextOwnership: 'source' },
  session: {
    resume: true,
    fork: { atMessage: true },
    rename: true,
    maxConcurrentSessions: 'unlimited',
  },
  prompt: {
    images: true,
    systemPrompt: { builtin: 'opaque', override: true, append: true },
    slashCommands: false,
    permissionModes: {
      available: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
      default: 'default',
    },
  },
  tools: { builtin: [{ name: 'Write', semantic: 'file-write' }], injection: 'mcp-bridge' },
  context: { compaction: { trigger: 'auto', reportsSummary: false, reportsTokens: true } },
  models: { policy: 'catalog', tuning: true },
  resources: { kinds: ['command'] },
  skills: { nativeInjection: false },
};

export const ACP_LIKE: SourceCapabilities = {
  execution: { mode: 'delegated', contextOwnership: 'source' },
  session: { resume: true, fork: { atMessage: false }, rename: false, maxConcurrentSessions: 8 },
  prompt: {
    images: false,
    systemPrompt: { builtin: 'opaque', override: false, append: false },
    slashCommands: { interpret: false },
    permissionModes: false,
  },
  tools: { builtin: [], injection: false },
  context: { compaction: false },
  models: { policy: 'catalog', tuning: false },
  resources: { kinds: ['command'] },
  skills: { nativeInjection: false },
};

export function declaredManifestOf(id: string, capabilities: SourceCapabilities): SourceManifest {
  return {
    contractVersion: CONTRACT_VERSION,
    info: { id, displayName: id, version: '1.0.0' },
    capabilities,
    authRequirements: [],
  };
}

export function manifestOf(
  id: string,
  capabilities: SourceCapabilities,
  overrides: Partial<ResolvedManifest> = {},
): ResolvedManifest {
  return {
    info: { id, displayName: id, version: '1.0.0' },
    capabilities,
    available: true,
    authSnapshot: { status: 'configured' },
    downgrades: [],
    resolvedAt: 0,
    ...overrides,
  };
}

// ── 假源：记录调用 + 可脚本化事件 ──

export interface FakeSourceCalls {
  prompts: Array<{ sessionId: string | null; message: ContentBlock[]; opts: PromptOpts }>;
  forks: Array<{ sessionId: string; atMessage?: string }>;
}

export interface FakeSourceOptions {
  /** 每轮 prompt 要发的内容事件（done 由假源补） */
  events?: SourceEvent[];
  /** 设为 true 时流以 fail 结束（模拟致命错误） */
  failWith?: unknown;
}

export function createFakeSource(
  id = 'fake',
  options: FakeSourceOptions = {},
): { source: ISource; calls: FakeSourceCalls } {
  const calls: FakeSourceCalls = { prompts: [], forks: [] };
  let forkSeq = 0;
  const source: ISource = {
    id,
    init: async () => {},
    dispose: async () => {},
    describe: () => declaredManifestOf(id, PI_LIKE),
    handshake: async () => manifestOf(id, PI_LIKE),
    listModels: async () => [],
    checkAuth: async () => ({ status: 'configured' }),
    listResources: async () => [],
    prompt: (sessionId, message, opts = {}) => {
      calls.prompts.push({ sessionId, message, opts });
      const stream = new SourceEventStream();
      queueMicrotask(() => {
        for (const e of options.events ?? [{ type: 'text', content: 'ok' }]) stream.push(e);
        if (options.failWith !== undefined) stream.fail(options.failWith);
        else stream.push({ type: 'done', sessionId: sessionId ?? 'new-session' });
      });
      return stream;
    },
    forkSession: async (sessionId, atMessage) => {
      calls.forks.push({ sessionId, atMessage });
      forkSeq += 1;
      return `${sessionId}-fork${forkSeq}`;
    },
    renameSession: async () => {},
    destroySession: async () => {},
  };
  return { source, calls };
}

export async function collect(iter: AsyncIterable<SourceEvent>): Promise<SourceEvent[]> {
  const out: SourceEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}
