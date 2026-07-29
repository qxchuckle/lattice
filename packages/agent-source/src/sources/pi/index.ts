/**
 * PiSource — 基于 @earendil-works/pi-coding-agent 库模式
 *
 * 编排层：session 生命周期 + prompt 流程控制。
 * 事件映射 → ./map-event.ts
 * 认证/模型 → ./auth.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
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
  SourceResourceInfo,
  SourceResourceQuery,
} from '../../types.js';
import { SourceError } from '../../types.js';
import { mapPiEvent } from './map-event.js';
import { checkPiAuth, discoverPiModels } from './auth.js';
import { filterKinds } from '../resource-scan.js';

type AgentSession = {
  sessionId: string;
  prompt(
    text: string,
    options?: { images?: Array<{ type: 'image'; data: string; mimeType: string }> },
  ): Promise<void>;
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

/**
 * SDK 惰性加载（模块级普通 async 函数）
 * 注意：不要在 async generator（prompt）体内直接 `await import()` ——
 * vite-node 不重写 async generator 内的动态 import，测试的模块 mock 会失效（拿到真实 SDK）
 */
function loadSdk() {
  return import('@earendil-works/pi-coding-agent');
}

/** 资源发现缓存 TTL（loader reload 有 fs 扫描成本，菜单频繁开合时免重扫） */
const RESOURCE_CACHE_TTL_MS = 60_000;

