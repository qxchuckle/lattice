/**
 * Tool Registry — 工具注册、发现、调度
 * 可插拔 Provider 模式，支持 MCP 桥接
 */
import type {
  AgentToolDefinition,
  AgentToolResult,
  IToolProvider,
  PermissionLevel,
} from '../types.js';
import type { EventBus } from '../events/event-bus.js';

export interface ToolFilter {
  category?: string;
  permission?: PermissionLevel;
}

export class ToolRegistry {
  private providers = new Map<string, IToolProvider>();
  private tools = new Map<string, { def: AgentToolDefinition; providerId: string }>();
  private events: EventBus;

  constructor(events: EventBus) {
    this.events = events;
  }

  /** 注册一个 Tool Provider */
  async registerProvider(
    provider: IToolProvider,
    config?: Record<string, unknown>,
  ): Promise<boolean> {
    const ok = await provider.init(config);
    if (!ok) return false;

    this.providers.set(provider.id, provider);
    for (const tool of provider.getTools()) {
      this.tools.set(tool.id, { def: tool, providerId: provider.id });
    }

    this.events.emit('tools:provider_registered', {
      providerId: provider.id,
      toolCount: provider.getTools().length,
    });
    return true;
  }

  /** 注销 Provider */
  async unregisterProvider(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    await provider.dispose();
    for (const tool of provider.getTools()) {
      this.tools.delete(tool.id);
    }
    this.providers.delete(providerId);

    this.events.emit('tools:provider_unregistered', { providerId });
  }

  /** 获取所有已注册 tools（可过滤） */
  getTools(filter?: ToolFilter): AgentToolDefinition[] {
    let defs = [...this.tools.values()].map((t) => t.def);
    if (filter?.category) defs = defs.filter((d) => d.category === filter.category);
    if (filter?.permission) defs = defs.filter((d) => d.permission === filter.permission);
    return defs;
  }

  /** 获取单个 tool 定义 */
  getTool(toolId: string): AgentToolDefinition | undefined {
    return this.tools.get(toolId)?.def;
  }

  /** 执行 tool */
  async execute(toolId: string, args: Record<string, unknown>): Promise<AgentToolResult> {
    const entry = this.tools.get(toolId);
    if (!entry) return { success: false, error: `Tool not found: ${toolId}` };

    const provider = this.providers.get(entry.providerId);
    if (!provider) return { success: false, error: `Provider not found: ${entry.providerId}` };

    this.events.emit('tools:execute_start', { toolId, args });
    const startedAt = Date.now();

    try {
      const result = await provider.execute(toolId, args);
      this.events.emit('tools:execute_end', {
        toolId,
        success: result.success,
        duration: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.events.emit('tools:execute_error', { toolId, error });
      return { success: false, error };
    }
  }

  /** 已注册 Provider 列表 */
  getProviders(): { id: string; name: string; category: string }[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
    }));
  }

  /** 已注册 tool 数量 */
  get toolCount(): number {
    return this.tools.size;
  }

  /** 销毁所有 Provider */
  async disposeAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.dispose();
    }
    this.providers.clear();
    this.tools.clear();
  }
}
