/**
 * QoderSource — 基于 @qoder-ai/qoder-agent-sdk
 *
 * 编排层：session 生命周期 + prompt 流程控制。
 * 消息映射 → ./map-message.ts
 * MCP 工具构建 → ./mcp-tools.ts
 */
import type {
  ISource,
  SourceCapabilities,
  SystemPromptPolicy,
  AuthRequirement,
  AuthStatus,
  ModelInfo,
  ToolInfo,
  ToolDefinition,
  InjectToolsConfig,
  PromptOpts,
  SourceEvent,
  ContentBlock,
} from '../../types.js';
import { SourceError } from '../../types.js';
import { mapQoderMessage } from './map-message.js';
import { buildMcpServers } from './mcp-tools.js';
import type { PermissionMode, McpServerConfig } from '@qoder-ai/qoder-agent-sdk';
import { forkSession, getSessionMessages, renameSession } from '@qoder-ai/qoder-agent-sdk';

export interface QoderSourceConfig {
  authMode?: 'env' | 'cli';
  permissionMode?: PermissionMode;
}

export class QoderSource implements ISource {
  readonly id = 'qoder';
  readonly displayName = 'Qoder';
  readonly version = '0.1.0';
  readonly modelPolicy = 'hybrid' as const;

  readonly capabilities: SourceCapabilities = {
    executionMode: 'delegated',
    builtinTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'SearchCodebase', 'LSP'],
    sessionResume: true,
    mcpSupport: true,
    maxConcurrentSessions: 0,
  };

  readonly systemPromptPolicy: SystemPromptPolicy = {
    hasBuiltin: true,
    canOverride: true,
    canAppend: true,
    getBuiltin: async () => '[Qoder built-in system prompt - qodercli preset]',
  };

  /** 只跟踪 abort controller（用于中断正在运行的 prompt） */
  private abortControllers = new Map<string, AbortController>();
  private injectedTools: ToolDefinition[] = [];
  private config: QoderSourceConfig;
  private initialized = false;

  constructor(config?: QoderSourceConfig) {
    this.config = { authMode: 'cli', permissionMode: 'acceptEdits', ...config };
  }

  async init(): Promise<void> {
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    for (const c of this.abortControllers.values()) c.abort();
    this.abortControllers.clear();
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: 'auto',
        displayName: 'Auto (智能路由)',
        capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: true },
        contextWindow: 200000,
        maxOutputTokens: 16384,
        costFactor: 1.0,
      },
      {
        id: 'ultimate',
        displayName: 'Ultimate',
        capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: true },
        contextWindow: 1000000,
        maxOutputTokens: 16384,
        costFactor: 1.6,
      },
      {
        id: 'performance',
        displayName: 'Performance',
        capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: true },
        contextWindow: 200000,
        maxOutputTokens: 16384,
        costFactor: 1.1,
      },
      {
        id: 'efficient',
        displayName: 'Efficient',
        capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
        contextWindow: 128000,
        maxOutputTokens: 8192,
        costFactor: 0.3,
      },
      {
        id: 'lite',
        displayName: 'Lite',
        capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
        contextWindow: 64000,
        maxOutputTokens: 4096,
        costFactor: 0,
      },
    ];
  }

  getAuthRequirements(): AuthRequirement[] {
    return [
      {
        type: 'env',
        vars: ['QODER_PERSONAL_ACCESS_TOKEN'],
        description: 'Qoder Personal Access Token',
      },
      { type: 'cli_login', command: 'qodercli login', description: 'Qoder CLI 登录态' },
    ];
  }

  async checkAuth(): Promise<AuthStatus> {
    if (process.env.QODER_PERSONAL_ACCESS_TOKEN)
      return { status: 'configured', detail: 'PAT in env' };
    try {
      const { execSync } = await import('node:child_process');
      execSync('qodercli --version', { stdio: 'pipe' });
      return { status: 'configured', detail: 'qodercli available' };
    } catch {
      return {
        status: 'missing',
        message: '请设置 QODER_PERSONAL_ACCESS_TOKEN 或运行 qodercli login',
      };
    }
  }

  getBuiltinTools(): ToolInfo[] {
    return this.capabilities.builtinTools.map((name) => ({
      name,
      description: `Qoder built-in: ${name}`,
      category: (name === 'Bash'
        ? 'terminal'
        : name === 'Grep' || name === 'Glob' || name === 'SearchCodebase'
          ? 'search'
          : name === 'LSP'
            ? 'code-intel'
            : 'filesystem') as ToolInfo['category'],
      source: 'builtin' as const,
    }));
  }

  injectTools(_config: InjectToolsConfig | undefined, tools: ToolDefinition[]): void {
    this.injectedTools.push(...tools);
  }

  // ── 核心交互 ──

  async *prompt(
    sessionId: string | null,
    message: ContentBlock[],
    opts?: PromptOpts,
  ): AsyncIterable<SourceEvent> {
    if (!this.initialized) throw SourceError.notInitialized(this.id, this.displayName);

    const controller = new AbortController();
    // 按 sourceSessionId 注册中断器：resume 用已知 sessionId；新会话待捕获后注册
    let abortKey: string | null = sessionId;
    if (abortKey) this.abortControllers.set(abortKey, controller);
    if (opts?.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const text = message.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
    const src = { id: this.id, name: this.displayName };

    try {
      const { query, qodercliAuth, accessTokenFromEnv } = await import('@qoder-ai/qoder-agent-sdk');
      const auth = this.config.authMode === 'env' ? accessTokenFromEnv() : qodercliAuth();
      const mcpServers = await buildMcpServers(this.injectedTools);

      const queryOptions: Record<string, unknown> = {
        auth,
        cwd: opts?.cwd || process.env.HOME || '/',
        model: opts?.model || 'auto',
        permissionMode: this.config.permissionMode,
        allowedTools: [...this.capabilities.builtinTools, ...this.injectedTools.map((t) => t.name)],
        includePartialMessages: true,
        abortController: controller,
        ...(mcpServers ? { mcpServers: mcpServers as Record<string, McpServerConfig> } : {}),
      };

      // 有 sessionId → 直接 resume（SDK 从磁盘 JSONL 恢复）
      if (sessionId) {
        queryOptions.resume = sessionId;
      }

      const q = query({ prompt: text, options: queryOptions });
      let capturedSessionId = sessionId ?? '';

      try {
        for await (const msg of q) {
          const m = msg as Record<string, unknown>;
          if (m.session_id && typeof m.session_id === 'string') {
            capturedSessionId = m.session_id;
            // 新会话：首次拿到 sessionId 时注册中断器供 abort 定位
            if (!abortKey) {
              abortKey = capturedSessionId;
              this.abortControllers.set(abortKey, controller);
            }
          }
          for (const event of mapQoderMessage(m, src)) yield event;
          if (m.type === 'result') break;
        }
      } catch (innerErr) {
        // resume 失败 → 降级为新建
        if (sessionId && String(innerErr).includes('42')) {
          delete queryOptions.resume;
          capturedSessionId = '';
          const retryQ = query({ prompt: text, options: queryOptions });
          for await (const msg of retryQ) {
            const m = msg as Record<string, unknown>;
            if (m.session_id && typeof m.session_id === 'string') {
              capturedSessionId = m.session_id;
            }
            for (const event of mapQoderMessage(m, src)) yield event;
            if (m.type === 'result') break;
          }
        } else {
          throw innerErr;
        }
      }

      // 获取最后一条 assistant 消息的 UUID（fork 时用）
      let sourceMessageId: string | undefined;
      if (capturedSessionId) {
        try {
          const msgs = await getSessionMessages(capturedSessionId);
          const lastAssistant = [...msgs].reverse().find((m) => m.type === 'assistant');
          sourceMessageId = lastAssistant?.uuid;
        } catch {
          /* 非关键路径 */
        }
      }
      yield { type: 'done', sessionId: capturedSessionId, sourceMessageId };
    } catch (err) {
      if (!controller.signal.aborted) {
        yield {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          code: 'unknown',
          retryable: false,
          source: src,
        };
      }
    } finally {
      if (abortKey) this.abortControllers.delete(abortKey);
    }
  }

  // ── 分支 ──

  async forkSession(sessionId: string, atMessage?: string): Promise<string> {
    // sessionId 就是 SDK 的 session ID，直接用于 fork
    const result = await forkSession(sessionId, { upToMessageId: atMessage });
    return result.sessionId;
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await renameSession(sessionId, title);
  }

  // ── 会话管理 ──

  abort(sessionId: string): void {
    // 精确中断指定 session 的在途 prompt（session 保留，SDK 磁盘持久化不受影响）
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }

  destroySession(_sessionId: string): Promise<void> {
    // SDK 自管磁盘持久化，无需清理
    return Promise.resolve();
  }

  isSessionAlive(_sessionId: string): boolean {
    // SDK 的 session 持久化在磁盘，始终“活着”
    return true;
  }
}
