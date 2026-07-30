/**
 * AcpDriver — 入向 ACP 源（外部 ACP agent 作为 lattice 的一个 source）
 *
 * 新 SDK 接入 = 本文件（预估 150~250 行）+ 一行注册。
 * 行为铁律同其他 driver：永不静默降级、abort 是正常结局、done 由工厂合成。
 *
 * ACP 能力残缺（无 systemPrompt/compaction/slashCommands）——缺口由策略表 polyfill，
 * 本 driver 只声明实际能力，不伪装。
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
import { AcpTransport } from './jsonrpc.js';
import { mapAcpUpdate } from './event-map.js';
import type {
  AcpInitializeResult,
  AcpSessionNewResult,
  AcpPromptResult,
  AcpForkResult,
  AcpSessionUpdate,
  AcpPermissionRequest,
  JsonRpcNotification,
  JsonRpcServerRequest,
} from './types.js';

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
  /** 请求超时（毫秒） */
  timeoutMs?: number;
}

// ── 能力声明（ACP v1 实际覆盖） ──

const ACP_CAPABILITIES: SourceCapabilities = {
  execution: { mode: 'delegated', contextOwnership: 'source' },
  session: {
    resume: true,
    fork: { atMessage: false },
    rename: false,
    maxConcurrentSessions: 'unlimited',
  },
  prompt: {
    images: false,
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

// ── Driver 实现 ──

class AcpDriver implements SourceDriver {
  readonly contractVersion = CONTRACT_VERSION;
  readonly info: SourceInfo;
  readonly capabilities = ACP_CAPABILITIES;
  readonly authRequirements: AuthRequirement[] = [];

  private transport: AcpTransport;
  private initResult: AcpInitializeResult | null = null;
  /** 当前 prompt 的事件发射器（通知路由用） */
  private activeEmit: DriverEmit | null = null;
  /** 权限桥（由 prompt opts 注入） */
  private permissionHandler: ((req: AcpPermissionRequest) => Promise<string>) | null = null;

  constructor(private readonly opts: AcpSourceOptions) {
    const id = opts.id ?? opts.command.split('/').pop() ?? 'acp';
    this.info = { id, displayName: opts.displayName ?? id, version: '1.0.0' };
    this.transport = new AcpTransport({
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
    });
  }

  async init(): Promise<void> {
    this.transport.onNotification((msg) => this.onNotification(msg));
    this.transport.onReverseRequest((msg) => this.onReverseRequest(msg));
    this.transport.start();

    // initialize 握手
    this.initResult = await this.transport.call<AcpInitializeResult>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'lattice', version: '0.1.0' },
    });
  }

  async dispose(): Promise<void> {
    this.transport.kill();
  }

  async checkAuth(): Promise<AuthStatus> {
    // 本地进程无需认证（spawn 即可用）
    return { status: 'configured' };
  }

  async listModels(): Promise<ModelInfo[]> {
    // 从 initialize 的 configOptions 提取 model 类选项
    const modelOpt = this.initResult?.configOptions?.find((o) => o.category === 'model');
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
    // ACP 声明即实际（无 SDK 版本差异），不产 override
    return { overrides: [], sdkVersion: this.initResult?.agentInfo?.version };
  }

  async connect(sessionId: string | null, _opts: PromptOpts): Promise<DriverSessionHandle> {
    if (sessionId) {
      // 恢复已有会话（ACP session/resume 或直接用 sessionId）
      return { id: sessionId, abort: () => {} };
    }
    const result = await this.transport.call<AcpSessionNewResult>('session/new', {
      cwd: this.opts.cwd,
      mcpServers: [],
    });
    return { id: result.sessionId, abort: () => {} };
  }

  async prompt(
    session: DriverSessionHandle,
    message: ContentBlock[],
    opts: PromptOpts,
    emit: DriverEmit,
  ): Promise<DriverPromptOutcome> {
    this.activeEmit = emit;

    // 权限桥：opts.onPermissionRequest → ACP request_permission 应答
    if (opts.onPermissionRequest) {
      const handler = opts.onPermissionRequest;
      this.permissionHandler = async (req: AcpPermissionRequest) => {
        const decision = await handler({
          kind: 'tool',
          toolName: req.tool ?? 'unknown',
          description: req.description ?? '',
          sessionId: session.id,
        });
        return decision.behavior === 'allow' ? 'allow' : 'reject';
      };
    }

    // 中止接线
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      // ACP 无显式 abort RPC；kill 当前 prompt 靠进程信号或等超时
      // 实际实现：发 session/cancel 通知（若 agent 支持）
      this.transport.notify('session/cancel', { sessionId: session.id });
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      // 构建 ACP prompt 参数
      const prompt = message
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => ({ type: 'text' as const, text: b.text }));

      const config: Array<{ category: string; value: string }> = [];
      if (opts.model) config.push({ category: 'model', value: opts.model });
      if (opts.thinkingLevel) config.push({ category: 'thought_level', value: opts.thinkingLevel });

      const result = await this.transport.call<AcpPromptResult>('session/prompt', {
        sessionId: session.id,
        prompt,
        ...(config.length > 0 ? { config } : {}),
      });

      return {
        sessionId: session.id,
        usage: result.usage
          ? { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 }
          : undefined,
      };
    } finally {
      this.activeEmit = null;
      this.permissionHandler = null;
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      void aborted; // 中止状态已由工厂通过 signal.aborted 判定
    }
  }

  async forkNative(sessionId: string): Promise<string> {
    const result = await this.transport.call<AcpForkResult>('session/fork', {
      sessionId,
      cwd: this.opts.cwd,
      mcpServers: [],
    });
    return result.sessionId;
  }

  // ── 内部 ──

  private onNotification(msg: JsonRpcNotification): void {
    if (msg.method !== 'session/update' || !this.activeEmit) return;
    const params = msg.params as AcpSessionUpdate | undefined;
    if (!params) return;
    const event = mapAcpUpdate(params);
    // mapAcpUpdate 永不返回 done（done 由工厂合成），故可安全作 DriverEvent
    if (event) this.activeEmit(event as Parameters<DriverEmit>[0]);
  }

  private async onReverseRequest(msg: JsonRpcServerRequest): Promise<unknown> {
    switch (msg.method) {
      case 'session/request_permission': {
        if (this.permissionHandler) {
          const optionId = await this.permissionHandler(msg.params as AcpPermissionRequest);
          return { outcome: { outcome: 'selected', optionId } };
        }
        return { outcome: { outcome: 'selected', optionId: 'reject' } };
      }
      case 'fs/read_text_file': {
        const { readFile } = await import('node:fs/promises');
        const path = (msg.params as { path?: string })?.path;
        if (!path) throw new Error('fs/read_text_file: missing path');
        return { content: await readFile(path, 'utf8') };
      }
      case 'fs/write_text_file': {
        const { writeFile } = await import('node:fs/promises');
        const p = msg.params as { path?: string; content?: string };
        if (!p.path) throw new Error('fs/write_text_file: missing path');
        await writeFile(p.path, p.content ?? '', 'utf8');
        return {};
      }
      default:
        throw new Error(`ACP reverse call not implemented: ${msg.method}`);
    }
  }
}

// ── 工厂 ──

export function createAcpSource(options: AcpSourceOptions): SourceDriver {
  return new AcpDriver(options);
}
