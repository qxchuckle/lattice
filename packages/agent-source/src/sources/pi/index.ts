/**
 * PiSource — 基于 @earendil-works/pi-coding-agent 库模式
 *
 * 编排层：session 生命周期 + prompt 流程控制。
 * 事件映射 → ./map-event.ts
 * 认证/模型 → ./auth.ts
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
import { mapPiEvent } from './map-event.js';
import { checkPiAuth, discoverPiModels } from './auth.js';

type AgentSession = {
  sessionId: string;
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
};

export class PiSource implements ISource {
  readonly id = 'pi';
  readonly displayName = 'Pi Agent';
  readonly version = '0.1.0';
  readonly modelPolicy = 'open' as const;

  readonly capabilities: SourceCapabilities = {
    executionMode: 'local',
    builtinTools: ['read', 'write', 'edit', 'bash', 'glob', 'grep'],
    sessionResume: false,
    mcpSupport: true,
    maxConcurrentSessions: 0,
  };

  readonly systemPromptPolicy: SystemPromptPolicy = {
    hasBuiltin: false,
    canOverride: true,
    canAppend: false,
  };

  private sessions = new Map<string, AgentSession>();
  private injectedTools: ToolDefinition[] = [];
  private initialized = false;

  async init(): Promise<void> {
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.initialized = false;
  }

  listModels(): Promise<ModelInfo[]> {
    // modelPolicy='open'：可传任意字符串，但返回当前已配置的可用模型作为推荐
    return discoverPiModels();
  }

  getAuthRequirements(): AuthRequirement[] {
    return [
      { type: 'api_key', envVar: 'ANTHROPIC_API_KEY', description: 'Anthropic API Key' },
      { type: 'api_key', envVar: 'OPENAI_API_KEY', description: 'OpenAI API Key' },
      { type: 'api_key', envVar: 'DEEPSEEK_API_KEY', description: 'DeepSeek API Key' },
      { type: 'api_key', envVar: 'GEMINI_API_KEY', description: 'Google Gemini API Key' },
      {
        type: 'cli_login',
        command: 'pi /login',
        description: 'Pi OAuth 登录（ChatGPT/Claude/Copilot）',
      },
    ];
  }

  checkAuth(): Promise<AuthStatus> {
    return checkPiAuth();
  }

  getAuthConfigPath(): string {
    return '~/.pi/agent/auth.json';
  }

  getBuiltinTools(): ToolInfo[] {
    return this.capabilities.builtinTools.map((name) => ({
      name,
      description: `Pi built-in: ${name}`,
      category: (name === 'bash'
        ? 'terminal'
        : name === 'glob' || name === 'grep'
          ? 'search'
          : 'filesystem') as ToolInfo['category'],
      source: 'builtin' as const,
    }));
  }

  injectTools(_config: InjectToolsConfig | undefined, tools: ToolDefinition[]): void {
    this.injectedTools.push(...tools);
  }

  async createSession(opts: SessionCreateOpts): Promise<string> {
    if (!this.initialized) throw SourceError.notInitialized(this.id, this.displayName);

    const { createAgentSession, SessionManager } = await import('@earendil-works/pi-coding-agent');

    let systemPrompt: string | undefined;
    if (opts.systemPrompt?.mode === 'override') systemPrompt = opts.systemPrompt.prompt;
    if (opts.systemPrompt?.mode === 'append') systemPrompt = opts.systemPrompt.additional;

    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      systemPrompt,
      cwd: opts.cwd,
    } as Parameters<typeof createAgentSession>[0]);

    const s = session as unknown as AgentSession;

    // forkSession + resumeSessionId：从已有 session 复制消息数组（Pi 的 fork = 拷贝历史）
    if (opts.forkSession && opts.resumeSessionId) {
      const parent = this.sessions.get(opts.resumeSessionId);
      if (parent) {
        const parentMsgs = (
          parent as unknown as { messages?: Array<{ role: string; content: string }> }
        ).messages;
        const childMsgs = (s as unknown as { messages?: Array<{ role: string; content: string }> })
          .messages;
        if (Array.isArray(parentMsgs) && Array.isArray(childMsgs)) {
          childMsgs.push(...parentMsgs.map((m) => ({ ...m })));
        }
      }
    }

    this.sessions.set(s.sessionId, s);
    return s.sessionId;
  }

  async *prompt(
    sessionId: string,
    message: ContentBlock[],
    _opts?: { signal?: AbortSignal },
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

    const text = message.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');

    const events: SourceEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    const src = { id: this.id, name: this.displayName };

    const unsubscribe = session.subscribe((raw: unknown) => {
      const event = raw as Record<string, unknown>;
      const mapped = mapPiEvent(event, src);
      if (mapped) {
        events.push(mapped);
        resolve?.();
      }
      if (event.type === 'agent_end' || event.type === 'error') {
        done = true;
        resolve?.();
      }
    });

    const promptPromise = session.prompt(text);

    try {
      while (!done) {
        if (events.length > 0) {
          yield events.shift()!;
        } else {
          await new Promise<void>((r) => {
            resolve = r;
          });
          resolve = null;
        }
      }
      while (events.length > 0) yield events.shift()!;
      yield { type: 'done' };
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        code: 'unknown',
        retryable: false,
        source: src,
      };
    } finally {
      unsubscribe();
      await promptPromise.catch(() => {});
    }
  }

  abort(sessionId: string): void {
    this.sessions.get(sessionId)?.abort();
  }

  destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.dispose();
      this.sessions.delete(sessionId);
    }
    return Promise.resolve();
  }

  isSessionAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
