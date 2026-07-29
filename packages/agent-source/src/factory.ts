/**
 * createAgentSource — 工厂函数
 *
 * 一个入口，配置化初始化：注册源 → initAll（init + 握手并行，单源失败不炸整体）→ 返回 registry。
 */
import type { AgentSourceConfig } from '@qcqx/lattice-agent-protocol';
import { SourceRegistry } from './registry.js';

export interface AgentSourceInstance {
  registry: SourceRegistry;
  dispose(): Promise<void>;
}

/**
 * 创建 Agent Source 实例
 *
 * @example
 * ```ts
 * import { createAgentSource, createPiSource, createQoderSource } from '@qcqx/lattice-agent-source';
 *
 * const { registry, dispose } = await createAgentSource({
 *   sources: [createPiSource(), createQoderSource()],
 * });
 *
 * // 可用性与能力看 manifest（数据而非硬编码）
 * const manifests = registry.listManifests();
 *
 * const pi = registry.getSource('pi')!;
 * // 传 null 新建会话，传已有 sessionId 继续；result() 拿 PromptResult
 * const stream = pi.prompt(null, [{ type: 'text', text: 'Hello' }]);
 * for await (const event of stream) { console.log(event.type); }
 * const { sessionId } = await stream.result();
 *
 * await dispose();
 * ```
 */
export async function createAgentSource(config?: AgentSourceConfig): Promise<AgentSourceInstance> {
  const registry = new SourceRegistry();

  for (const source of config?.sources ?? []) {
    registry.register(source);
  }

  await registry.initAll();

  return {
    registry,
    async dispose() {
      await registry.disposeAll();
    },
  };
}
