/**
 * SourceMiddleware — 中间件契约（内部 proxy 形态，对齐 ACP Extensions-via-Proxies 语义）
 *
 * 两个拦截点：prompt 入向变换（同形状进出）+ 事件流出向包装（同形状进出）。
 * 管线分相位执行：normalize → expand → inject → guard（同相位按注册序）。
 *
 * 规则：
 * - 事件流包装必须「流透明」：禁无界缓冲，默认透传，处理不了的事件原样放行
 * - middleware 抛错由 runner 类型化包装，不静默吞
 * - 契约在 protocol（零依赖），runner 与通用实现在 @qcqx/lattice-agent-pipeline
 */
import type { ContentBlock } from './messages.js';
import type { PromptOpts } from './interface.js';
import type { SourceEvent } from './events.js';

/** 管线相位（执行顺序即声明顺序） */
export const MIDDLEWARE_PHASES = ['normalize', 'expand', 'inject', 'guard'] as const;
export type MiddlewarePhase = (typeof MIDDLEWARE_PHASES)[number];

/** prompt 入向载荷（middleware 间流转的完整输入） */
export interface PromptPayload {
  sessionId: string | null;
  message: ContentBlock[];
  opts: PromptOpts;
}

/** middleware 可见的只读上下文（由 runner 提供，禁止 middleware 反向持有可变引用） */
export interface MiddlewareContext {
  /** 目标源 ID */
  sourceId: string;
  /** 工作目录（宿主会话语境） */
  cwd?: string;
}

export interface SourceMiddleware {
  /** 唯一名称（诊断/去重/日志） */
  readonly name: string;
  readonly phase: MiddlewarePhase;
  /** prompt 入向变换：返回新 payload（不可原地修改入参） */
  transformPrompt?(payload: PromptPayload, ctx: MiddlewareContext): Promise<PromptPayload>;
  /** 事件流出向逐事件变换：返回替换事件（数组支持一变多/滤除用空数组）；
   *  流透明约束——不得跨事件缓冲聚合 */
  transformEvent?(event: SourceEvent, ctx: MiddlewareContext): SourceEvent[];
}
