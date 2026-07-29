/**
 * 事件富化：工具语义回填（全源通用，出向 transformEvent）
 *
 * 壳层按语义渲染工具卡片（不认工具名——工具名是源私有知识）。
 * 语义优先来自事件自身（driver 映射时已知），缺失时用 capabilities.tools.builtin 补齐，
 * 都没有则落 'other'。这把「宿主自己建语义表」的活收进 pipeline，消费方零能力读取。
 */
import type { SourceCapabilities, SourceMiddleware } from '@qcqx/lattice-agent-protocol';

export function createToolSemanticMiddleware(capabilities: SourceCapabilities): SourceMiddleware {
  const semantics = new Map(capabilities.tools.builtin.map((t) => [t.name, t.semantic]));
  return {
    name: 'tool-semantic',
    phase: 'normalize',
    transformEvent: (event) => {
      if (event.type !== 'tool_call' || event.semantic) return [event];
      return [{ ...event, semantic: semantics.get(event.name) ?? 'other' }];
    },
  };
}
