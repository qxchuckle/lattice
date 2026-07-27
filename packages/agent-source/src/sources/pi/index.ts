/**
 * PiSource — 基于 @earendil-works/pi-coding-agent 库模式
 *
 * 编排层：session 生命周期 + prompt 流程控制。
 * 事件映射 → ./map-event.ts
 * 认证/模型 → ./auth.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
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
import { mapPiEvent } from './map-event.js';
import { checkPiAuth, discoverPiModels } from './auth.js';

type AgentSession = {
  sessionId: string;
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
};

/** Pi SessionManager 的最小结构类型（仅声明用到的方法） */
type PiSessionManager = {
  getLeafId(): string | null;
  createBranchedSession(leafId: string): string | undefined;
  getSessionFile(): string | undefined;
};

type PiSessionHandle = { session: AgentSession; manager: PiSessionManager };

export class PiSource implements ISource {
  readonly id = 'pi';
  readonly displayName = 'Pi Agent';
  readonly version = '0.1.0';
  readonly modelPolicy = 'open' as const;

  readonly capabilities: SourceCapabilities = {
    executionMode: 'local',
    builtinTools: ['read', 'write', 'edit', 'bash', 'glob', 'grep'],
    sessionResume: true,
    mcpSupport: true,
    maxConcurrentSessions: 0,
  };

  readonly systemPromptPolicy: SystemPromptPolicy = {
    hasBuiltin: false,
    canOverride: true,
    canAppend: false,
  };

  private sessions = new Map<string, PiSessionHandle>();
  private injectedTools: ToolDefinition[] = [];
  private initialized = false;

  /** Pi 会话持久化根目录（每个源 session 独立子目录，重启可恢复） */
  private get sessionsRoot(): string {
    return join(homedir(), '.lattice', 'agent-sessions', 'pi');
  }

  private sessionDir(ourId: string): string {
    return join(this.sessionsRoot, ourId);
  }

  async init(): Promise<void> {
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    for (const handle of this.sessions.values()) handle.session.dispose();
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

  // ── 核心交互 ──

  async *prompt(
    sessionId: string | null,
    message: ContentBlock[],
    opts?: PromptOpts,
  ): AsyncIterable<SourceEvent> {
    if (!this.initialized) throw SourceError.notInitialized(this.id, this.displayName);

    // ourId 是源自己的会话标识（= 独立目录名），上层存入树以便重启恢复
    const ourId = sessionId ?? randomUUID();

    // 获取或创建 session：内存没有则从磁盘恢复（continueRecent：目录空则新建，有则续写）
    let handle = this.sessions.get(ourId);
    if (!handle) {
      const { createAgentSession, SessionManager } =
        await import('@earendil-works/pi-coding-agent');
      let systemPrompt: string | undefined;
      if (opts?.systemPrompt?.mode === 'override') systemPrompt = opts.systemPrompt.prompt;
      if (opts?.systemPrompt?.mode === 'append') systemPrompt = opts.systemPrompt.additional;

      const cwd = opts?.cwd || process.env.HOME || '/';
      const dir = this.sessionDir(ourId);
      await mkdir(dir, { recursive: true });
      // 落盘持久化：重启后 continueRecent 从该目录的 JSONL 恢复完整上下文
      const sessionManager = SessionManager.continueRecent(cwd, dir);

      const result = await createAgentSession({
        sessionManager,
        systemPrompt,
        cwd,
      } as Parameters<typeof createAgentSession>[0]);

      handle = {
        session: result.session as unknown as AgentSession,
        manager: sessionManager as unknown as PiSessionManager,
      };
      this.sessions.set(ourId, handle);
    }

    const { session, manager } = handle;
    const activeSessionId = ourId;

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
      // 捕获最后一条消息的 Pi entry ID（fork 截断点，存入树节点 metadata）
      const sourceMessageId = manager.getLeafId() ?? undefined;
      yield { type: 'done', sessionId: activeSessionId, sourceMessageId };
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
    this.sessions.get(sessionId)?.session.abort();
  }

  destroySession(sessionId: string): Promise<void> {
    const handle = this.sessions.get(sessionId);
    if (handle) {
      handle.session.dispose();
      this.sessions.delete(sessionId);
    }
    return Promise.resolve();
  }

  isSessionAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  // ── 分支 ──

  async forkSession(sessionId: string, atMessage?: string): Promise<string> {
    const cwd = process.env.HOME || '/';
    const parentDir = this.sessionDir(sessionId);
    const { SessionManager } = await import('@earendil-works/pi-coding-agent');

    const newId = randomUUID();
    const newDir = this.sessionDir(newId);
    await mkdir(newDir, { recursive: true });

    if (atMessage) {
      // 截断 fork：打开父 session，创建只含 root→atMessage 路径的新 session 文件
      const parentManager = SessionManager.continueRecent(
        cwd,
        parentDir,
      ) as unknown as PiSessionManager;
      const branchedPath = parentManager.createBranchedSession(atMessage);
      if (!branchedPath) {
        throw new Error(`Cannot fork: entry ${atMessage} not found in session ${sessionId}`);
      }
      // createBranchedSession 写在父目录，移到新 session 的独立目录
      await rename(branchedPath, join(newDir, basename(branchedPath)));
    } else {
      // 全量 fork：拷贝父会话完整历史
      const files = await readdir(parentDir).catch(() => [] as string[]);
      const parentFile = files.find((f) => f.endsWith('.jsonl'));
      if (!parentFile) {
        throw new Error(`Cannot fork: no persisted session for ${sessionId}`);
      }
      SessionManager.forkFrom(join(parentDir, parentFile), cwd, newDir);
    }
    return newId;
  }

  async renameSession(_sessionId: string, _title: string): Promise<void> {
    // Pi 使用内存 session，无持久化标题，no-op
  }
}
