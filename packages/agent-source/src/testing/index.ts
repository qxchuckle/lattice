/**
 * /testing 子出口 — 能力一致性契约套件（公共产物）
 *
 * 第三方 driver 作者跑同一套验证（LSP/ACP conformance 传统）：
 * - checkDriverConformance：静态一致性——声明什么就必须实现什么，未声明的必须缺席或由工厂守卫
 * - createScriptedDriver：脚本化 fake driver——宿主离线测试编排逻辑，不碰真实 SDK
 * - createDriverTestHarness：一键搭建 driver 测试环境（init+handshake+prompt+dispose）
 * - assertDriverBehavior：行为级断言（abort 幂等、prompt 返回 outcome、connect 返回有效 handle）
 * - mockPromptContext：构造标准化测试输入（string→ContentBlock、opts 填充默认 signal）
 *
 * 框架无关：返回 issue 列表 / 纯对象，宿主用任意断言库消费。
 */
import type {
  ContentBlock,
  PromptOpts,
  AuthStatus,
  ModelInfo,
  SourceCapabilities,
  ISource,
  SourceEvent,
} from '@qcqx/lattice-agent-protocol';
import { CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';
import { sourceManifestSchema } from '@qcqx/lattice-agent-protocol/schemas';
import type {
  SourceDriver,
  DriverSessionHandle,
  DriverEvent,
  DriverEmit,
  DriverPromptOutcome,
} from '../driver.js';
import { defineSource } from '../define-source.js';
import assert from 'node:assert/strict';

// ── 静态一致性检查 ──

export interface ConformanceIssue {
  /** 规则 ID（稳定，可用于豁免清单） */
  rule: string;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * 声明 ↔ 实现的一致性规则（driver 级，零 I/O）。
 * 空数组 = 通过。规则表本身就是「声明与实现漂移」问题（canAppend/Qoder list{}）的机器化防线。
 */
export function checkDriverConformance(driver: SourceDriver<never>): ConformanceIssue[] {
  const issues: ConformanceIssue[] = [];
  const caps: SourceCapabilities = driver.capabilities;

  // R1: 契约版本必须与宿主 protocol 一致
  if (driver.contractVersion !== CONTRACT_VERSION) {
    issues.push({
      rule: 'contract-version',
      severity: 'error',
      message: `contractVersion ${driver.contractVersion} ≠ 宿主 protocol v${CONTRACT_VERSION}`,
    });
  }

  // R2: manifest 形状过 zod schema（/schemas 单一真相）
  const manifest = {
    info: driver.info,
    capabilities: caps,
    authRequirements: driver.authRequirements,
    contractVersion: driver.contractVersion,
  };
  const parsed = sourceManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    issues.push({
      rule: 'manifest-schema',
      severity: 'error',
      message: `describe() 产物不符合 SourceManifest schema：${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    });
  }

  // R3: 声明了能力 → 必须提供实现（缺实现 = 声明撒谎）
  if (caps.session.fork !== false && typeof driver.forkNative !== 'function') {
    issues.push({
      rule: 'fork-impl',
      severity: 'error',
      message: '声明 session.fork ≠ false 但未提供 forkNative()',
    });
  }
  if (caps.session.rename && typeof driver.renameNative !== 'function') {
    issues.push({
      rule: 'rename-impl',
      severity: 'error',
      message: '声明 session.rename=true 但未提供 renameNative()',
    });
  }
  if (caps.resources !== false && typeof driver.scanResources !== 'function') {
    issues.push({
      rule: 'resources-impl',
      severity: 'error',
      message: '声明 resources ≠ false 但未提供 scanResources()',
    });
  }

  // R4: 未声明能力 → 不应提供实现（死代码/声明遗漏二选一，都要暴露）
  if (caps.session.fork === false && typeof driver.forkNative === 'function') {
    issues.push({
      rule: 'fork-undeclared',
      severity: 'warning',
      message: '提供了 forkNative() 但声明 session.fork=false（声明遗漏或死代码）',
    });
  }
  if (!caps.session.rename && typeof driver.renameNative === 'function') {
    issues.push({
      rule: 'rename-undeclared',
      severity: 'warning',
      message: '提供了 renameNative() 但声明 session.rename=false',
    });
  }

  // R5: permissionModes 声明自洽（default 必须在 available 内）
  const pm = caps.prompt.permissionModes;
  if (pm !== false && !pm.available.includes(pm.default)) {
    issues.push({
      rule: 'permission-default',
      severity: 'error',
      message: `permissionModes.default "${pm.default}" 不在 available 内`,
    });
  }

  // R6: builtin 工具名唯一
  const names = caps.tools.builtin.map((t) => t.name);
  if (new Set(names).size !== names.length) {
    issues.push({
      rule: 'builtin-unique',
      severity: 'error',
      message: 'tools.builtin 存在重名工具',
    });
  }

  return issues;
}

// ── 脚本化 fake driver（宿主离线测试） ──

export interface ScriptedDriverOptions {
  id?: string;
  capabilities?: Partial<SourceCapabilities>;
  /** 每轮 prompt 依序发射的事件脚本 */
  script?: DriverEvent[];
  /** 每轮 prompt 的结局（缺省：仅回填会话 ID） */
  outcome?: DriverPromptOutcome;
  /** 抛错模拟（优先于 script） */
  failWith?: Error;
  auth?: AuthStatus;
  models?: ModelInfo[];
}

/** 最保守的能力基线（fake driver 缺省：什么都不支持，宿主按需覆盖） */
const MINIMAL_CAPABILITIES: SourceCapabilities = {
  execution: { mode: 'delegated', contextOwnership: 'source' },
  session: { resume: false, fork: false, rename: false, maxConcurrentSessions: 'unlimited' },
  prompt: {
    images: false,
    systemPrompt: { builtin: 'none', override: false, append: false },
    slashCommands: false,
    permissionModes: false,
  },
  tools: { builtin: [], injection: false },
  context: { compaction: false },
  models: { policy: 'open', tuning: false },
  resources: false,
  skills: { nativeInjection: false },
};

/**
 * 脚本化 driver：prompt 回放 script → 返回 outcome。
 * 配合 defineSource 得到行为完整的 fake ISource（事件泵/守卫/握手全真）。
 */
/**
 * 类型安全的默认值合并：返回值由构造保证为 T（断言仅限索引写入一行，
 * 不对整个对象形状撒谎）。undefined 覆盖项被忽略，不会把必填字段抹成 undefined。
 */
function withDefaults<T extends object>(base: T, override: Partial<T> = {}): T {
  const out: T = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export function createScriptedDriver(options: ScriptedDriverOptions = {}): SourceDriver {
  const id = options.id ?? 'scripted';
  const capabilities = withDefaults(MINIMAL_CAPABILITIES, options.capabilities);
  let seq = 0;

  return {
    contractVersion: CONTRACT_VERSION,
    info: { id, displayName: `Scripted(${id})`, version: '0.0.0' },
    capabilities,
    authRequirements: [{ type: 'none' }],

    checkAuth: async () => options.auth ?? { status: 'configured', detail: 'fake' },
    listModels: async () => options.models ?? [],

    async connect(sessionId: string | null, _opts: PromptOpts): Promise<DriverSessionHandle> {
      const sid = sessionId ?? `${id}-sess-${++seq}`;
      return { id: sid, abort: () => {} };
    },

    async prompt(
      _session: DriverSessionHandle,
      _message: ContentBlock[],
      _opts: PromptOpts,
      emit: DriverEmit,
    ): Promise<DriverPromptOutcome> {
      if (options.failWith) throw options.failWith;
      for (const e of options.script ?? []) emit(e);
      return options.outcome ?? {};
    },

    ...(capabilities.session.fork !== false
      ? { forkNative: async (sessionId: string) => `${sessionId}-fork-${++seq}` }
      : {}),
    ...(capabilities.session.rename ? { renameNative: async () => {} } : {}),
    ...(capabilities.resources !== false ? { scanResources: async () => [] } : {}),
  };
}

// ── Driver 测试环境（一键搭建） ──

export interface DriverTestHarness<H extends DriverSessionHandle> {
  /** 初始化源（init + handshake） */
  init(): Promise<void>;
  /** 执行一轮 prompt，收集所有事件 */
  prompt(
    message: string | ContentBlock[],
    opts?: Partial<PromptOpts>,
  ): Promise<{ events: SourceEvent[]; outcome: DriverPromptOutcome }>;
  /** 获取 ISource 实例 */
  getSource(): ISource;
  /** 销毁 */
  dispose(): Promise<void>;
}

/**
 * 一键搭建 driver 测试环境：内部调用 defineSource(driver) 创建 ISource，
 * init() 完成 init+handshake，prompt() 收集所有事件并返回 outcome，
 * dispose() 释放资源。自动跟踪 sessionId（首轮 null 新建，后续轮 resume）。
 */
export function createDriverTestHarness<H extends DriverSessionHandle>(
  driver: SourceDriver<H>,
): DriverTestHarness<H> {
  const source = defineSource(driver);
  let sessionId: string | null = null;

  return {
    async init(): Promise<void> {
      await source.init();
      await source.handshake();
    },

    async prompt(
      message: string | ContentBlock[],
      opts?: Partial<PromptOpts>,
    ): Promise<{ events: SourceEvent[]; outcome: DriverPromptOutcome }> {
      const ctx = mockPromptContext(message, opts);
      const stream = source.prompt(sessionId, ctx.message, ctx.opts);
      const events: SourceEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      const result = await stream.result();
      sessionId = result.sessionId;
      const outcome: DriverPromptOutcome = {
        sessionId: result.sessionId,
        usage: result.usage,
        sourceMessageId: result.sourceMessageId,
        summary: result.summary,
      };
      return { events, outcome };
    },

    getSource(): ISource {
      return source;
    },

    async dispose(): Promise<void> {
      await source.dispose();
    },
  };
}

// ── 行为级断言 ──

export interface BehaviorAssertions {
  /** abort 应幂等：多次调用不报错 */
  abortIsIdempotent(): Promise<void>;
  /** prompt 应返回 outcome */
  promptReturnsOutcome(message?: string): Promise<void>;
  /** connect 应返回有效 handle（有 id 和 abort） */
  connectReturnsHandle(): Promise<void>;
}

/**
 * 行为级断言：内部用 createDriverTestHarness 搭建环境，
 * 每个方法执行行为并用 node:assert/strict 检查，失败时抛出 AssertionError。
 * 每个断言自管理生命周期（init → assert → dispose），互不干扰。
 */
export function assertDriverBehavior<H extends DriverSessionHandle>(
  driver: SourceDriver<H>,
): BehaviorAssertions {
  /** 每个断言自管理生命周期，互不干扰 */
  async function withHarness<T>(fn: (harness: DriverTestHarness<H>) => Promise<T>): Promise<T> {
    const harness = createDriverTestHarness(driver);
    await harness.init();
    try {
      return await fn(harness);
    } finally {
      await harness.dispose();
    }
  }

  return {
    async connectReturnsHandle(): Promise<void> {
      await withHarness(async () => {
        const ctx = mockPromptContext('connect-test');
        const handle = await driver.connect(null, ctx.opts);
        assert.ok(handle, 'connect() 返回了空值');
        assert.ok(handle.id, 'handle.id 必须是非空字符串');
        assert.strictEqual(typeof handle.abort, 'function', 'handle.abort 必须是函数');
        await handle.close?.();
      });
    },

    async abortIsIdempotent(): Promise<void> {
      await withHarness(async () => {
        const ctx = mockPromptContext('abort-test');
        const handle = await driver.connect(null, ctx.opts);
        assert.strictEqual(typeof handle.abort, 'function', 'handle.abort 必须是函数');
        // abort 幂等：多次调用不报错（同步或异步均覆盖）
        for (let i = 0; i < 3; i++) {
          try {
            await Promise.resolve(handle.abort());
          } catch (err) {
            assert.fail(
              `abort() 第 ${i + 1} 次调用抛错: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        await handle.close?.();
      });
    },

    async promptReturnsOutcome(message = 'hello'): Promise<void> {
      await withHarness(async (harness) => {
        const { events, outcome } = await harness.prompt(message);
        assert.ok(events.length > 0, 'prompt() 未返回任何事件');
        assert.ok(outcome.sessionId, 'outcome.sessionId 必须存在且非空');
      });
    },
  };
}

// ── 标准化测试输入构造 ──

/**
 * 构造标准化测试输入：string 自动包装为 ContentBlock[{ type: 'text', text }]，
 * opts 填充默认 signal（非 aborted 的 AbortSignal），返回可直接传给 driver.prompt() 的标准格式。
 */
export function mockPromptContext(
  message: string | ContentBlock[],
  opts: Partial<PromptOpts> = {},
): { message: ContentBlock[]; opts: PromptOpts } {
  const blocks: ContentBlock[] =
    typeof message === 'string' ? [{ type: 'text', text: message }] : [...message];

  // 默认 signal：非 aborted，调用方可通过 opts.signal 覆盖
  const controller = new AbortController();
  const merged: PromptOpts = { signal: controller.signal };
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }

  return { message: blocks, opts: merged };
}
