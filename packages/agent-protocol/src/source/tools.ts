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

/**
 * 工具语义分类（源层声明，壳层按语义渲染——壳层不认识具体工具名）
 * 工具名（Write/write/Task…）是源私有知识，跨层只传语义
 */
export type SourceToolSemantic =
  | 'terminal' // 命令执行
  | 'file-read' // 文件读取
  | 'file-write' // 文件写入（创建/编辑/删除）
  | 'search' // 搜索
  | 'code-intel' // LSP 等代码智能
  | 'subagent' // 子代理委派
  | 'other';

export interface ToolInfo {
  name: string;
  description: string;
  category: SourceToolSemantic;
  source: 'builtin' | 'injected';
}

export interface InjectToolsConfig {
  /** 目标源 ID，不传 = 所有源 */
  target?: string;
  /** 同名工具是否覆盖内置的 */
  override?: boolean;
}
