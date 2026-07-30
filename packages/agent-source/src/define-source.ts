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
 * - 契约版本校验：CONTRACT_VERSION 偏斜在 defineSource 调用时即抛错
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
  SourceEvent,
} from '@qcqx/lattice-agent-protocol';
import { SourceEventStream, CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';
import { defer, from, timer, throwError, firstValueFrom, retry } from 'rxjs';
import type { SourceDriver, DriverSessionHandle, DriverEmit } from './driver.js';
import { SourceError } from './types/error.js';
import { buildResolvedManifest, buildFailedManifest } from './handshake.js';

/** 资源发现缓存 TTL */
const RESOURCE_CACHE_TTL_MS = 60_000;

/** 连接重试：仅对**可重试**错误（network/timeout/rate_limited）指数退避重连 */
const MAX_CONNECT_RETRIES = 3;
const CONNECT_BACKOFF_BASE_MS = 200;
const CONNECT_BACKOFF_CAP_MS = 3_000;

/** 非 SourceError 的 driver 异常 → 类型化包装 */
function toSourceError(
  err: unknown,
  driver: SourceDriver<DriverSessionHandle>,
  operation: 'prompt' | 'forkSession' | 'renameSession' | 'destroySession' | 'handshake',
): SourceError {
  if (err instanceof SourceError) return err;
  return new SourceError('unknown', err instanceof Error ? err.message : String(err), {
    sourceId: driver.info.id,
    sourceName: driver.info.displayName,
    operation,
    cause: err instanceof Error ? err : undefined,
  });
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
    await this.driver.init?.(config);
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    for (const handle of this.handles.values()) await handle.close?.();
    this.handles.clear();
    this.sessionAliases.clear();
    this.resourceCache.clear();
    await this.driver.dispose?.();
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
    try {
      const auth = await this.driver.checkAuth();
      const probe = await this.driver.probe?.();
      // 模型快照仅展示用途（权威通道 listModels），失败不影响握手
      const modelsSnapshot =
        auth.status === 'configured'
          ? await this.driver.listModels().catch((err) => {
              console.debug(`[Source:${this.driver.info.id}] listModels failed during handshake:`, err?.message ?? err);
              return undefined;
            })
          : undefined;
      this.manifest = buildResolvedManifest({
        declared,
        auth,
        probe,
        modelsSnapshot,
        resolvedAt,
      });
    } catch (err) {
      this.manifest = buildFailedManifest(
        declared,
        toSourceError(err, this.driver, 'handshake').message,
        resolvedAt,
      );
    }
    return this.manifest;
  }

  // ── 动态通道 ──

  listModels(): Promise<ModelInfo[]> {
    return this.driver.listModels();
  }

  checkAuth(): Promise<AuthStatus> {
    return this.driver.checkAuth();
  }

  async listResources(query?: SourceResourceQuery): Promise<SourceResourceInfo[]> {
    // 能力握手后以 verified 为准；未握手退 declared
    const caps = this.manifest?.capabilities ?? this.driver.capabilities;
    if (caps.resources === false || !this.driver.scanResources) return [];
    const cwd = resolve(query?.cwd ?? homedir());
    const cached = this.resourceCache.get(cwd);
    if (cached && Date.now() - cached.at < RESOURCE_CACHE_TTL_MS) {
      return filterResourceKinds(cached.resources, query?.kinds);
    }
    try {
      const resources = await this.driver.scanResources(query);
      this.pruneResourceCache(); // 顺手清过期项，防 per-cwd 缓存只增不删
      this.resourceCache.set(cwd, { at: Date.now(), resources });
      return filterResourceKinds(resources, query?.kinds);
    } catch {
      return []; // 契约：发现类 API 失败不抛错
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

      const emit: DriverEmit = (event) => stream.push(this.stamp(event));
      const outcome = await this.driver.prompt(handle, message, opts, emit);

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
      const se = toSourceError(err, this.driver, 'prompt');
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
   */
  private connectWithRetry(sessionId: string | null, opts: PromptOpts): Promise<H> {
    return firstValueFrom(
      defer(() => from(this.driver.connect(sessionId, opts))).pipe(
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
      throw toSourceError(err, this.driver, 'forkSession');
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
      throw toSourceError(err, this.driver, 'renameSession');
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    // 调用方可能持回填前的旧占位 ID：沿别名链换算到当前真实 ID
    const realId = this.resolveSessionId(sessionId);
    const handle = this.handles.get(realId);
    if (handle) {
      await handle.close?.();
      this.handles.delete(realId);
    }
    this.pruneAliases(realId);
    try {
      await this.driver.destroyNative?.(realId);
    } catch (err) {
      throw toSourceError(err, this.driver, 'destroySession');
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
 * driver → ISource。contractVersion 偏斜在此即抛（fail-fast，不等运行期）。
 */
export function defineSource<H extends DriverSessionHandle>(driver: SourceDriver<H>): ISource {
  if (driver.contractVersion !== CONTRACT_VERSION) {
    throw new SourceError(
      'unsupported_operation',
      `Driver "${driver.info.id}" 的契约版本 ${driver.contractVersion} 与宿主 protocol v${CONTRACT_VERSION} 不一致`,
      {
        sourceId: driver.info.id,
        sourceName: driver.info.displayName,
        operation: 'init',
        suggestion: '升级 driver 或对齐 @qcqx/lattice-agent-protocol 版本',
      },
    );
  }
  return new DefinedSource(driver);
}
