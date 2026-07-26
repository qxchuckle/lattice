/**
 * 工具类型
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  category: 'filesystem' | 'terminal' | 'search' | 'code-intel' | 'custom';
  source: 'builtin' | 'injected';
}

export interface InjectToolsConfig {
  /** 目标源 ID，不传 = 所有源 */
  target?: string;
  /** 同名工具是否覆盖内置的 */
  override?: boolean;
}
