/**
 * QoderDriver — 基于 @qoder-ai/qoder-agent-sdk 的源 driver（会话与流式主体）
 *
 * 只含 SDK 特定原子操作；事件泵/握手/守卫/ts 注入由 defineSource 工厂提供。
 * 声明 → ./capabilities.ts；模型目录 → ./models.ts；消息映射 → ./map-message.ts；
 * MCP 工具桥 → ./mcp-tools.ts；prompt 入参 → ./prompt-input.ts
 *
 * Qoder 特性：无状态 per-prompt（每轮 query() 起新进程，resume 从磁盘恢复）；
 * 新会话的真实 ID 在流中才产生 → 经 DriverPromptOutcome.sessionId 回填，工厂重锚句柄表。
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  ISource,
  AuthStatus,
  ModelInfo,
  ContentBlock,
  PromptOpts,
  SourceResourceInfo,
  SourceResourceQuery,
} from '@qcqx/lattice-agent-protocol';
import { CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';
import type { PermissionMode, McpServerConfig } from '@qoder-ai/qoder-agent-sdk';
import type {
  SourceDriver,
  DriverSessionHandle,
  DriverEmit,
  DriverPromptOutcome,
  DriverProbeReport,
} from '../../driver.js';
import { defineSource } from '../../define-source.js';
import { mapQoderMessage } from './map-message.js';
import { buildMcpServers } from './mcp-tools.js';
import { scanCommandDir, scanFlatMdDir, scanSkillDir } from '../resource-scan.js';
import { QODER_INFO, QODER_CAPABILITIES, QODER_AUTH_REQUIREMENTS } from './capabilities.js';
import { ModelCatalog } from './models.js';
import { makeQoderPrompt } from './prompt-input.js';
import { isRecord, stringField } from '../../internal/shape.js';

/**
 * SDK 惰性加载（optionalDependencies：未安装时不致模块顶层崩溃）
 * 参照 pi/index.ts 的 loadSdk() 模式：在 driver 方法内部按需动态 import。
 */
function loadSdk() {
  return import('@qoder-ai/qoder-agent-sdk');
}

export interface QoderSourceOptions {
  authMode?: 'env' | 'cli';
  permissionMode?: PermissionMode;
}

interface QoderHandle extends DriverSessionHandle {
  /** 真实源会话 ID（新会话首轮流中捕获后回填；resume 时即入参） */
  resumeId: string | null;
  /** 当前在途 prompt 的中断器（per-prompt 生命周期） */
  current: AbortController | null;
}

class QoderDriver implements SourceDriver<QoderHandle> {
  readonly contractVersion = CONTRACT_VERSION;
  readonly info = QODER_INFO;
  readonly capabilities = QODER_CAPABILITIES;
  readonly authRequirements = QODER_AUTH_REQUIREMENTS;

  private readonly options: Required<Pick<QoderSourceOptions, 'authMode' | 'permissionMode'>>;
  private readonly catalog: ModelCatalog;

  constructor(options?: QoderSourceOptions) {
    this.options = { authMode: 'cli', permissionMode: 'acceptEdits', ...options };
    this.catalog = new ModelCatalog(this.options.authMode);
  }

  async init(): Promise<void> {
    // 后台预热动态模型目录（首次 get_models 需起 CLI 握手，数秒级），不阻塞启动
    this.catalog.refresh();
  }

  async probe(): Promise<DriverProbeReport> {
    // SDK 可加载性是硬前提：失败裸抛原生 Error，由工厂落 available:false + 原因（永不静默降级）
    await loadSdk();
    // CLI 版本仅展示用途：缺 CLI 不致不可用（env PAT 模式无需 CLI，可用性由 checkAuth 判定）
    try {
      const { execFileSync } = await import('node:child_process');
      const out = execFileSync('qodercli', ['--version'], { stdio: 'pipe' }).toString().trim();
      return { sdkVersion: out || undefined };
    } catch {
      return {};
    }
  }

