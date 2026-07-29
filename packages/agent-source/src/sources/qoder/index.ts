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
  SourceResourceInfo,
  SourceResourceQuery,
} from '../../types.js';
import { SourceError } from '../../types.js';
import { mapQoderMessage } from './map-message.js';
import { buildMcpServers } from './mcp-tools.js';
import { scanCommandDir, scanFlatMdDir, scanSkillDir, filterKinds } from '../resource-scan.js';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PermissionMode, McpServerConfig } from '@qoder-ai/qoder-agent-sdk';
import {
  query,
  qodercliAuth,
  accessTokenFromEnv,
  forkSession,
  getSessionMessages,
  renameSession,
} from '@qoder-ai/qoder-agent-sdk';

export interface QoderSourceConfig {
  authMode?: 'env' | 'cli';
  permissionMode?: PermissionMode;
}

/**
 * 静态兜底模型目录：SDK 动态获取失败（未登录/CLI 不可用/超时）时使用。
 * 动态路径见 listModels → fetchModelsFromSdk（get_models 控制请求，与 IDE 同一份目录）。
 *
 * 取值为动态目录实测快照（2026-07-29，qodercli 1.1.1），映射口径与
 * fetchModelsFromSdk 一致，以保证兜底与主路径行为一致。
 * 仅收录 source=system 且非 isNew 的五个稳定型号；其余十余个第三方型号
 *（Qwen/Kimi/GLM/DeepSeek/MiniMax 等）变动频繁，不入兜底。
 *
 * auto/efficient/lite 无 tuning：三者 server 未下发 context_config/thinking_config
 * （serverModel 也无 is_editable），Qoder 官方 UI 同样不展示编辑按钮。
 */
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: 'auto',
    displayName: 'Auto',
    capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: false },
    contextWindow: 180000,
    maxOutputTokens: 32000,
    costFactor: 1.0,
    costLabel: '1.0x',
    // auto 智能路由：参数由路由决策，不开放调节（无 tuning = web 不渲染编辑入口）
  },
  {
    id: 'ultimate',
    displayName: 'Ultimate',
    capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: true },
    contextWindow: 200000,
    maxOutputTokens: 32000,
    costFactor: 1.28,
    costLabel: '1.28x',
    tuning: {
      contextWindow: { options: [200000, 400000, 1000000], default: 200000 },
      thinking: { options: FALLBACK_EFFORTS, default: 'high', toggleable: true },
    },
  },
  {
    id: 'performance',
    displayName: 'Performance',
    capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: false },
    contextWindow: 272000,
    maxOutputTokens: 32000,
    costFactor: 1.1,
    costLabel: '1.1x',
    tuning: {
      contextWindow: { options: [272000, 400000, 1000000], default: 272000 },
      thinking: { options: FALLBACK_EFFORTS, default: 'medium', toggleable: true },
    },
  },
  {
    id: 'efficient',
    displayName: 'Efficient',
    capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: false },
    contextWindow: 180000,
    maxOutputTokens: 32000,
    costFactor: 0.3,
    costLabel: '0.3x',
  },
  {
    id: 'lite',
    displayName: 'Lite',
    capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
    contextWindow: 180000,
    maxOutputTokens: 32000,
    costFactor: 0,
    costLabel: '0.0x',
  },
];

/** 动态模型目录缓存 TTL（每次获取需起 CLI 控制通道，成本高） */
const MODEL_CACHE_TTL_MS = 60_000;
/** get_models 控制请求整体超时（含 CLI 启动握手） */
const MODEL_FETCH_TIMEOUT_MS = 8_000;

/** 思考深度按强度排序（server 返回 Record 键序不稳定）；未知等级排末尾 */
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

/** 资源发现缓存 TTL（目录扫描成本低，但菜单频繁开合时免重扫） */
const RESOURCE_CACHE_TTL_MS = 60_000;

/**
 * 构造 query 的 prompt 入参：纯文本走字符串；含图片时走 streaming-input
 *（单条 SDKUserMessage，Anthropic MessageParam content 数组含 image base64 block）。
 * 返回工厂：resume 失败重试需要全新的 AsyncIterable（旧 generator 已被消费）。
 */
