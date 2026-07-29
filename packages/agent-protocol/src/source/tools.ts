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
 * 工具类型分类（源层声明，壳层按语义渲染——壳层不认识具体工具名）
 * 工具名（Write/write/Task…）是源私有知识，跨层只传语义。
 * 内置工具的声明形态见 capabilities.ts 的 BuiltinToolDecl（声明即数据，
 * 取代旧 getBuiltinTools()/ToolInfo 运行时查询面）。
 */
export type SourceToolSemantic =
  | 'terminal' // 命令执行
  | 'file-read' // 文件读取
  | 'file-write' // 文件写入（创建/编辑/删除）
  | 'search' // 搜索
  | 'code-intel' // LSP 等代码智能
  | 'subagent' // 子代理委派
  | 'other';
