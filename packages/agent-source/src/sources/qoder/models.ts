/**
 * Qoder 模型目录：静态兜底 + SDK 动态获取 + SWR 缓存
 *
 * 分层：mapSdkModel（纯函数，映射口径单一真相）→ fetchModelsFromSdk（I/O）
 *      → ModelCatalog（SWR 缓存策略）。纯函数与策略分离便于单测。
 */
import type { ModelInfo } from '@qcqx/lattice-agent-protocol';
import { query, qodercliAuth, accessTokenFromEnv } from '@qoder-ai/qoder-agent-sdk';

/** 动态模型目录缓存 TTL（每次获取需起 CLI 控制通道，成本高） */
export const MODEL_CACHE_TTL_MS = 60_000;
/** get_models 控制请求整体超时（含 CLI 启动握手） */
const MODEL_FETCH_TIMEOUT_MS = 8_000;

/** 思考深度按强度排序（server 返回 Record 键序不稳定）；未知等级排末尾 */
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

export function sortEfforts(efforts: string[]): string[] {
  return [...efforts].sort((a, b) => {
    const ia = EFFORT_ORDER.indexOf(a);
    const ib = EFFORT_ORDER.indexOf(b);
    return (ia === -1 ? EFFORT_ORDER.length : ia) - (ib === -1 ? EFFORT_ORDER.length : ib);
  });
}

/** 积分倍率展示文本（1 → '1.0x'，0.49998 → '0.5x'，2.56 → '2.56x'） */
export function factorLabel(factor: number | undefined): string | undefined {
  if (factor === undefined || factor === null) return undefined;
  const f = parseFloat(factor.toFixed(2));
  return `${Number.isInteger(f) ? f.toFixed(1) : f}x`;
}

const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * 静态兜底模型目录：SDK 动态获取失败（未登录/CLI 不可用/超时）时使用。
 *
 * 取值为动态目录实测快照（2026-07-29，qodercli 1.1.1），映射口径与
 * mapSdkModel 一致，以保证兜底与主路径行为一致。
 * 仅收录 source=system 且非 isNew 的五个稳定型号；其余十余个第三方型号
 *（Qwen/Kimi/GLM/DeepSeek/MiniMax 等）变动频繁，不入兜底。
 *
 * auto/efficient/lite 无 tuning：三者 server 未下发 context_config/thinking_config
 * （serverModel 也无 is_editable），Qoder 官方 UI 同样不展示编辑按钮。
 */
export const FALLBACK_MODELS: ModelInfo[] = [
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

/** SDK 模型条目的最小结构（仅本模块用到的字段） */
export interface SdkModelLike {
  value: string;
  displayName: string;
  isEnabled?: boolean;
  isNew?: boolean;
  isVl?: boolean;
  isReasoning?: boolean;
  priceFactor?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  availableContextWindows?: number[];
  defaultContextWindow?: number;
  efforts?: string[];
  defaultEffort?: string;
  supportsDisabled?: boolean;
  context_config?: unknown;
}

/**
 * SDK 模型 → ModelInfo（映射口径单一真相，兜底表按此口径生成）。
 *
 * tuning 判据（关键，勿改回候选值个数）：
 * 以 server 下发的 context_config 作门——它带档位标签与 is_default，是「用户可选哪几档」
 * 的权威声明（其 token_count 集合恰等于可调模型的 availableContextWindows）。
 * availableContextWindows 只表「技术上能跑多大窗口」：无 context_config 的模型
 *（auto/efficient/lite）CLI 仍会填 [128000,180000]，单靠候选值个数会误开编辑入口。
 * 实测：传任意 contextWindow（含越界值）服务端均不报错、也不回显生效值，
 * 故误开入口会导致静默失败 + 与 Qoder 官方 UI 不一致 + 无效值落盘被 retry 重放。
 */
export function mapSdkModel(m: SdkModelLike): ModelInfo {
  const ctxOptions = m.availableContextWindows ?? [];
  const efforts = m.efforts ?? [];
  const tuning: NonNullable<ModelInfo['tuning']> = {
    ...(m.context_config !== undefined && m.context_config !== null && ctxOptions.length > 1
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
}

/**
 * 通过 SDK 控制通道获取实时模型目录（query.getAvailableModels → CLI get_models）。
 * streaming-input 模式不产出任何用户消息，仅建控制通道，取完即 close。
 */
export async function fetchModelsFromSdk(authMode: 'env' | 'cli'): Promise<ModelInfo[]> {
  const auth = authMode === 'env' ? accessTokenFromEnv() : qodercliAuth();

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

  const q = query({ prompt: emptyInput(), options: { auth, cwd: process.env.HOME || '/' } });
  try {
    const sdkModels = await Promise.race([
      q.getAvailableModels({ fetchStrategy: 'cache' }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('get_models timeout')), MODEL_FETCH_TIMEOUT_MS),
      ),
    ]);
    return sdkModels
      .filter((m) => m.isEnabled !== false)
      .map((m) => mapSdkModel(m as SdkModelLike));
  } finally {
    releaseInput();
    await q.close().catch(() => {});
  }
}

/**
 * 模型目录缓存（stale-while-revalidate）：永不阻塞——
 * 缓存新鲜直接用；过期/缺失则后台单飞刷新，本次立即返回旧缓存或静态兜底。
 */
export class ModelCatalog {
  private cache: { at: number; models: ModelInfo[] } | null = null;
  private inFlight = false;

  constructor(
    private readonly authMode: 'env' | 'cli',
    private readonly fetcher: (
      authMode: 'env' | 'cli',
    ) => Promise<ModelInfo[]> = fetchModelsFromSdk,
    private readonly now: () => number = Date.now,
  ) {}

  list(): ModelInfo[] {
    if (this.cache && this.now() - this.cache.at < MODEL_CACHE_TTL_MS) {
      return this.cache.models;
    }
    this.refresh();
    return this.cache?.models ?? FALLBACK_MODELS;
  }

  /** 后台刷新（单飞：已有在途请求则跳过） */
  refresh(): void {
    if (this.inFlight) return;
    this.inFlight = true;
    void this.fetcher(this.authMode)
      .then((models) => {
        if (models.length > 0) this.cache = { at: this.now(), models };
      })
      .catch(() => {
        /* 未登录/CLI 不可用/超时 → 继续用静态兜底 */
      })
      .finally(() => {
        this.inFlight = false;
      });
  }
}