function makeQoderPrompt(message: ContentBlock[]): () => string | AsyncIterable<unknown> {
  const images = message.filter(
    (b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image',
  );
  const text = message
    .filter((b) => b.type !== 'image')
    .map((b) => (b.type === 'text' ? b.text : `[${b.type}]`))
    .join('\n');
  if (images.length === 0) return () => text;

  const content = [
    ...(text ? [{ type: 'text', text }] : []),
    ...images.map((b) => ({
      type: 'image',
      source: { type: 'base64', media_type: b.mimeType, data: b.data },
    })),
  ];
  return () =>
    (async function* () {
      yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
    })();
}
function sortEfforts(efforts: string[]): string[] {
  return [...efforts].sort((a, b) => {
    const ia = EFFORT_ORDER.indexOf(a);
    const ib = EFFORT_ORDER.indexOf(b);
    return (ia === -1 ? EFFORT_ORDER.length : ia) - (ib === -1 ? EFFORT_ORDER.length : ib);
  });
}

/** 积分倍率展示文本（1 → '1.0x'，0.49998 → '0.5x'，2.56 → '2.56x'） */
function factorLabel(factor: number | undefined): string | undefined {
  if (factor == null) return undefined;
  const f = parseFloat(factor.toFixed(2));
  return `${Number.isInteger(f) ? f.toFixed(1) : f}x`;
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
    compaction: 'auto', // SDK 默认 auto-compact，流内发 compact_boundary
    // V1 已验证（2026-07-29）：qoder-agent-sdk 不解释 prompt 中的 slash 文本
    //（命令展开是 Qoder IDE 客户端行为，SDK dist 无 slash 处理逻辑）→ 编排层展开
    slashCommands: 'none',
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
  /** 动态模型目录缓存（TTL 内复用，避免频繁起 CLI 控制通道） */
  private modelCache: { at: number; models: ModelInfo[] } | null = null;
  /** 在途刷新去重（stale-while-revalidate 后台任务单飞） */
  private modelFetchInFlight = false;
  /** 资源发现缓存（按 cwd 分 key） */
  private resourceCache = new Map<string, { at: number; resources: SourceResourceInfo[] }>();

  constructor(config?: QoderSourceConfig) {
    this.config = { authMode: 'cli', permissionMode: 'acceptEdits', ...config };
  }

  async init(): Promise<void> {
    this.initialized = true;
    // 后台预热动态模型目录（首次 get_models 需起 CLI 握手，数秒级），不阻塞启动
    this.refreshModelCache();
  }

  async dispose(): Promise<void> {
    for (const c of this.abortControllers.values()) c.abort();
    this.abortControllers.clear();
  }

  async listModels(): Promise<ModelInfo[]> {
    // stale-while-revalidate：永不阻塞——缓存新鲜直接用；过期/缺失则后台刷新，
    // 本次立即返回旧缓存或静态兜底（动态目录就绪后下次请求自然拿到）
    const now = Date.now();
    if (this.modelCache && now - this.modelCache.at < MODEL_CACHE_TTL_MS) {
      return this.modelCache.models;
    }
    this.refreshModelCache();
    return this.modelCache?.models ?? FALLBACK_MODELS;
  }

  /** 后台刷新动态目录（单飞：已有在途请求则跳过） */
  private refreshModelCache(): void {
    if (this.modelFetchInFlight) return;
    this.modelFetchInFlight = true;
    void this.fetchModelsFromSdk()
      .then((models) => {
        if (models.length > 0) this.modelCache = { at: Date.now(), models };
      })
      .catch(() => {
        /* 未登录/CLI 不可用/超时 → 继续用静态兜底 */
      })
      .finally(() => {
        this.modelFetchInFlight = false;
      });
  }

  /**
   * 通过 SDK 控制通道获取实时模型目录（query.getAvailableModels → CLI get_models）。
   * streaming-input 模式不产出任何用户消息，仅建控制通道，取完即 close。
   */
  private async fetchModelsFromSdk(): Promise<ModelInfo[]> {
    const auth = this.config.authMode === 'env' ? accessTokenFromEnv() : qodercliAuth();

    // 挂起的空输入流：不发消息，close 时结束
    let releaseInput!: () => void;
    const gate = new Promise<void>((r) => {
      releaseInput = r;
    });
    async function* emptyInput(): AsyncGenerator<never> {
      await gate;
      // 永不 yield：仅维持 streaming-input 通道直到 close
      yield* [] as never[];
    }

    const q = query({
      prompt: emptyInput(),
      options: { auth, cwd: process.env.HOME || '/' },
    });
    try {
      const sdkModels = await Promise.race([
        q.getAvailableModels({ fetchStrategy: 'cache' }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('get_models timeout')), MODEL_FETCH_TIMEOUT_MS),
        ),
      ]);
      return sdkModels
        .filter((m) => m.isEnabled !== false)
        .map((m): ModelInfo => {
          const ctxOptions = m.availableContextWindows ?? [];
          const efforts = m.efforts ?? [];
          const tuning: NonNullable<ModelInfo['tuning']> = {
            // 以 server 下发的 context_config 作门：它带档位标签与 is_default，是「用户可选哪几档」
            // 的权威声明（其 token_count 集合恰等于可调模型的 availableContextWindows）。
            // availableContextWindows 只表「技术上能跑多大窗口」：无 context_config 的模型
            // （auto/efficient/lite）CLI 仍会填 [128000,180000]，单靠候选值个数会误开编辑入口。
            // 实测：传任意 contextWindow（含越界值）服务端均不报错、也不回显生效值，
            // 故误开入口会导致静默失败 + 与 Qoder 官方 UI 不一致 + 无效值落盘被 retry 重放。
            ...(m.context_config != null && ctxOptions.length > 1
              ? {
                  contextWindow: {
                    options: ctxOptions,
                    default: m.defaultContextWindow ?? ctxOptions[0],
                  },
                }
              : {}),
            // efforts 源于 thinking_config.enabled.efforts，非空已隐含该模型开放思考档位
            ...(efforts.length > 0
              ? {
                  thinking: {
                    options: sortEfforts(efforts),
                    default: m.defaultEffort ?? efforts[0],
                    toggleable: m.supportsDisabled === true,
                  },
                }
              : {}),
          };
          return {
            id: m.value,
            displayName: m.displayName + (m.isNew ? '（新）' : ''),
            capabilities: {
              streaming: true,
              toolCalling: true,
              vision: m.isVl === true,
              reasoning: m.isReasoning === true,
            },
            contextWindow: m.defaultContextWindow ?? m.maxInputTokens ?? 200000,
            maxOutputTokens: m.maxOutputTokens ?? 16384,
            costFactor: m.priceFactor,
            costLabel: factorLabel(m.priceFactor),
            ...(Object.keys(tuning).length > 0 ? { tuning } : {}),
          };
        });
    } finally {
      releaseInput();
      await q.close().catch(() => {});
    }
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
      // 语义声明：壳层按此渲染，不认工具名（agent-package-layering）
      // Task/Agent→subagent 预埋：75c1 将其加进 capabilities.builtinTools（白名单）后
      // 语义自动为 subagent，SubagentCard 自然生效，无需回改本处
      category: (name === 'Bash'
        ? 'terminal'
        : name === 'Grep' || name === 'Glob' || name === 'SearchCodebase'
          ? 'search'
          : name === 'LSP'
            ? 'code-intel'
            : name === 'Read'
              ? 'file-read'
              : name === 'Write' || name === 'Edit'
                ? 'file-write'
                : name === 'Task' || name === 'Agent'
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
   * 扫描 Qoder 产品约定目录（~/.qoder + <cwd>/.qoder）。
   * SDK 无枚举 API，目录约定属于适配对象的一部分（源层私有知识）。
   * 结果按 cwd 分 key 缓存（TTL 沿 modelCache 模式）。
   */
  async listResources(query?: SourceResourceQuery): Promise<SourceResourceInfo[]> {
    const cwd = resolve(query?.cwd ?? homedir());
    const cached = this.resourceCache.get(cwd);
    if (cached && Date.now() - cached.at < RESOURCE_CACHE_TTL_MS) {
      return filterKinds(cached.resources, query?.kinds);
    }

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
    this.resourceCache.set(cwd, { at: Date.now(), resources });
    return filterKinds(resources, query?.kinds);
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

    // 图片能力由模型 capabilities 声明（isVl），UI 层门控；源只负责格式适配
    const makePrompt = makeQoderPrompt(message);
    const src = { id: this.id, name: this.displayName };

    try {
      // SDK 已在顶部静态 import（本模块本就静态依赖 forkSession 等，函数内动态 import 无惰性收益）；
      // 且 vitest 对 async generator 内动态 import 的 mock 拦截不可靠，静态 import 才能被测试 mock
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
        // 模型可调参数（tuning 规格约束取值）：SDK 支持时生效，不支持则忽略
        ...(opts?.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
        ...(opts?.contextWindow ? { contextWindow: opts.contextWindow } : {}),
        ...(mcpServers ? { mcpServers: mcpServers as Record<string, McpServerConfig> } : {}),
        // systemPrompt 定制：override=全量替换；append=保留 qodercli 预设 + 追加（skills 清单等走这里）
        ...(opts?.systemPrompt?.mode === 'override'
          ? { systemPrompt: opts.systemPrompt.prompt }
          : {}),
        ...(opts?.systemPrompt?.mode === 'append'
          ? {
              systemPrompt: {
                type: 'preset',
                preset: 'qodercli',
                append: opts.systemPrompt.additional,
              },
            }
          : {}),
      };

      // 有 sessionId → 直接 resume（SDK 从磁盘 JSONL 恢复）
      if (sessionId) {
        queryOptions.resume = sessionId;
      }

      const q = query({ prompt: makePrompt() as never, options: queryOptions });
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
        // resume 失败 → 降级为新建（发 warning：新 session 不含历史上下文，静默降级会让用户误以为 AI 记得前文）
        if (sessionId && String(innerErr).includes('42')) {
          yield {
            type: 'notice',
            level: 'warning',
            message: '会话恢复失败，已新建会话继续（历史上下文丢失）',
          };
          delete queryOptions.resume;
          capturedSessionId = '';
          const retryQ = query({ prompt: makePrompt() as never, options: queryOptions });
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
