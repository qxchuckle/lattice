/**
 * 源接口 + 能力声明 + SystemPrompt 策略
 *
 * 对齐主流 Agent 模型：无显式 createSession，
 * prompt 传 sessionId 则继续，传 null 则新建。
 */
import type { SourceEvent } from './events.js';
import type { ContentBlock } from './messages.js';
import type { ModelInfo } from './models.js';
import type { AuthRequirement, AuthStatus } from './auth.js';
import type { ToolInfo, ToolDefinition, InjectToolsConfig } from './tools.js';
import type { SourceResourceInfo, SourceResourceQuery } from './resources.js';

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
  /** 源内部上下文压缩：auto=源自动压缩并发 compaction 事件；none=源不压缩（溢出即报错） */
  compaction: 'auto' | 'none';
  /** 源是否原生解释 prompt 文本中的 slash 命令：
   *  native=透传 '/cmd args' 由源展开；none=编排层必须自行展开 */
  slashCommands: 'native' | 'none';
  /** 源是否已自行将 skills 可用清单注入 system prompt（true 时编排层不再重复注入，避免双重清单） */
  nativeSkillInjection?: boolean;
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

// ── Prompt 配置 ──

export interface PromptOpts {
  model?: string;
  cwd?: string;
  systemPrompt?: SystemPromptConfig;
  /** 思考深度（取值由模型 tuning 规格约束，freeform 模型可为任意字符串） */
  thinkingLevel?: string;
  /** 上下文窗口 tokens（取值由模型 tuning 规格约束） */
  contextWindow?: number;
  signal?: AbortSignal;
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

  /** 枚举源环境可发现资源（命令/子 agent/skill/rules）。
   *  实现手段（SDK API / 产品约定目录扫描）是源层私有知识；
   *  query.cwd 缺省 = 用户主目录（仅全局/用户级资源）；
   *  失败返回 []，不抛错；未实现 = 源无可发现资源 */
  listResources?(query?: SourceResourceQuery): Promise<SourceResourceInfo[]>;

  // 核心交互：传 sessionId 继续对话，传 null 新建（done 事件返回新 sessionId）
  prompt(
    sessionId: string | null,
    message: ContentBlock[],
    opts?: PromptOpts,
  ): AsyncIterable<SourceEvent>;

  // 会话管理
  abort(sessionId: string): void;
  destroySession(sessionId: string): Promise<void>;
  isSessionAlive(sessionId: string): boolean;

  // 分支：从已有 session 分叉，返回新 sessionId
  forkSession(sessionId: string, atMessage?: string): Promise<string>;

  // 重命名 session：同步标题到源内部存储
  renameSession(sessionId: string, title: string): Promise<void>;
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
