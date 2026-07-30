/**
 * AcpDriver — 入向 ACP 源（基于官方 @agentclientprotocol/sdk v1 stable）
 *
 * 新 SDK 接入 = 本文件（~180 行）+ 一行注册。
 * 传输/帧分割/JSON-RPC 路由/反向调用全部由 SDK 管理，本文件只做：
 *   - SourceDriver 接口适配
 *   - SDK 事件 → SourceEvent 映射（event-map.ts）
 *   - 能力声明（ACP 残缺面如实标注）
 */
import type {
  SourceInfo,
  SourceCapabilities,
  AuthRequirement,
  AuthStatus,
  ModelInfo,
  ContentBlock,
  PromptOpts,
} from '@qcqx/lattice-agent-protocol';
import { CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';
import type {
  SourceDriver,
  DriverSessionHandle,
  DriverEmit,
  DriverPromptOutcome,
  DriverProbeReport,
} from '../../driver.js';
import {
  client,
  ndJsonStream,
  methods,
  type ClientConnection,
  type ActiveSession,
  type Stream,
} from '@agentclientprotocol/sdk';
import type { SessionNotification, InitializeResponse } from '@agentclientprotocol/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';
import { mapSessionUpdate } from './event-map.js';

// ── 配置 ──

export interface AcpSourceOptions {
  /** 启动命令（如 'qoder'、'claude' 等 ACP 兼容 agent） */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 源 ID（默认取命令名） */
  id?: string;
  /** 显示名 */
  displayName?: string;
  /** 工作目录 */
  cwd?: string;
  /** 额外环境变量（合入 process.env；部分 agent 靠 env 传认证/配置） */
  env?: Record<string, string>;
}

// ── 能力声明（ACP v1 实际覆盖，残缺面不伪装） ──

/**
 * 静态声明（declared）——ACP v1 基线能力。
 *
 * 注意：这只是**乐观声明**，真实能力由 probe() 读 initialize 响应的 agentCapabilities 降准。
 * ACP 协议规定：未在 initialize 响应中出现的能力 **MUST** 视为不支持，
 * 所以 declared 写得宽、probe 收窄，降准过程自动进 downgrades 留痕。
 */
const ACP_CAPABILITIES: SourceCapabilities = {
  execution: { mode: 'delegated', contextOwnership: 'source' },
  session: {
    resume: true, // probe 根据 agentCapabilities.loadSession 降准
    fork: { atMessage: false },
    rename: false,
    maxConcurrentSessions: 'unlimited',
  },
  prompt: {
    images: true, // probe 根据 promptCapabilities.image 降准
    systemPrompt: { builtin: 'none', override: false, append: false },
    slashCommands: false,
    permissionModes: false,
  },
  tools: { builtin: [], injection: false },
  context: { compaction: false },
  models: { policy: 'catalog', tuning: false },
  resources: false,
  skills: { nativeInjection: false },
};

// ── 协议版本 ──

/** 本 driver 实现的 ACP 主版本（v1 stable；v2 仍为草案，不跟） */
const ACP_PROTOCOL_VERSION = 1;

// ── stopReason 文案（协议定义的四种非 end_turn 终止） ──

/** ACP stopReason → 用户可读提示（源不静默降级：提前终止必告知） */
const STOP_REASON_NOTICE: Record<string, string> = {
  max_tokens: '回复因达到模型最大 token 限制而截断，内容可能不完整',
  max_turn_requests: '单轮内模型请求次数超上限，任务可能未完成',
  refusal: 'agent 拒绝继续本次任务',
};

// ── stdio → Web Stream 桥接 ──

function createStdioStream(child: ChildProcess): Stream {
  const readable = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
  const writable = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
  return ndJsonStream(writable, readable);
}

// ── Driver 实现 ──

interface AcpSessionHandle extends DriverSessionHandle {
  active: ActiveSession;
}

class AcpDriver implements SourceDriver<AcpSessionHandle> {
  readonly contractVersion = CONTRACT_VERSION;
  readonly info: SourceInfo;
  readonly capabilities = ACP_CAPABILITIES;
  readonly authRequirements: AuthRequirement[] = [];

  private child: ChildProcess | null = null;
  private connection: ClientConnection | null = null;
  private initResult: InitializeResponse | null = null;
  /**
   * per-session 权限回调表。
   *
   * **必须按会话隔离**：lattice 的核心能力是跳分支并行流式（tree-runtime：同分支串行、跳分支并行），
   * 同一个 driver 实例会同时跑多个 session。若用单字段，分支 B 会覆盖分支 A 的 handler，
   * 导致 A 的权限请求跑到 B 的宿主回调（sessionId 上下文错位），且先结束者会清掉后结束者的 handler。
   */
  private readonly permissionHandlers = new Map<
    string,
    (tool: string, description: string) => Promise<boolean>
  >();
  /**
   * 已发 cancel 的会话集。
   * 协议要求（prompt-turn#cancellation）：cancel 后对所有 pending request_permission
   * **MUST** 以 `cancelled` outcome 应答，否则 agent 会等到超时。
   */
  private readonly cancelledSessions = new Set<string>();

  constructor(private readonly opts: AcpSourceOptions) {
    const id = opts.id ?? opts.command.split('/').pop() ?? 'acp';
    this.info = { id, displayName: opts.displayName ?? id, version: '1.0.0' };
  }

  async init(): Promise<void> {
    // 启动子进程
    const child = spawn(this.opts.command, this.opts.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.opts.cwd,
      env: this.opts.env ? { ...process.env, ...this.opts.env } : process.env,
    });
    this.child = child;

    // 构建 SDK client（注册全部反向调用处理器）
    const app = client({ name: 'lattice' })
      .onRequest(methods.client.session.requestPermission, async ({ params }) => {
        // 协议结构：{ sessionId, toolCall: ToolCallUpdate, options: PermissionOption[] }
        // 注意：工具信息在 toolCall 里（不是顶层 tool/description），
        // 且应答的 optionId **必须从 agent 给的 options 中选**（不能硬编码 'allow'/'reject'，
        // 各 agent 的 optionId 命名不同；kind 字段才是语义标识）。
        const p = params as {
          sessionId?: string;
          toolCall?: { toolCallId?: string; title?: string; rawName?: string };
          options?: Array<{ optionId: string; name?: string; kind?: string }>;
        };
        const sid = p.sessionId;
        const options = p.options ?? [];

        /** 按 kind 语义选项（allow_once/allow_always → 授权；reject_* → 拒绝） */
        const pickOption = (allow: boolean): string | undefined => {
          const wanted = allow ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
          const hit = options.find((o) => o.kind !== undefined && wanted.includes(o.kind));
          return hit?.optionId ?? options[0]?.optionId;
        };

        // 协议硬要求：已 cancel 的会话必须用 cancelled outcome 应答（不能挂着等超时）
        if (sid && this.cancelledSessions.has(sid)) {
          return { outcome: { outcome: 'cancelled' } };
        }

        // 按 sessionId 取该分支自己的 handler（跨分支并行时不能串台）
        const handler = sid ? this.permissionHandlers.get(sid) : undefined;
        const toolName = p.toolCall?.rawName ?? p.toolCall?.title ?? 'unknown';
        if (handler) {
          const allowed = await handler(toolName, p.toolCall?.title ?? '');
          const optionId = pickOption(allowed);
          if (optionId === undefined) {
            // agent 未给任何选项：无法应答具体选项，按取消处理（而非胡乱编 id）
            return { outcome: { outcome: 'cancelled' } };
          }
          return { outcome: { outcome: 'selected', optionId } };
        }
        // 无对应 handler（宿主未提供权限通道）→ 默认拒绝（fail-closed）
        const rejectId = pickOption(false);
        return rejectId !== undefined
          ? { outcome: { outcome: 'selected', optionId: rejectId } }
          : { outcome: { outcome: 'cancelled' } };
      })
      // fs 反向调用：已在 clientCapabilities 声明，必须实现（否则 agent 收到 -32601）
      .onRequest(methods.client.fs.readTextFile, async ({ params }) => {
        const p = params as { path: string; line?: number | null; limit?: number | null };
        const content = await readFile(p.path, 'utf8');
        // 协议约定：行号 1-based；line/limit 均缺省时返全文（两者均可为 null 或 undefined）
        const line = p.line ?? undefined;
        const limit = p.limit ?? undefined;
        if (line === undefined && limit === undefined) return { content };
        const lines = content.split('\n');
        const start = Math.max(0, (line ?? 1) - 1);
        const end = limit !== undefined ? start + limit : lines.length;
        return { content: lines.slice(start, end).join('\n') };
      })
      .onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
        const p = params as { path: string; content: string };
        await writeFile(p.path, p.content, 'utf8');
        return {};
      });

    // 连接（SDK 管理帧分割/路由/超时）
    const stream = createStdioStream(child);
    this.connection = app.connect(stream);

    // initialize 握手
    this.initResult = await this.connection.agent.request(methods.agent.initialize, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'lattice', title: 'Lattice', version: '0.1.0' },
    });

    // 版本协商（协议 MUST）：agent 返回的版本我们不支持时应关连接并告知用户，
    // 而非带着不匹配的语义继续跑（那会产生难排查的奇怪错误）。
    const negotiated = (this.initResult as Record<string, unknown>)?.protocolVersion;
    if (typeof negotiated === 'number' && negotiated !== ACP_PROTOCOL_VERSION) {
      this.child?.kill('SIGTERM');
      this.child = null;
      this.connection = null;
      throw new Error(
        `ACP 协议版本不匹配：agent 要求 v${negotiated}，本客户端支持 v${ACP_PROTOCOL_VERSION}。` +
          '请升级 lattice 或使用兼容版本的 agent。',
      );
    }
  }

  async dispose(): Promise<void> {
    if (this.child) {
      this.child.kill('SIGTERM');
      const c = this.child;
      const t = setTimeout(() => {
        try {
          c.kill('SIGKILL');
        } catch {
          /* 已退出 */
        }
      }, 2000);
      t.unref?.();
      this.child = null;
    }
    this.connection = null;
  }

  async checkAuth(): Promise<AuthStatus> {
    // 读 initialize 响应的 authMethods：非空 = agent 要求认证且尚未完成
    const methodsList = (this.initResult as Record<string, unknown>)?.authMethods as
      | Array<{ id?: string; name?: string }>
      | undefined;
    if (methodsList && methodsList.length > 0) {
      const names = methodsList.map((m) => m.name ?? m.id ?? 'unknown').join(' / ');
      return {
        status: 'missing',
        message: `ACP agent 要求认证（可用方式：${names}），请先在 agent 侧完成登录`,
      };
    }
    return { status: 'configured' };
  }

  async listModels(): Promise<ModelInfo[]> {
    // 从 initialize 响应的 configOptions 提取 model 类选项
    const opts = (this.initResult as Record<string, unknown>)?.configOptions as
      | Array<{ category: string; options?: Array<{ id: string; name?: string }> }>
      | undefined;
    const modelOpt = opts?.find((o) => o.category === 'model');
    if (!modelOpt?.options) return [];
    return modelOpt.options.map((o) => ({
      id: o.id,
      displayName: o.name ?? o.id,
      contextWindow: 0,
      maxOutputTokens: 0,
      capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
    }));
  }

  async probe(): Promise<DriverProbeReport> {
    const init = this.initResult as Record<string, unknown> | null;
    const overrides: NonNullable<DriverProbeReport['overrides']> = [];

    // ACP 铁律：未在 initialize 响应出现的能力 MUST 视为不支持
    const agentCaps = this.agentCaps();

    // resume 一律降准：即使 agent 支持 loadSession，SDK 也无公开 API 把已知 sessionId
    // 包成 ActiveSession（attachSession 私有），故本 driver 暂无法实现真恢复。
    // 声明与实现保持一致——不允许声明自己做不到的事。
    overrides.push({
      path: 'session.resume',
      actual: false,
      reason:
        agentCaps?.loadSession === true
          ? 'agent 支持 session/load，但 SDK 未开放从 sessionId 重建 ActiveSession 的入口 → 暂不支持恢复'
          : 'initialize 未声明 agentCapabilities.loadSession → 不支持恢复',
    });

    // 图片输入：基线仅 text/resource_link，image 需显式声明
    if (this.agentPromptCaps()?.image !== true) {
      overrides.push({
        path: 'prompt.images',
        actual: false,
        reason: 'initialize 未声明 promptCapabilities.image → 仅文本输入',
      });
    }

    const info = init?.agentInfo as { version?: string } | undefined;
    return { overrides, sdkVersion: info?.version };
  }

  async connect(sessionId: string | null, _opts: PromptOpts): Promise<AcpSessionHandle> {
    if (!this.connection) throw new Error('ACP 未初始化');
    const ctx = this.connection.agent;
    const cwd = this.opts.cwd ?? process.cwd();

    // 恢复已有会话的 SDK 能力缺口：
    // session/load 只能让 agent 重放历史，但 SDK 把“从已知 sessionId 构造 ActiveSession”
    // 的 attachSession 定为私有，无公开入口。先调 load 再 buildSession 会**多建一个新会话**，
    // 且 nextUpdate() 监听的是新会话——恢复语义实际不成立。
    // 故目前一律新建，并在 probe 里将 session.resume 降准为 false（声明与实现一致）。
    // 宿主影响可控：lattice 的对话树是宿主真相，源侧会话丢弃不丢用户内容。
    void sessionId;

    const active = await ctx.buildSession(cwd).start();
    return this.wrapHandle(active.sessionId, active);
  }

  /**
   * 句柄包装：abort 发 session/cancel 通知。
   *
   * 注意不在此 dispose：协议允许 agent 在 cancel 后继续发 session/update（且 client SHOULD 接受），
   * 只要它在应答 prompt 前发完。提前 dispose 会丢掉中止前的最后内容；
   * 真正的路由清理在 prompt() 的 finally 里（此时 prompt 已带 stopReason 返回）。
   */
  private wrapHandle(id: string, active: ActiveSession): AcpSessionHandle {
    return {
      id,
      active,
      abort: () => {
        // 记住已取消：pending permission 请求据此用 cancelled outcome 应答
        this.cancelledSessions.add(id);
        // 通知 agent 停生成（否则它继续烧 token）
        void this.connection?.agent
          .notify(methods.agent.session.cancel, { sessionId: id })
          .catch(() => {
            /* 连接已断：中止目的已达成 */
          });
      },
    };
  }

  // ── initialize 响应的能力读取（单一落点，避免各处重复链式断言） ──

  /** agent 声明的能力（未声明返 undefined；协议：缺失 = 不支持） */
  private agentCaps(): Record<string, unknown> | undefined {
    return (this.initResult as Record<string, unknown> | null)?.agentCapabilities as
      | Record<string, unknown>
      | undefined;
  }

  /** agent 的 prompt 内容能力（image/audio/embeddedContext） */
  private agentPromptCaps(): Record<string, unknown> | undefined {
    return this.agentCaps()?.promptCapabilities as Record<string, unknown> | undefined;
  }

  async prompt(
    session: AcpSessionHandle,
    message: ContentBlock[],
    opts: PromptOpts,
    emit: DriverEmit,
  ): Promise<DriverPromptOutcome> {
    // 权限桥接线
    if (opts.onPermissionRequest) {
      const hostHandler = opts.onPermissionRequest;
      this.permissionHandlers.set(session.id, async (tool: string, description: string) => {
        const decision = await hostHandler({
          kind: 'tool',
          toolName: tool,
          description,
          sessionId: session.id,
        });
        return decision.behavior === 'allow';
      });
    }

    try {
      // 构建 prompt 内容块。
      // 图片：agent 声明 promptCapabilities.image 时直传；否则丢弃**并发 notice**
      // （铁律：近似执行必发 notice——静默丢图会让用户以为模型看到了图）。
      const supportsImage = this.agentPromptCaps()?.image === true;

      const blocks: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
      > = [];
      let droppedImages = 0;
      for (const b of message) {
        if (b.type === 'text') {
          blocks.push({ type: 'text', text: b.text });
        } else if (b.type === 'image') {
          if (supportsImage) {
            blocks.push({ type: 'image', data: b.data, mimeType: b.mimeType });
          } else {
            droppedImages++;
          }
        }
        // file 块：协议对应 resource_link，待需求出现再接
      }
      if (droppedImages > 0) {
        emit({
          type: 'notice',
          level: 'warning',
          message: `已省略 ${droppedImages} 张图片：该 agent 未声明图片输入能力（promptCapabilities.image）`,
        });
      }

      // 发起 prompt（SDK 管理请求/响应）
      const promptPromise = session.active.prompt(blocks);

      // 消费流式更新直到 stop
      let usage: { input?: number; output?: number } | undefined;
      let stopReason: string | undefined;
      while (true) {
        const msg = await session.active.nextUpdate();
        if (msg.kind === 'stop') {
          // prompt 完成：提取 usage 与 stopReason
          const resp = msg.response as Record<string, unknown> | undefined;
          const u = resp?.usage as { inputTokens?: number; outputTokens?: number } | undefined;
          if (u) usage = { input: u.inputTokens, output: u.outputTokens };
          stopReason = resp?.stopReason as string | undefined;
          break;
        }
        // session_update → 映射为 SourceEvent
        const notification = msg.notification as SessionNotification;
        const event = mapSessionUpdate(notification);
        if (event) emit(event as Parameters<DriverEmit>[0]);
      }

      await promptPromise; // 确保 prompt 请求本身也完成

      // 铁律：源永不静默降级——非正常终止原因必发 notice（否则用户以为回答完整）
      // end_turn = 正常完成；cancelled = 用户主动中止（已有 interrupted 态，不重复提示）
      if (stopReason !== undefined && stopReason !== 'end_turn' && stopReason !== 'cancelled') {
        emit({
          type: 'notice',
          level: 'warning',
          message: STOP_REASON_NOTICE[stopReason] ?? `回复提前终止（${stopReason}）`,
        });
      }

      return {
        sessionId: session.id,
        usage: usage ? { input: usage.input ?? 0, output: usage.output ?? 0 } : undefined,
      };
    } finally {
      this.permissionHandlers.delete(session.id);
      // 此时 prompt 已带 stopReason 返回（agent 不会再发 update），可安全停路由
      session.active.dispose();
      this.cancelledSessions.delete(session.id);
    }
  }

  async forkNative(sessionId: string): Promise<string> {
    if (!this.connection) throw new Error('ACP 未初始化');
    const result = await this.connection.agent.request(methods.agent.session.fork, {
      sessionId,
      cwd: this.opts.cwd,
      mcpServers: [],
    });
    return (result as { sessionId: string }).sessionId;
  }
}

// ── 工厂 ──

export function createAcpSource(options: AcpSourceOptions): SourceDriver<AcpSessionHandle> {
  return new AcpDriver(options);
}
