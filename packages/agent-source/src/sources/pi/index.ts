/**
 * PiDriver — 基于 @earendil-works/pi-coding-agent 的源 driver（会话与流式主体）
 *
 * 只含 SDK 特定原子操作；事件泵/握手/守卫/ts 注入由 defineSource 工厂提供。
 * 声明 → ./capabilities.ts；事件映射 → ./map-event.ts；认证/模型 → ./auth.ts；
 * 资源枚举 → ./resources.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type {
  ISource,
  AuthStatus,
  ModelInfo,
  ContentBlock,
  PromptOpts,
  ToolDefinition,
  SourceResourceInfo,
  SourceResourceQuery,
} from '@qcqx/lattice-agent-protocol';
import { CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';
import type {
  SourceDriver,
  DriverSessionHandle,
  DriverEmit,
  DriverPromptOutcome,
} from '../../driver.js';
import { defineSource } from '../../define-source.js';
import { mapPiEvent } from './map-event.js';
import { checkPiAuth, discoverPiModels } from './auth.js';
import { PI_INFO, PI_CAPABILITIES, PI_AUTH_REQUIREMENTS } from './capabilities.js';
import { scanPiResources } from './resources.js';

// ── SDK 最小结构类型 ──

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

/**
 * SDK 惰性加载（模块级普通 async 函数）
 * 注意：不要在 async 函数体外直接 `await import()` —— vite-node 不重写
 * async generator 内的动态 import，测试的模块 mock 会失效（拿到真实 SDK）
 */
function loadSdk() {
  return import('@earendil-works/pi-coding-agent');
}

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

interface PiHandle extends DriverSessionHandle {
  readonly session: AgentSession;
  readonly manager: PiSessionManager;
}

export interface PiSourceOptions {
  /** 会话持久化根目录（通用 SDK 不绑 lattice 目录——宿主可注入；缺省保持既有路径） */
  sessionsRoot?: string;
}

class PiDriver implements SourceDriver<PiHandle> {
  readonly contractVersion = CONTRACT_VERSION;
  readonly info = PI_INFO;
  readonly capabilities = PI_CAPABILITIES;
  readonly authRequirements = PI_AUTH_REQUIREMENTS;

  private readonly sessionsRoot: string;

  constructor(options?: PiSourceOptions) {
    this.sessionsRoot =
      options?.sessionsRoot ?? join(homedir(), '.lattice', 'agent-sessions', 'pi');
  }

  private sessionDir(id: string): string {
    return join(this.sessionsRoot, id);
  }

  checkAuth(): Promise<AuthStatus> {
    return checkPiAuth();
  }

  listModels(): Promise<ModelInfo[]> {
    return discoverPiModels();
  }

  scanResources(query?: SourceResourceQuery): Promise<SourceResourceInfo[]> {
    return scanPiResources(query);
  }

  // ── 会话 ──

