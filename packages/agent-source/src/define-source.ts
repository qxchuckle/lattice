/**
 * defineSource — 源工厂（B2 核心）：driver 原子操作 → 完整 ISource
 *
 * 工厂统一提供（driver 永不重复实现）：
 * - 事件泵：SourceEventStream（done 敲定 result / error 事件后 fail reject）
 * - ts 注入：所有事件在源边缘统一打点（第三方宿主也有一致时间）
 * - done 合成：driver 返回 outcome，工厂注入 sessionId（PromptResult.sessionId 恒非空保证）
 * - 握手管线：→ ./handshake.ts（declared + probe → ResolvedManifest）
 * - 能力守卫：fork/rename 缺口抛 unsupported_operation / unsupported_option（纵深防御）
 * - signal 接线：唯一取消真相 → handle.abort()
 * - 契约版本校验：CONTRACT_VERSION 偏斜在 handshake 入口落 failed manifest（available:false，不炸 Registry）
 * - 超时守卫：所有 driver 方法调用均包装 withTimeout，超时落 SourceError('timeout') 不 crash 宿主
 * - 事件形状校验：driver emit 的事件必须含 type 字段，不合法事件丢弃 + warn
 * - 资源缓存：per-cwd TTL（菜单频繁开合免重扫）
 */
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type {
  ISource,
  PromptOpts,
  ContentBlock,
  ModelInfo,
  AuthStatus,
  SourceManifest,
  ResolvedManifest,
  SourceResourceInfo,
  SourceResourceQuery,
  SourceResourceScanResult,
  SourceEvent,
} from '@qcqx/lattice-agent-protocol';
import { SourceEventStream, CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';
import { defer, from, timer, throwError, firstValueFrom, retry } from 'rxjs';
import type { SourceDriver, DriverSessionHandle, DriverEmit, DriverProbeReport } from './driver.js';
import { SourceError } from './types/error.js';
import type { SourceErrorContext } from './types/error.js';
import { buildResolvedManifest, buildFailedManifest } from './handshake.js';

/** 资源发现缓存 TTL */
const RESOURCE_CACHE_TTL_MS = 60_000;

/** 各 driver 方法的默认超时（ms） */
const DEFAULT_TIMEOUTS = {
  init: 30_000,
  handshake: 30_000,
  connect: 15_000,
  prompt: 300_000, // 5 分钟（AI 生成可能较长）
  abortAfterSignal: 10_000, // abort 后等 prompt 返回的超时
  checkAuth: 10_000,
  listModels: 10_000,
  dispose: 10_000,
} as const;

/**
 * 超时守卫：为 driver 方法调用加超时包装。
 * 超时不 crash 宿主，而是抛出 SourceError('timeout')。
 *
 * @param operation  用于 SourceError 的 operation 字段（受类型约束）
 * @param label      用于错误消息的操作名（自由文本，更精确描述）
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: SourceErrorContext['operation'],
  label: string,
  sourceId: string,
  sourceName: string,
): Promise<T> {
  let tid: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      tid = setTimeout(() => {
        reject(
          new SourceError('timeout', `${label} timed out after ${ms}ms`, {
            sourceId,
            sourceName,
            operation,
          }),
        );
      }, ms);
      // 确保 timer 不阻止进程退出
      if (tid.unref) tid.unref();
    }),
  ]).finally(() => {
    // Promise.race 结束后清理定时器，避免泄漏
    if (tid) clearTimeout(tid);
  });
}

/**
 * 事件形状校验：driver 推送的事件必须是含 type 字段的对象。
 * 不合法事件丢弃并 warn，不中断流。
 */
function isValidSourceEvent(event: unknown): event is SourceEvent {
  return (
    typeof event === 'object' && event !== null && typeof (event as SourceEvent).type === 'string'
  );
}

/** 连接重试：仅对**可重试**错误（network/timeout/rate_limited）指数退避重连 */
const MAX_CONNECT_RETRIES = 3;
const CONNECT_BACKOFF_BASE_MS = 200;
const CONNECT_BACKOFF_CAP_MS = 3_000;

/**
 * 工厂唯一错误包装点：driver 异常 → 类型化 SourceError。
 *
 * 规则（禁止看错误内容/文本/code 分类）：
 * - SourceError 透传：高级 driver 可选主动抛精确语义，不二次包装；
 * - 其他异常按「哪个边界失败」赋语义：源设施路径（init/probe/握手/connect）
 *   → source_unavailable（state，retryable=false）；运行时边界 → unknown。
 */
type ErrorBoundary = 'facility' | 'runtime';

function toSourceError(
  err: unknown,
  driver: SourceDriver<DriverSessionHandle>,
  operation: SourceErrorContext['operation'],
  boundary: ErrorBoundary,
): SourceError {
  if (err instanceof SourceError) return err;
  return new SourceError(
    boundary === 'facility' ? 'source_unavailable' : 'unknown',
    err instanceof Error ? err.message : String(err),
    {
      sourceId: driver.info.id,
      sourceName: driver.info.displayName,
      operation,
      cause: err instanceof Error ? err : undefined,
    },
  );
}

class DefinedSource<H extends DriverSessionHandle> implements ISource {
  readonly id: string;
  private initialized = false;
  private handles = new Map<string, H>();
  /** 旧占位 ID → 回填后真实 ID：调用方可能仍持回填前的旧值，销毁/复用时据此换算 */
  private sessionAliases = new Map<string, string>();
  private resourceCache = new Map<string, { at: number; resources: SourceResourceInfo[] }>();
  private manifest: ResolvedManifest | undefined;

  constructor(private readonly driver: SourceDriver<H>) {
    this.id = driver.info.id;
  }

  // ── 生命周期 ──

  async init(config?: Record<string, unknown>): Promise<void> {
    try {
      await withTimeout(
        this.driver.init?.(config) ?? Promise.resolve(),
        DEFAULT_TIMEOUTS.init,
        'init',
        'init',
        this.driver.info.id,
        this.driver.info.displayName,
      );
    } catch (err) {
      // 源设施边界：init 失败 = 源不可用（registry.initAll 据此落 available:false + warn）
      throw toSourceError(err, this.driver, 'init', 'facility');
    }
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    for (const [id, handle] of this.handles) {
      try {
        await withTimeout(
          handle.close?.() ?? Promise.resolve(),
          DEFAULT_TIMEOUTS.dispose,
          'destroySession',
          'handle close',
          this.driver.info.id,
          this.driver.info.displayName,
        );
      } catch (err) {
        console.warn(
          `[Source:${this.driver.info.id}] handle "${id}" close failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    this.handles.clear();
    this.sessionAliases.clear();
    this.resourceCache.clear();
    try {
      await withTimeout(
        this.driver.dispose?.() ?? Promise.resolve(),
        DEFAULT_TIMEOUTS.dispose,
        'destroySession',
        'dispose',
        this.driver.info.id,
        this.driver.info.displayName,
      );
    } catch (err) {
      // dispose 边界：收尾失败不抛（避免阻断其他源退出），但必须可观测
      console.warn(
        `[Source:${this.driver.info.id}] driver dispose failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    this.initialized = false;
  }

  // ── 声明与握手 ──

  describe(): SourceManifest {
    return {
      info: this.driver.info,
      capabilities: this.driver.capabilities,
      authRequirements: this.driver.authRequirements,
      contractVersion: this.driver.contractVersion,
    };
  }

  async handshake(): Promise<ResolvedManifest> {
    const declared = this.describe();
    const resolvedAt = Date.now();

    // 契约版本守门：偏斜 = 握手失败（available:false + 双方版本可见），不抛不炸 Registry；
    // 与 auth/probe 失败同一表达出口（错误处理契约：握手失败用 failed manifest，无需熔断）
    if (this.driver.contractVersion !== CONTRACT_VERSION) {
      const message = `Driver "${this.driver.info.id}" 的契约版本 v${this.driver.contractVersion} 与宿主 protocol v${CONTRACT_VERSION} 不一致，请升级 driver 或对齐 @qcqx/lattice-agent-protocol 版本`;
      console.warn(`[Source:${this.driver.info.id}] handshake refused: ${message}`);
      this.manifest = buildFailedManifest(declared, message, resolvedAt);
      return this.manifest;
    }

    // probe 独立容错：probe 失败不影响 auth 判定的 available；无 probe = declared 即 verified
    let probeReport: DriverProbeReport | undefined;
    let probeError: Error | undefined;
    if (this.driver.probe) {
      try {
        probeReport = await withTimeout(
          this.driver.probe(),
          DEFAULT_TIMEOUTS.handshake,
          'handshake',
          'probe',
          this.driver.info.id,
          this.driver.info.displayName,
        );
      } catch (err) {
        probeError = err instanceof Error ? err : new Error(String(err));
      }
    }

    try {
      const auth = await withTimeout(
        this.driver.checkAuth(),
        DEFAULT_TIMEOUTS.checkAuth,
        'checkAuth',
        'checkAuth',
        this.driver.info.id,
        this.driver.info.displayName,
      );

      // probe 失败 → available: false，与 auth 失败区分；铁律：永不静默降级，必须可观测
      if (probeError) {
        // 文案与熔断（registry "marked unavailable"）区分：这里只落 manifest available:false，不走 markUnavailable
        console.warn(
          `[Source:${this.driver.info.id}] probe failed: ${probeError.message}. Manifest set to available:false (probe-failed).`,
        );
        const failed: ResolvedManifest = {
          info: declared.info,
          capabilities: declared.capabilities,
          available: false,
          unavailableReason: { code: 'probe-failed', message: probeError.message },
          authSnapshot: auth,
          downgrades: [],
          resolvedAt,
        };
        this.manifest = failed;
        return failed;
      }

      // 模型快照仅展示用途（权威通道 listModels），失败不影响握手
      const modelsSnapshot =
        auth.status === 'configured'
          ? await withTimeout(
              this.driver.listModels(),
              DEFAULT_TIMEOUTS.listModels,
              'listModels',
              'listModels',
              this.driver.info.id,
              this.driver.info.displayName,
            ).catch((err) => {
              // 非致命但不静默：快照缺省，握手继续（权威通道是运行期 listModels）
              console.warn(
                `[Source:${this.driver.info.id}] listModels failed during handshake (snapshot omitted):`,
                err?.message ?? err,
              );
              return undefined;
            })
          : undefined;
      this.manifest = buildResolvedManifest({
        declared,
        auth,
        probe: probeReport,
        modelsSnapshot,
        resolvedAt,
      });
    } catch (err) {
      // checkAuth 失败 = 握手失败（源设施边界）：available:false + 原因，不抛出
      this.manifest = buildFailedManifest(
        declared,
        toSourceError(err, this.driver, 'handshake', 'facility').message,
        resolvedAt,
      );
    }
    return this.manifest;
  }

  // ── 动态通道 ──

  listModels(): Promise<ModelInfo[]> {
    return withTimeout(
      this.driver.listModels(),
      DEFAULT_TIMEOUTS.listModels,
      'listModels',
      'listModels',
      this.driver.info.id,
      this.driver.info.displayName,
    );
  }

  checkAuth(): Promise<AuthStatus> {
    return withTimeout(
      this.driver.checkAuth(),
      DEFAULT_TIMEOUTS.checkAuth,
      'checkAuth',
      'checkAuth',
      this.driver.info.id,
      this.driver.info.displayName,
    );
  }

  async listResources(query?: SourceResourceQuery): Promise<SourceResourceScanResult> {
    // 能力握手后以 verified 为准；未握手退 declared
    const caps = this.manifest?.capabilities ?? this.driver.capabilities;
    if (caps.resources === false || !this.driver.scanResources) return { resources: [] };
    const cwd = resolve(query?.cwd ?? homedir());
    const cached = this.resourceCache.get(cwd);
    if (cached && Date.now() - cached.at < RESOURCE_CACHE_TTL_MS) {
      return { resources: filterResourceKinds(cached.resources, query?.kinds) };
    }
    try {
      const resources = await this.driver.scanResources(query);
      this.pruneResourceCache(); // 顺手清过期项，防 per-cwd 缓存只增不删
      this.resourceCache.set(cwd, { at: Date.now(), resources });
      return { resources: filterResourceKinds(resources, query?.kinds) };
    } catch (err) {
      // 契约：发现类 API 失败不抛错——但铁律「源永不静默降级」：
      // 日志可观测 + warning 随返回值结构化上报（聚合层/UI 据此告知用户）
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Source:${this.driver.info.id}] scanResources failed (resources omitted):`,
        message,
      );
      return { resources: [], warning: message };
    }
  }

  // ── 核心交互 ──

  prompt(
    sessionId: string | null,
    message: ContentBlock[],
    opts: PromptOpts = {},
  ): SourceEventStream {
    const stream = new SourceEventStream();
    void this.runPrompt(sessionId, message, opts, stream);
    return stream;
  }

  private async runPrompt(
    sessionId: string | null,
    message: ContentBlock[],
    opts: PromptOpts,
    stream: SourceEventStream,
  ): Promise<void> {
    let onAbort: (() => void) | undefined;
    try {
      if (!this.initialized) {
        throw SourceError.notInitialized(this.driver.info.id, this.driver.info.displayName);
      }
      const existing = sessionId ? this.handles.get(this.resolveSessionId(sessionId)) : undefined;
      // 仅对**新建连接**重试（已有句柄直接复用）；只重试 connect，不重试 prompt（避免向 agent 重发造成副作用）
      const handle = existing ?? (await this.connectWithRetry(sessionId, opts));
      this.handles.set(handle.id, handle);

      // signal = 唯一取消真相：触发即中止在途生成（中止是正常结局，driver 返回 outcome）
      onAbort = () => void handle.abort();
      if (opts.signal?.aborted) onAbort();
      else opts.signal?.addEventListener('abort', onAbort, { once: true });

      const emit: DriverEmit = (event) => {
        if (!isValidSourceEvent(event)) {
          console.warn(
            `[Source:${this.driver.info.id}] invalid event shape, discarded:`,
            typeof event === 'object' ? JSON.stringify(event) : String(event),
          );
          return;
        }
        stream.push(this.stamp(event));
      };
      const outcome = await withTimeout(
        this.driver.prompt(handle, message, opts, emit),
        DEFAULT_TIMEOUTS.prompt,
        'prompt',
        'prompt',
        this.driver.info.id,
        this.driver.info.displayName,
      );

      // 无状态源的真实会话 ID 在流中才产生：以 outcome 回填为准，同时重写 handle.id 与句柄表
      //（只换 Map key 不够——driver 下一轮从 handle.id 读会话身份，不同步会导致 resume 断链）
      const finalId = outcome.sessionId ?? handle.id;
      if (finalId !== handle.id) {
        this.handles.delete(handle.id);
        this.sessionAliases.set(handle.id, finalId); // 记别名：调用方可能仍持旧 ID
        handle.id = finalId;
        this.handles.set(finalId, handle);
      }

      stream.push({
        type: 'done',
        sessionId: finalId, // 工厂保证：done 必携 sessionId（PromptResult.sessionId 恒非空）
        usage: outcome.usage,
        sourceMessageId: outcome.sourceMessageId,
        summary: outcome.summary,
        ts: Date.now(),
      });
    } catch (err) {
      // 运行时边界：prompt 失败 → unknown（connectWithRetry 内已按 facility 包装的除外）
      const se = toSourceError(err, this.driver, 'prompt', 'runtime');
      stream.push(
        this.stamp({
          type: 'error',
          message: se.message,
          code: se.code,
          retryable: se.retryable,
          source: { id: this.driver.info.id, name: this.driver.info.displayName },
          suggestion: se.context.suggestion,
        }),
      );
      stream.fail(se); // 迭代端排空队列后结束；result() reject
    } finally {
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** ts 在源边缘统一打点（宿主无关） */
  private stamp<E extends SourceEvent>(event: E): E {
    return event.ts !== undefined ? event : { ...event, ts: Date.now() };
  }

  /**
   * 连接建立 + 可重试错误指数退避重连。
   *
   * 仅重试**连接建立**阶段，不涉 prompt（prompt 重发会向 agent 重复提交消息，有副作用）。
   * 重试门：仅 SourceError.retryable（network/timeout/rate_limited）；其余（如二进制缺失 ENOENT
   * 被包为 unknown）立即抛出——重试无意义。退避：200ms × 2^n，封顶 3s。
   * 尊重取消信号：退避等待期间 signal 中止则不再重试（避免用户已取消却继续重连）。
   *
   * 最终失败（重试耗尽或不可重试）按源设施边界包装 → source_unavailable
   *（connect 是与源建立通道的设施路径；上层据此熔断，与 prompt 运行时失败区分）。
   */
  private async connectWithRetry(sessionId: string | null, opts: PromptOpts): Promise<H> {
    try {
      return await firstValueFrom(
        defer(() =>
          from(
            withTimeout(
              this.driver.connect(sessionId, opts),
              DEFAULT_TIMEOUTS.connect,
              'prompt',
              'connect',
              this.driver.info.id,
              this.driver.info.displayName,
            ),
          ),
        ).pipe(
          retry({
            count: MAX_CONNECT_RETRIES,
            delay: (err: unknown, attempt: number) => {
              const retryable = err instanceof SourceError && err.retryable;
              if (!retryable || opts.signal?.aborted) return throwError(() => err);
              const backoff = Math.min(
                CONNECT_BACKOFF_BASE_MS * 2 ** (attempt - 1),
                CONNECT_BACKOFF_CAP_MS,
              );
              return timer(backoff);
            },
          }),
        ),
      );
    } catch (err) {
      throw toSourceError(err, this.driver, 'prompt', 'facility');
    }
  }

  // ── 会话原子操作（能力守卫 = 纵深防御，正确用法是查声明而非 catch） ──

  async forkSession(sessionId: string, atMessage?: string): Promise<string> {
    const fork = (this.manifest?.capabilities ?? this.driver.capabilities).session.fork;
    if (fork === false || !this.driver.forkNative) {
      throw SourceError.unsupportedOperation('forkSession', 'session.fork', this.driver.info);
    }
    if (atMessage !== undefined && !fork.atMessage) {
      throw SourceError.unsupportedOption(
        'forkSession',
        'atMessage',
        'session.fork.atMessage',
        this.driver.info,
      );
    }
    try {
      return await this.driver.forkNative(sessionId, atMessage);
    } catch (err) {
      throw toSourceError(err, this.driver, 'forkSession', 'runtime');
    }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const caps = this.manifest?.capabilities ?? this.driver.capabilities;
    if (!caps.session.rename || !this.driver.renameNative) {
      throw SourceError.unsupportedOperation('renameSession', 'session.rename', this.driver.info);
    }
    try {
      await this.driver.renameNative(sessionId, title);
    } catch (err) {
      throw toSourceError(err, this.driver, 'renameSession', 'runtime');
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    // 调用方可能持回填前的旧占位 ID：沿别名链换算到当前真实 ID
    const realId = this.resolveSessionId(sessionId);
    const handle = this.handles.get(realId);
    if (handle) {
      try {
        await withTimeout(
          handle.close?.() ?? Promise.resolve(),
          DEFAULT_TIMEOUTS.dispose,
          'destroySession',
          'handle close',
          this.driver.info.id,
          this.driver.info.displayName,
        );
      } catch (err) {
        console.warn(
          `[Source:${this.driver.info.id}] handle "${realId}" close failed in destroySession:`,
          err instanceof Error ? err.message : err,
        );
      }
      this.handles.delete(realId);
    }
    this.pruneAliases(realId);
    try {
      await withTimeout(
        this.driver.destroyNative?.(realId) ?? Promise.resolve(),
        DEFAULT_TIMEOUTS.dispose,
        'destroySession',
        'destroyNative',
        this.driver.info.id,
        this.driver.info.displayName,
      );
    } catch (err) {
      throw toSourceError(err, this.driver, 'destroySession', 'runtime');
    }
  }

  /** 沿别名链换算到句柄表现用 ID；换算不到则原样返回（防环） */
  private resolveSessionId(sessionId: string): string {
    let id = sessionId;
    const seen = new Set<string>();
    while (!this.handles.has(id)) {
      const next = this.sessionAliases.get(id);
      if (next === undefined || seen.has(next)) return id;
      seen.add(id);
      id = next;
    }
    return id;
  }

  /** 删除（传递地）指向已销毁会话的全部别名，防别名表随会话生灭只增不删 */
  private pruneAliases(destroyedId: string): void {
    const removed = new Set<string>([destroyedId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [oldId, target] of this.sessionAliases) {
        if (removed.has(target) || removed.has(oldId)) {
          this.sessionAliases.delete(oldId);
          removed.add(oldId);
          changed = true;
        }
      }
    }
  }

  /** 淘汰过期的资源缓存条目 */
  private pruneResourceCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.resourceCache) {
      if (now - entry.at >= RESOURCE_CACHE_TTL_MS) this.resourceCache.delete(key);
    }
  }
}

function filterResourceKinds(
  resources: SourceResourceInfo[],
  kinds?: SourceResourceQuery['kinds'],
): SourceResourceInfo[] {
  if (!kinds || kinds.length === 0) return resources;
  const set = new Set(kinds);
  return resources.filter((r) => set.has(r.kind));
}

/**
 * driver → ISource。contractVersion 偏斜不在此抛：握手时落 available:false（见 handshake），
 * 保证第三方 driver 版本偏斜不会炸掉宿主注册流程。
 */
export function defineSource<H extends DriverSessionHandle>(driver: SourceDriver<H>): ISource {
  return new DefinedSource(driver);
}
