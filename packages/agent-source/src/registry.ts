/**
 * SourceRegistry — 源注册表实现
 *
 * 职责：源注册/发现/聚合查询/工具注入/认证检测/生命周期。
 * 不代理运行时调用（createSession/prompt），上层直接操作源实例。
 */
import type {
  ISource,
  ISourceRegistry,
  SourceInfo,
  ModelInfo,
  ToolInfo,
  ToolDefinition,
  InjectToolsConfig,
  SourceToolsMap,
  AuthStatus,
  AuthStatusMap,
} from './types.js';

export class SourceRegistry implements ISourceRegistry {
  private sources = new Map<string, ISource>();

  register(source: ISource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Source "${source.id}" is already registered`);
    }
    this.sources.set(source.id, source);
  }

  unregister(id: string): void {
    this.sources.delete(id);
  }

  getSource(id: string): ISource | undefined {
    return this.sources.get(id);
  }

  listSources(): SourceInfo[] {
    return [...this.sources.values()].map((s) => ({
      id: s.id,
      displayName: s.displayName,
      version: s.version,
      modelPolicy: s.modelPolicy,
      capabilities: s.capabilities,
      available: true, // init 后可用；未 init 时由上层判断
      builtinToolCount: s.getBuiltinTools().length,
      modelCount: 0, // 异步，需要时调 listModels
    }));
  }

  listModels(sourceId?: string): ModelInfo[] {
    // 同步缓存版本：源 init 后可缓存模型列表
    // 当前简单实现：返回空，上层应直接调 source.listModels()（异步）
    if (sourceId) {
      const source = this.sources.get(sourceId);
      if (!source) return [];
      // 注意：listModels 是异步的，这里无法同步返回
      // 上层应直接 await source.listModels()
      return [];
    }
    return [];
  }

  getBuiltinTools(sourceId?: string): SourceToolsMap | ToolInfo[] {
    if (sourceId) {
      const source = this.sources.get(sourceId);
      return source ? source.getBuiltinTools() : [];
    }
    const map: SourceToolsMap = {};
    for (const [id, source] of this.sources) {
      map[id] = source.getBuiltinTools();
    }
    return map;
  }

  checkAuth(sourceId?: string): AuthStatusMap | AuthStatus {
    // 注意：checkAuth 是异步的，这里提供同步骨架
    // 上层应直接 await source.checkAuth()
    if (sourceId) {
      return { status: 'missing', message: 'Use async checkAuth on source directly' };
    }
    return {};
  }

  /** 异步版本：检测所有源认证状态 */
  async checkAuthAsync(sourceId?: string): Promise<AuthStatusMap | AuthStatus> {
    if (sourceId) {
      const source = this.sources.get(sourceId);
      if (!source) return { status: 'error', message: `Source "${sourceId}" not found` };
      return source.checkAuth();
    }
    const map: AuthStatusMap = {};
    for (const [id, source] of this.sources) {
      map[id] = await source.checkAuth();
    }
    return map;
  }

  /** 异步版本：获取所有源的模型列表 */
  async listModelsAsync(sourceId?: string): Promise<Array<ModelInfo & { sourceId: string }>> {
    const results: Array<ModelInfo & { sourceId: string }> = [];
    const targets = sourceId
      ? ([this.sources.get(sourceId)].filter(Boolean) as ISource[])
      : [...this.sources.values()];

    for (const source of targets) {
      const models = await source.listModels();
      for (const model of models) {
        results.push({ ...model, sourceId: source.id });
      }
    }
    return results;
  }

  injectTools(config: InjectToolsConfig | undefined, tools: ToolDefinition[]): void {
    const target = config?.target;
    if (target) {
      const source = this.sources.get(target);
      if (!source) throw new Error(`Source "${target}" not found`);
      source.injectTools(config, tools);
    } else {
      for (const source of this.sources.values()) {
        source.injectTools(config, tools);
      }
    }
  }

  async initAll(): Promise<void> {
    for (const source of this.sources.values()) {
      await source.init();
    }
  }

  async disposeAll(): Promise<void> {
    for (const source of this.sources.values()) {
      await source.dispose();
    }
  }
}
