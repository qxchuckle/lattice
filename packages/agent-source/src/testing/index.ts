/**
 * /testing 子出口 — 能力一致性契约套件（公共产物）
 *
 * 第三方 driver 作者跑同一套验证（LSP/ACP conformance 传统）：
 * - checkDriverConformance：静态一致性——声明什么就必须实现什么，未声明的必须缺席或由工厂守卫
 * - createScriptedDriver：脚本化 fake driver——宿主离线测试编排逻辑，不碰真实 SDK
 *
 * 框架无关：返回 issue 列表 / 纯对象，宿主用任意断言库消费。
 */
import type {
  ContentBlock,
  PromptOpts,
  AuthStatus,
  ModelInfo,
  SourceCapabilities,
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
