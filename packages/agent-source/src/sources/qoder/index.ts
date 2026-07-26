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
  SessionCreateOpts,
  SourceEvent,
  ContentBlock,
} from '../../types.js';
import { SourceError } from '../../types.js';
import { mapQoderMessage } from './map-message.js';
import { buildMcpServers } from './mcp-tools.js';
import type { PermissionMode, McpServerConfig } from '@qoder-ai/qoder-agent-sdk';

interface QoderSession {
  id: string;
  cwd: string;
  model: string;
  abortController: AbortController;
  status: 'idle' | 'running';
  /** SDK session ID（用于 resume，SDK 内部维护对话状态 + KV cache） */
  sdkSessionId: string;
  /** 是否已成功完成过 prompt */
  hasPrompted?: boolean;
}

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

  private sessions = new Map<string, QoderSession>();
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
    for (const s of this.sessions.values()) s.abortController.abort();
    this.sessions.clear();
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

  async createSession(opts: SessionCreateOpts): Promise<string> {
    if (!this.initialized) throw SourceError.notInitialized(this.id, this.displayName);

    const id = `qoder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(id, {
      id,
      cwd: opts.cwd,
      model: opts.model,
      abortController: new AbortController(),
      status: 'idle',
      sdkSessionId: opts.resumeSessionId ?? id,
    });
    return id;
  }

  async *prompt(
    sessionId: string,
    message: ContentBlock[],
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<SourceEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      yield {
        type: 'error',
        message: `Session not found: ${sessionId}`,
        code: 'session_not_found',
        retryable: false,
        source: { id: this.id, name: this.displayName },
        suggestion: '会话可能已过期，请重新创建',
      };
      return;
    }

    const controller = new AbortController();
    session.abortController = controller;
    if (opts?.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const text = message.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
    const src = { id: this.id, name: this.displayName };
    session.status = 'running';

    try {
      const { query, qodercliAuth, accessTokenFromEnv } = await import('@qoder-ai/qoder-agent-sdk');
      const auth = this.config.authMode === 'env' ? accessTokenFromEnv() : qodercliAuth();
      const mcpServers = await buildMcpServers(this.injectedTools);

      // 每次 prompt 创建新 query；后续用 resume 恢复上下文（SDK 内部维护 KV cache）
      const q = query({
        prompt: text,
        options: {
          auth,
          cwd: session.cwd,
          model: session.model,
          permissionMode: this.config.permissionMode,
          allowedTools: [
            ...this.capabilities.builtinTools,
            ...this.injectedTools.map((t) => t.name),
          ],
          includePartialMessages: true,
          abortController: controller,
          // 已 prompt 过 → resume 恢复会话上下文
          ...(session.hasPrompted && session.sdkSessionId ? { resume: session.sdkSessionId } : {}),
          ...(mcpServers ? { mcpServers: mcpServers as Record<string, McpServerConfig> } : {}),
        },
      });

      for await (const msg of q) {
        const m = msg as Record<string, unknown>;
        // 捕获 SDK session ID（用于后续 resume）
        if (m.session_id && typeof m.session_id === 'string') {
          session.sdkSessionId = m.session_id;
        }
        for (const event of mapQoderMessage(m, src)) yield event;
        if (m.type === 'result') break;
      }
      yield { type: 'done' };
      session.hasPrompted = true;
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
      session.status = 'idle';
    }
  }

  abort(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.abortController.abort();
      s.status = 'idle';
    }
  }

  destroySession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.abortController.abort();
      this.sessions.delete(sessionId);
    }
    return Promise.resolve();
  }

  isSessionAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
