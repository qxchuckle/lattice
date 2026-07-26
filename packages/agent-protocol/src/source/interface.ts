/**
 * 源接口 + 能力声明 + SystemPrompt 策略 + Session 配置
 */
import type { SourceEvent } from './events.js';
import type { ContentBlock, StandardMessage } from './messages.js';
import type { ModelInfo } from './models.js';
import type { AuthRequirement, AuthStatus } from './auth.js';
import type { ToolInfo, ToolDefinition, InjectToolsConfig } from './tools.js';

// ── 源能力声明 ──

export interface SourceCapabilities {
  /** local: 源只跑 loop，上层提供工具/上下文/权限（Pi）
   *  delegated: 源自己跑完整 loop（Qoder/CC） */
  executionMode: 'local' | 'delegated';
  /** 源内置的工具名列表 */
  builtinTools: string[];
  /** 是否支持会话恢复（resume） */
  sessionResume: boolean;
  /** 能否注入 MCP 工具 */
  mcpSupport: boolean;
  /** 并发会话上限（0 = 无限制） */
  maxConcurrentSessions: number;
}

// ── SystemPrompt 策略 ──

export interface SystemPromptPolicy {
  hasBuiltin: boolean;
  canOverride: boolean;
  canAppend: boolean;
  getBuiltin?(): Promise<string>;
}

export type SystemPromptConfig =
  | { mode: 'source-default' }
  | { mode: 'override'; prompt: string }
  | { mode: 'append'; additional: string };

// ── Session 配置 ──

export interface SessionCreateOpts {
  model: string;
  cwd: string;
  systemPrompt?: SystemPromptConfig;
  /** 初始历史（结构化消息数组，源内部决定怎么用） */
  history?: StandardMessage[];
  thinkingLevel?: 'none' | 'low' | 'medium' | 'high';
  maxIterations?: number;
}

// ── 源接口（核心契约） ──

export interface ISource {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  /** catalog=只能从列表选 / open=任意字符串 / hybrid=推荐+自定义 */
  readonly modelPolicy: 'catalog' | 'open' | 'hybrid';
  readonly capabilities: SourceCapabilities;
  readonly systemPromptPolicy: SystemPromptPolicy;

  // 生命周期
  init(config?: Record<string, unknown>): Promise<void>;
  dispose(): Promise<void>;

  // 模型发现
  listModels(): Promise<ModelInfo[]>;

  // 认证
  getAuthRequirements(): AuthRequirement[];
  checkAuth(): Promise<AuthStatus>;
  getAuthConfigPath?(): string;

  // 工具
  getBuiltinTools(): ToolInfo[];
  injectTools(config: InjectToolsConfig | undefined, tools: ToolDefinition[]): void;

  // 核心交互
  createSession(opts: SessionCreateOpts): Promise<string>;
  prompt(
    sessionId: string,
    message: string | ContentBlock[],
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<SourceEvent>;
  abort(sessionId: string): void;
  destroySession(sessionId: string): Promise<void>;
  isSessionAlive(sessionId: string): boolean;
}

// ── 源描述信息（聚合查询用） ──

export interface SourceInfo {
  id: string;
  displayName: string;
  version: string;
  modelPolicy: 'catalog' | 'open' | 'hybrid';
  capabilities: SourceCapabilities;
  available: boolean;
  authStatus?: AuthStatus;
  builtinToolCount: number;
  modelCount: number;
}
