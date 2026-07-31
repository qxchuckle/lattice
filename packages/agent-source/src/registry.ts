/**
 * SourceRegistry — 源注册表实现
 *
 * 职责：注册/发现/manifest 聚合/生命周期。不代理运行时调用（prompt/fork），
 * 消费层直接操作源实例。可用性是数据（ResolvedManifest.available）而非硬编码。
 */
import type {
  AggregatedSourceResources,
  ISource,
  ISourceRegistry,
  LatticeSourceMap,
  ResolvedManifest,
  SourceResourceQuery,
  SourceResourceScanResult,
  SourceResourcesMap,
} from '@qcqx/lattice-agent-protocol';

export class SourceRegistry implements ISourceRegistry {
  private sources = new Map<string, ISource>();
  private manifests = new Map<string, ResolvedManifest>();
  /** 熔断状态：id → 原因 */
  private runtimeUnavailable = new Map<string, string>();

  /** 标记源不可用（熔断）；铁律：不静默降级——熔断必须可观测 */
  markUnavailable(id: string, reason: string): void {
    if (!this.runtimeUnavailable.has(id)) {
      console.warn(`[SourceRegistry] Source "${id}" marked unavailable: ${reason}`);
    }
    this.runtimeUnavailable.set(id, reason);
  }

  /** 恢复源可用 */
  markAvailable(id: string): void {
    this.runtimeUnavailable.delete(id);
  }

  /** 查询熔断原因 */
  getUnavailableReason(id: string): string | undefined {
    return this.runtimeUnavailable.get(id);
  }

  register(source: ISource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Source "${source.id}" is already registered`);
    }
    this.sources.set(source.id, source);
  }

  unregister(id: string): void {
    this.sources.delete(id);
    this.manifests.delete(id);
  }

  getSource<K extends keyof LatticeSourceMap & string>(id: K): LatticeSourceMap[K] | undefined;
  getSource(id: string): ISource | undefined;
  getSource(id: string): ISource | undefined {
    if (this.runtimeUnavailable.has(id)) return undefined;
    return this.sources.get(id);
  }

  listManifests(): ResolvedManifest[] {
    return [...this.manifests.values()];
  }

  getManifest(id: string): ResolvedManifest | undefined {
    return this.manifests.get(id);
  }

  /**
   * 重新握手（登录态变更/SDK 升级后调用），更新缓存并返回新 manifest。
   * 不重新 import 模块——ESM 失败模块会被缓存（node #58945），只重握手；
   * 握手成功（available）即解除熔断（熔断恢复的唯一正途）。
   */
  async rehandshake(id: string): Promise<ResolvedManifest> {
    const source = this.sources.get(id);
    if (!source) throw new Error(`Source "${id}" not found`);
    const manifest = await source.handshake();
    this.manifests.set(id, manifest);
    if (manifest.available) this.markAvailable(id);
    return manifest;
  }

  /** 聚合资源发现：统一返回 bySource + warnings（契约：不抛错，失败入 warnings 清单） */
  async listResources(
    sourceId?: string,
    query?: SourceResourceQuery,
  ): Promise<AggregatedSourceResources> {
    // 防御：源层契约是不抛错，若第三方 ISource 实现违约抛出，同样降为 warning
    const enumerate = (source: ISource): Promise<SourceResourceScanResult> =>
      source.listResources(query).catch((err) => ({
        resources: [],
        warning: err instanceof Error ? err.message : String(err),
      }));
    const bySource: SourceResourcesMap = {};
    const warnings: AggregatedSourceResources['warnings'] = [];
    // 快照展开在 await 前完成（同步），不受后续异步期间 register/unregister 影响
    const entries = [...this.sources.entries()].filter(
      ([id]) => sourceId === undefined || id === sourceId,
    );
    await Promise.all(
      entries.map(async ([id, source]) => {
        const result = await enumerate(source);
        bySource[id] = result.resources;
        if (result.warning !== undefined) warnings.push({ sourceId: id, message: result.warning });
      }),
    );
    return { bySource, warnings };
  }

  /**
   * init + handshake 全部源：并行，单源失败不炸整体——
   * init 抛错的源落为 available:false + handshake-failed（describe 兜出 manifest 骨架）。
   */
  async initAll(): Promise<void> {
    await Promise.allSettled(
      [...this.sources.values()].map(async (source) => {
        try {
          await source.init();
          this.manifests.set(source.id, await source.handshake());
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // 铁律：不静默降级——失败必须可观测（registry 层无 EventBus，console.warn 保底）；
          // 文案与熔断（markUnavailable 的 "marked unavailable"）区分：这里只落 manifest
          console.warn(
            `[SourceRegistry] Source "${source.id}" init failed: ${message}. Manifest set to available:false (handshake-failed).`,
          );
          // handshake() 内部自兜不抛；能走到这里的是 init 失败
          const declared = source.describe();
          this.manifests.set(source.id, {
            info: declared.info,
            capabilities: declared.capabilities,
            available: false,
            unavailableReason: {
              code: 'handshake-failed',
              message,
            },
            authSnapshot: {
              status: 'error',
              message,
            },
            downgrades: [],
            resolvedAt: Date.now(),
          });
        }
      }),
    );
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.sources.entries()];
    const results = await Promise.allSettled(entries.map(([, s]) => s.dispose()));
    // 单源 dispose 失败不炸整体，但必须可观测（铁律：不静默）
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.warn(`[SourceRegistry] Source "${entries[i][0]}" dispose failed: ${reason}`);
      }
    });
    this.manifests.clear();
  }
}
