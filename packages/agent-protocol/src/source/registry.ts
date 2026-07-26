/**
 * 注册表接口 + 工厂配置
 */
import type { ModelInfo } from './models.js';
import type { AuthStatus } from './auth.js';
import type { ToolInfo, ToolDefinition, InjectToolsConfig } from './tools.js';
import type { ISource, SourceInfo } from './interface.js';

/** 按源分组的工具映射 */
export type SourceToolsMap = Record<string, ToolInfo[]>;

/** 按源分组的认证状态 */
export type AuthStatusMap = Record<string, AuthStatus>;

export interface ISourceRegistry {
  register(source: ISource): void;
  unregister(id: string): void;

  listSources(): SourceInfo[];
  getSource(id: string): ISource | undefined;

  listModels(sourceId?: string): ModelInfo[];
  getBuiltinTools(sourceId?: string): SourceToolsMap | ToolInfo[];
  checkAuth(sourceId?: string): AuthStatusMap | AuthStatus;

  injectTools(config: InjectToolsConfig | undefined, tools: ToolDefinition[]): void;

  initAll(): Promise<void>;
  disposeAll(): Promise<void>;
}

export interface AgentSourceConfig {
  /** 要加载的源（不传 = 加载所有内置源） */
  sources?: ISource[];
  /** 默认源 ID */
  defaultSource?: string;
  /** 默认模型 */
  defaultModel?: string;
}
