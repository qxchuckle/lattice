/**
 * createAgentSource — 工厂函数
 *
 * 一个入口，配置化初始化。注册源、init、返回 registry。
 */
import type { AgentSourceConfig, ISourceRegistry } from './types.js';
import { SourceRegistry } from './registry.js';

export interface AgentSourceInstance {
  registry: ISourceRegistry & SourceRegistry;
  dispose(): Promise<void>;
}

/**
 * 创建 Agent Source 实例
 *
 * @example
 * ```ts
 * import { createAgentSource, PiSource, QoderSource } from '@qcqx/lattice-agent-source';
 *
 * const { registry, dispose } = await createAgentSource({
 *   sources: [new PiSource(), new QoderSource()],
 * });
 *
 * const pi = registry.getSource('pi')!;
 * const sid = await pi.createSession({ model: 'anthropic/claude-sonnet-4', cwd: '/project' });
 * for await (const event of pi.prompt(sid, 'Hello')) { ... }
 *
 * await dispose();
 * ```
 */
export async function createAgentSource(config?: AgentSourceConfig): Promise<AgentSourceInstance> {
  const registry = new SourceRegistry();

  // 注册源
  const sources = config?.sources ?? [];
  for (const source of sources) {
    registry.register(source);
  }

  // 初始化所有源
  await registry.initAll();

  return {
    registry,
    async dispose() {
      await registry.disposeAll();
    },
  };
}
