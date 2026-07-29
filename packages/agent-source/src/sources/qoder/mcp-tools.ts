/**
 * 工具注入 → MCP Server 构建
 */
import type { ToolDefinition } from '@qcqx/lattice-agent-protocol';

/**
 * 将 ToolDefinition[] 包装为 Qoder SDK 的 MCP Server 配置
 * 返回 undefined 如果没有工具需要注入
 */
export async function buildMcpServers(
  tools: ToolDefinition[],
): Promise<Record<string, unknown> | undefined> {
  if (tools.length === 0) return undefined;

  const { createSdkMcpServer, tool } = await import('@qoder-ai/qoder-agent-sdk');
  const { z } = await import('zod');

  const mcpTools = tools.map((t) => {
    const shape: Record<string, ReturnType<typeof z.string>> = {};
    const props =
      (t.parameters as { properties?: Record<string, { type?: string; description?: string }> })
        .properties ?? {};
    for (const [key, schema] of Object.entries(props)) {
      shape[key] = z.string().describe(schema.description ?? key);
    }
    return tool(t.name, t.description, shape, async (args: Record<string, unknown>) => {
      const result = await t.execute(args);
      const text = result.success ? JSON.stringify(result.data) : `Error: ${result.error}`;
      return { content: [{ type: 'text' as const, text }] };
    });
  });

  return { 'lattice-tools': createSdkMcpServer({ name: 'lattice-tools', tools: mcpTools }) };
}