  async checkAuth(): Promise<AuthStatus> {
    if (process.env.QODER_PERSONAL_ACCESS_TOKEN)
      return { status: 'configured', detail: 'PAT in env' };
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync('qodercli', ['--version'], { stdio: 'pipe' });
      return { status: 'configured', detail: 'qodercli available' };
    } catch {
      return {
        status: 'missing',
        message: '请设置 QODER_PERSONAL_ACCESS_TOKEN 或运行 qodercli login',
      };
    }
  }

  /** SWR 目录：永不阻塞（详见 models.ts ModelCatalog） */
  async listModels(): Promise<ModelInfo[]> {
    return this.catalog.list();
  }

  // ── 资源发现（工厂做 TTL 缓存与 kinds 过滤，这里只管枚举） ──

  /**
   * 扫描 Qoder 产品约定目录（~/.qoder + <cwd>/.qoder）。
   * SDK 无枚举 API，目录约定属于适配对象的一部分（源层私有知识）。
   */
  async scanResources(query_?: SourceResourceQuery): Promise<SourceResourceInfo[]> {
    const cwd = resolve(query_?.cwd ?? homedir());
    const roots: Array<{ dir: string; scope: 'user' | 'project' }> = [
      { dir: join(homedir(), '.qoder'), scope: 'user' },
    ];
    if (cwd !== resolve(homedir())) roots.push({ dir: join(cwd, '.qoder'), scope: 'project' });

    const resources: SourceResourceInfo[] = [];
    for (const { dir, scope } of roots) {
      resources.push(
        ...scanCommandDir(join(dir, 'commands'), scope),
        ...scanFlatMdDir(join(dir, 'agents'), 'agent', scope),
        ...scanSkillDir(join(dir, 'skills'), scope),
        ...scanFlatMdDir(join(dir, 'rules'), 'rule', scope),
      );
    }
    return resources;
  }

  // ── 会话 ──

  async connect(sessionId: string | null, _opts: PromptOpts): Promise<QoderHandle> {
    // 无状态 per-prompt：connect 不起进程，只建句柄（真实新会话 ID 在首轮流中产生）
    const handle: QoderHandle = {
      id: sessionId ?? `qoder-pending-${Date.now().toString(36)}`,
      resumeId: sessionId,
      current: null,
      abort: () => handle.current?.abort(),
      // dispose 时中止在途 prompt（对齐旧 dispose 行为；SDK 磁盘持久化不受影响）
      close: () => handle.current?.abort(),
    };
    return handle;
  }

  /** 组装 query options（模型/权限/工具/systemPrompt 定制） */
  private async buildQueryOptions(
    opts: PromptOpts,
    controller: AbortController,
  ): Promise<Record<string, unknown>> {
    const { accessTokenFromEnv, qodercliAuth } = await loadSdk();
    const auth = this.options.authMode === 'env' ? accessTokenFromEnv() : qodercliAuth();
    // 宿主工具 = 会话参数（经 MCP 桥），非源级状态
    const sessionTools = opts.tools?.tools ?? [];
    const mcpServers = await buildMcpServers(sessionTools);

    return {
      auth,
      cwd: opts.cwd || process.env.HOME || '/',
      model: opts.model || 'auto',
      permissionMode: opts.permissionMode ?? this.options.permissionMode,
      allowedTools: [
        ...this.capabilities.tools.builtin.map((t) => t.name),
        ...sessionTools.map((t) => t.name),
      ],
      includePartialMessages: true,
      abortController: controller,
      // 模型可调参数（tuning 规格约束取值）：SDK 支持时生效，不支持则忽略
      ...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
      ...(opts.contextWindow ? { contextWindow: opts.contextWindow } : {}),
      ...(mcpServers ? { mcpServers: mcpServers as Record<string, McpServerConfig> } : {}),
      // systemPrompt 定制：override=全量替换；append=保留 qodercli 预设 + 追加（skills 清单等走这里）
      ...(opts.systemPrompt?.mode === 'override' ? { systemPrompt: opts.systemPrompt.prompt } : {}),
      ...(opts.systemPrompt?.mode === 'append'
        ? {
            systemPrompt: {
              type: 'preset',
              preset: 'qodercli',
              append: opts.systemPrompt.additional,
            },
          }
        : {}),
    };
  }

  async prompt(
    handle: QoderHandle,
    message: ContentBlock[],
    opts: PromptOpts,
    emit: DriverEmit,
  ): Promise<DriverPromptOutcome> {
    const controller = new AbortController();
    handle.current = controller;
    const src = { id: this.info.id, name: this.info.displayName };
    const makePrompt = makeQoderPrompt(message);

    try {
      const { query } = await loadSdk();
      const queryOptions = await this.buildQueryOptions(opts, controller);
      // 有真实会话 ID → 直接 resume（SDK 从磁盘 JSONL 恢复）
      if (handle.resumeId) queryOptions.resume = handle.resumeId;

      let captured = handle.resumeId ?? '';
      const runStream = async (options: Record<string, unknown>): Promise<void> => {
        const q = query({ prompt: makePrompt() as never, options });
        for await (const msg of q) {
          if (!isRecord(msg)) continue; // SDK 异常载荷（非对象）跳过，不让它污染映射
          captured = stringField(msg, 'session_id') ?? captured;
          for (const event of mapQoderMessage(msg, src)) emit(event);
          if (msg.type === 'result') break;
        }
      };

      try {
        await runStream(queryOptions);
      } catch (innerErr) {
        // resume 失败 → 降级为新建：必须 emit notice（永不静默降级——
        // 新 session 不含历史上下文，静默会让用户误以为 AI 记得前文）
        if (handle.resumeId && String(innerErr).includes('42')) {
          emit({
            type: 'notice',
            level: 'warning',
            message: '会话恢复失败，已新建会话继续（历史上下文丢失）',
          });
          delete queryOptions.resume;
          captured = '';
          await runStream(queryOptions);
        } else {
          throw innerErr;
        }
      }

      handle.resumeId = captured || handle.resumeId;
      return {
        sessionId: captured || undefined,
        sourceMessageId: await this.lastAssistantUuid(captured),
      };
    } catch (err) {
      // 中止是正常结局（driver 铁律）：吞 SDK 中止异常，返回已捕获的会话信息
      if (controller.signal.aborted) {
        return { sessionId: handle.resumeId ?? undefined };
      }
      throw err;
    } finally {
      handle.current = null;
    }
  }

  /** 最后一条 assistant 消息 UUID（fork 锚点，非关键路径：失败返 undefined） */
  private async lastAssistantUuid(sessionId: string): Promise<string | undefined> {
    if (!sessionId) return undefined;
    try {
      const { getSessionMessages } = await loadSdk();
      const msgs = await getSessionMessages(sessionId);
      return [...msgs].reverse().find((m) => m.type === 'assistant')?.uuid;
    } catch {
      return undefined;
    }
  }

  // ── fork / rename（能力守卫在工厂，进入此处即合法） ──

  async forkNative(sessionId: string, atMessage?: string): Promise<string> {
    const { forkSession } = await loadSdk();
    const result = await forkSession(sessionId, { upToMessageId: atMessage });
    return result.sessionId;
  }

  async renameNative(sessionId: string, title: string): Promise<void> {
    const { renameSession } = await loadSdk();
    await renameSession(sessionId, title);
  }

  // destroyNative 不需要：SDK 自管磁盘持久化，句柄 close 无额外清理
}

/** 裸 driver 工厂（契约套件/进阶定制用；常规消费走 createQoderSource） */
export function createQoderDriver(options?: QoderSourceOptions): SourceDriver<QoderHandle> {
  return new QoderDriver(options);
}

/** 创建 Qoder 源（driver → defineSource 工厂包装） */
export function createQoderSource(options?: QoderSourceOptions): ISource {
  return defineSource(new QoderDriver(options));
}

// 声明合并：源 ID 编译期收紧（getSource('qoder') / KnownSourceId）
declare module '@qcqx/lattice-agent-protocol' {
  interface LatticeSourceMap {
    qoder: ISource;
  }
}