  async connect(sessionId: string | null, opts: PromptOpts): Promise<PiHandle> {
    const { createAgentSession, SessionManager, DefaultResourceLoader, getAgentDir } =
      await loadSdk();

    const id = sessionId ?? randomUUID();
    const cwd = opts.cwd || process.env.HOME || '/';
    const dir = this.sessionDir(id);
    await mkdir(dir, { recursive: true });
    // 落盘持久化：重启后 continueRecent 从该目录的 JSONL 恢复完整上下文（目录空则新建）
    const sessionManager = SessionManager.continueRecent(cwd, dir);

    // systemPrompt 定制走 ResourceLoader：createAgentSession 无 systemPrompt 选项，直传会被静默丢弃
    let resourceLoader: InstanceType<typeof DefaultResourceLoader> | undefined;
    const sp = opts.systemPrompt;
    if (sp?.mode === 'override' || sp?.mode === 'append') {
      resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: getAgentDir(),
        ...(sp.mode === 'override' ? { systemPrompt: sp.prompt } : {}),
        ...(sp.mode === 'append' ? { appendSystemPrompt: [sp.additional] } : {}),
      });
      await resourceLoader.reload();
    }

    // 宿主工具 = 会话建立参数（非源级状态）：仅本会话生效，跨会话/宿主互不污染
    const sessionTools = opts.tools?.tools ?? [];
    const result = await createAgentSession({
      sessionManager,
      cwd,
      ...(resourceLoader ? { resourceLoader } : {}),
      ...(sessionTools.length ? { customTools: sessionTools.map(toPiCustomTool) } : {}),
    } as Parameters<typeof createAgentSession>[0]);

    const session = result.session as unknown as AgentSession;
    const manager = sessionManager as unknown as PiSessionManager;
    return {
      id,
      session,
      manager,
      abort: () => session.abort(),
      close: () => session.dispose(),
    };
  }

  async prompt(
    handle: PiHandle,
    message: ContentBlock[],
    _opts: PromptOpts,
    emit: DriverEmit,
  ): Promise<DriverPromptOutcome> {
    const { session } = handle;
    const src = { id: this.info.id, name: this.info.displayName };

    const text = message
      .filter((b) => b.type !== 'image') // 图片走原生 images 选项，不占文本位
      .map((b) => (b.type === 'text' ? b.text : `[${b.type}]`))
      .join('\n');
    // 图片块 → pi 原生 images 选项（ImageContent 与 protocol image block 同构）
    const images = message
      .filter((b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image')
      .map((b) => ({ type: 'image' as const, data: b.data, mimeType: b.mimeType }));

    await new Promise<void>((resolveSettled) => {
      let settled = false;
      let unsub: () => void = () => {};
      const finish = () => {
        if (settled) return;
        settled = true;
        unsub();
        resolveSettled();
      };
      // 终止信号用 agent_settled 而非 agent_end：threshold 压缩/自动重试在 agent_end 之后、
      // settled 之前发生（post-run 阶段），提前退出会漏掉 compaction 事件
      unsub = session.subscribe((raw: unknown) => {
        const event = raw as Record<string, unknown>;
        for (const mapped of mapPiEvent(event, src)) emit(mapped);
        if (event.type === 'agent_settled' || event.type === 'error') finish();
      });
      // prompt 在 agent 运行前抛出（如模型校验失败）时不发任何终止事件——
      // 非致命路径：emit error 内容事件后正常收尾（保持旧行为：error + done 都会出现）
      session.prompt(text, images.length > 0 ? { images } : undefined).then(finish, (err) => {
        emit({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          code: 'unknown',
          retryable: false,
          source: src,
        });
        finish();
      });
    });

    // 捕获最后一条消息的 Pi entry ID（fork 锚点，存入树节点 metadata）
    return { sourceMessageId: handle.manager.getLeafId() ?? undefined };
  }

  // ── fork（atMessage 锚点由工厂按能力守卫，进入此处即合法） ──

  async forkNative(sessionId: string, atMessage?: string): Promise<string> {
    const cwd = process.env.HOME || '/';
    const parentDir = this.sessionDir(sessionId);
    const { SessionManager } = await loadSdk();

    const newId = randomUUID();
    const newDir = this.sessionDir(newId);
    await mkdir(newDir, { recursive: true });

    if (atMessage !== undefined) {
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
}

/** 裸 driver 工厂（契约套件/进阶定制用；常规消费走 createPiSource） */
export function createPiDriver(options?: PiSourceOptions): SourceDriver<PiHandle> {
  return new PiDriver(options);
}

/** 创建 Pi 源（driver → defineSource 工厂包装） */
export function createPiSource(options?: PiSourceOptions): ISource {
  return defineSource(new PiDriver(options));
}

// 声明合并：源 ID 编译期收紧（getSource('pi') / KnownSourceId）
declare module '@qcqx/lattice-agent-protocol' {
  interface LatticeSourceMap {
    pi: ISource;
  }
}