/** protocol ToolDefinition → pi customTools 适配（pi 无 isError 字段，错误以 throw 传达） */
function toPiCustomTool(t: ToolDefinition): Record<string, unknown> {
  return {
    name: t.name,
    label: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const r = await t.execute(params ?? {});
      if (!r.success) throw new Error(r.error ?? `${t.name} failed`);
      const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '');
      return { content: [{ type: 'text', text }], details: r.data };
    },
  };
}

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
    compaction: 'auto', // pi settings 默认 enabled，事件流发 compaction_start/end
    slashCommands: 'native', // session.prompt 原生解释 /命令：extension 命令执行、/skill:name 与 prompt 模板展开
    nativeSkillInjection: true, // buildSystemPrompt 已注入 <available_skills>，编排层不重复注入
  };

  readonly systemPromptPolicy: SystemPromptPolicy = {
    hasBuiltin: false,
    canOverride: true,
    canAppend: false,
  };

  private sessions = new Map<string, PiSessionHandle>();
  private injectedTools: ToolDefinition[] = [];
  private initialized = false;
  /** 资源发现缓存（按 cwd 分 key，TTL 内复用） */
  private resourceCache = new Map<string, { at: number; resources: SourceResourceInfo[] }>();

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
      // 语义声明：壳层按此渲染，不认工具名（agent-package-layering）
      // task/agent→subagent 预埋：子代理委派工具加进白名单后语义自动为 subagent
      category: (name === 'bash'
        ? 'terminal'
        : name === 'glob' || name === 'grep'
          ? 'search'
          : name === 'read'
            ? 'file-read'
            : name === 'write' || name === 'edit'
              ? 'file-write'
              : name === 'task' || name === 'agent'
                ? 'subagent'
                : 'other') as ToolInfo['category'],
      source: 'builtin' as const,
    }));
  }

  injectTools(_config: InjectToolsConfig | undefined, tools: ToolDefinition[]): void {
    this.injectedTools.push(...tools);
  }

  // ── 资源发现 ──

  /**
   * 经 SDK DefaultResourceLoader 枚举：prompt 模板→command / skills→skill / AGENTS.md→rule。
   * noExtensions：枚举不执行插件代码（extension 命令需运行时注册，不在静态发现范围）。
   */
  async listResources(query?: SourceResourceQuery): Promise<SourceResourceInfo[]> {
    const cwd = resolve(query?.cwd ?? homedir());
    const cached = this.resourceCache.get(cwd);
    if (cached && Date.now() - cached.at < RESOURCE_CACHE_TTL_MS) {
      return filterKinds(cached.resources, query?.kinds);
    }
    try {
      const { DefaultResourceLoader, getAgentDir } = await loadSdk();
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: getAgentDir(),
        noExtensions: true,
      });
      await loader.reload();

      const agentDir = resolve(getAgentDir());
      const scopeOf = (p: string): SourceResourceInfo['scope'] =>
        resolve(p).startsWith(agentDir) ? 'user' : 'project';

      const resources: SourceResourceInfo[] = [];
      for (const p of loader.getPrompts().prompts) {
        resources.push({
          kind: 'command',
          name: p.name,
          description: p.description,
          ...(p.argumentHint ? { argumentHint: p.argumentHint } : {}),
          scope: scopeOf(p.filePath),
          path: p.filePath,
        });
      }
      for (const s of loader.getSkills().skills) {
        resources.push({
          kind: 'skill',
          name: s.name,
          description: s.description,
          scope: scopeOf(s.filePath),
          path: s.filePath,
        });
      }
      for (const f of loader.getAgentsFiles().agentsFiles) {
        resources.push({
          kind: 'rule',
          name: basename(f.path),
          scope: scopeOf(f.path),
          path: f.path,
        });
      }
      this.resourceCache.set(cwd, { at: Date.now(), resources });
      return filterKinds(resources, query?.kinds);
    } catch {
      return []; // 契约：枚举失败不抛错
    }
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
      const { createAgentSession, SessionManager, DefaultResourceLoader, getAgentDir } =
        await loadSdk();

      const cwd = opts?.cwd || process.env.HOME || '/';
      const dir = this.sessionDir(ourId);
      await mkdir(dir, { recursive: true });
      // 落盘持久化：重启后 continueRecent 从该目录的 JSONL 恢复完整上下文
      const sessionManager = SessionManager.continueRecent(cwd, dir);

      // systemPrompt 定制走 ResourceLoader：createAgentSession 无 systemPrompt 选项，直传会被静默丢弃
      let resourceLoader: InstanceType<typeof DefaultResourceLoader> | undefined;
      const sp = opts?.systemPrompt;
      if (sp?.mode === 'override' || sp?.mode === 'append') {
        resourceLoader = new DefaultResourceLoader({
          cwd,
          agentDir: getAgentDir(),
          ...(sp.mode === 'override' ? { systemPrompt: sp.prompt } : {}),
          ...(sp.mode === 'append' ? { appendSystemPrompt: [sp.additional] } : {}),
        });
        await resourceLoader.reload();
      }

      const result = await createAgentSession({
        sessionManager,
        cwd,
        ...(resourceLoader ? { resourceLoader } : {}),
        // 上层注入工具 → pi customTools（与本地目录资源合并后由源提供）
        ...(this.injectedTools.length
          ? { customTools: this.injectedTools.map(toPiCustomTool) }
          : {}),
      } as Parameters<typeof createAgentSession>[0]);

      handle = {
        session: result.session as unknown as AgentSession,
        manager: sessionManager as unknown as PiSessionManager,
      };
      this.sessions.set(ourId, handle);
    }

    const { session, manager } = handle;
    const activeSessionId = ourId;

    const text = message
      .filter((b) => b.type !== 'image') // 图片走原生 images 选项，不占文本位
      .map((b) => (b.type === 'text' ? b.text : `[${b.type}]`))
      .join('\n');
    // 图片块 → pi 原生 images 选项（ImageContent 与 protocol image block 同构）；
    // vision 能力由 ModelInfo.capabilities 声明，UI 层门控，源不再校验
    const images = message
      .filter((b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image')
      .map((b) => ({ type: 'image' as const, data: b.data, mimeType: b.mimeType }));

    const events: SourceEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    const src = { id: this.id, name: this.displayName };

    const unsubscribe = session.subscribe((raw: unknown) => {
      const event = raw as Record<string, unknown>;
      const mapped = mapPiEvent(event, src);
      if (mapped.length > 0) {
        events.push(...mapped);
        resolve?.();
      }
      // 终止信号用 agent_settled 而非 agent_end：threshold 压缩/自动重试在 agent_end 之后、
      // settled 之前发生（_runAgentPrompt 的 post-run 阶段），提前退出会漏掉 compaction 事件
      if (event.type === 'agent_settled' || event.type === 'error') {
        done = true;
        resolve?.();
      }
    });

    // prompt 在 agent 运行前抛出（如模型校验失败）时不会发任何终止事件，兑底退出避免挂死；
    // 正常 resolve 后若仍未 done（extension 拦截等 early-return 路径不发 settled）同样兑底
    const promptPromise = session.prompt(text, images.length > 0 ? { images } : undefined).then(
      () => {
        done = true;
        resolve?.();
      },
      (err: unknown) => {
        events.push({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          code: 'unknown',
          retryable: false,
          source: src,
        });
        done = true;
        resolve?.();
      },
    );

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
    const { SessionManager } = await loadSdk();

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
