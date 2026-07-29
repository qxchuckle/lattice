/**
 * 管线 runner：middleware 编排 + prompt 执行
 *
 * 两个拦截点、两种方向：
 * - prompt 入向：按相位正序 normalize → expand → inject → guard（同相位按注册序）
 * - 事件出向：按相位**逆序**包装（洋葱语义——先加工的最后收尾）
 *
 * 不变式（测试锁定）：
 * - 流透明：逐事件变换，无跨事件缓冲；无 transformEvent 时零包装开销（直接返回源流）
 * - 终止事件不可被吞：done 经变换后必须仍恰有一个 done，否则 result() 永挂 → 判 middleware_failure
 * - middleware 抛错一律包装为 PipelineError('middleware_failure')，不静默吞
 */
import type {
  ISource,
  SourceEvent,
  SourceMiddleware,
  MiddlewareContext,
  MiddlewarePhase,
  PromptPayload,
} from '@qcqx/lattice-agent-protocol';
import { MIDDLEWARE_PHASES, SourceEventStream } from '@qcqx/lattice-agent-protocol';
import { PipelineError } from './errors.js';

/** 按相位排序（稳定：同相位保持注册序） */
export function sortMiddlewares(middlewares: readonly SourceMiddleware[]): SourceMiddleware[] {
  const rank = (phase: MiddlewarePhase): number => MIDDLEWARE_PHASES.indexOf(phase);
  return [...middlewares]
    .map((mw, index) => ({ mw, index }))
    .sort((a, b) => rank(a.mw.phase) - rank(b.mw.phase) || a.index - b.index)
    .map((x) => x.mw);
}

/** prompt 入向：依次变换 payload（middleware 不得原地改入参，返回新对象） */
export async function applyPromptMiddlewares(
  middlewares: readonly SourceMiddleware[],
  payload: PromptPayload,
  ctx: MiddlewareContext,
): Promise<PromptPayload> {
  let current = payload;
  for (const mw of sortMiddlewares(middlewares)) {
    if (!mw.transformPrompt) continue;
    try {
      current = await mw.transformPrompt(current, ctx);
    } catch (err) {
      if (err instanceof PipelineError) throw err; // guard 相位的合法拒绝，原样上抛
      throw PipelineError.middlewareFailed(mw.name, err);
    }
  }
  return current;
}

/**
 * 事件流包装：逐事件透传变换结果。
 * 无 transformEvent middleware 时直接返回原流（零开销，也保住单消费者语义）。
 */
export function wrapEventStream(
  raw: SourceEventStream,
  middlewares: readonly SourceMiddleware[],
  ctx: MiddlewareContext,
): SourceEventStream {
  const chain = sortMiddlewares(middlewares)
    .filter((mw) => mw.transformEvent)
    .reverse(); // 出向逆序（洋葱）
  if (chain.length === 0) return raw;

  const out = new SourceEventStream();
  void (async () => {
    try {
      for await (const event of raw) {
        const produced = applyChain(chain, event, ctx);
        if (event.type === 'done' && produced.filter((e) => e.type === 'done').length !== 1) {
          throw new PipelineError(
            'middleware_failure',
            'middleware 吞掉或复制了 done 事件（终止事件不可增删）',
            { sourceId: ctx.sourceId },
          );
        }
        for (const e of produced) out.push(e);
      }
      // 源流以 fail 结束时在此 reject，向下游传播（result() 语义一致）
      await raw.result();
    } catch (err) {
      out.fail(err);
    }
  })();
  return out;
}

/** 事件出向：单事件经链变换（一变多用数组，滤除用空数组） */
function applyChain(
  chain: readonly SourceMiddleware[],
  event: SourceEvent,
  ctx: MiddlewareContext,
): SourceEvent[] {
  let batch: SourceEvent[] = [event];
  for (const mw of chain) {
    const next: SourceEvent[] = [];
    for (const e of batch) {
      try {
        next.push(...mw.transformEvent!(e, ctx));
      } catch (err) {
        throw PipelineError.middlewareFailed(mw.name, err);
      }
    }
    batch = next;
  }
  return batch;
}

export interface RunPromptArgs {
  source: ISource;
  payload: PromptPayload;
  middlewares?: readonly SourceMiddleware[];
  /** 缺省由 source.id 与 payload.opts.cwd 推导 */
  ctx?: Partial<MiddlewareContext>;
}

/**
 * 执行一轮 prompt：入向变换 → source.prompt → 出向包装。
 *
 * 入向失败（middleware 抛错 / guard 拒绝）不会得到流——直接 reject，
 * 宿主据 PipelineError.code 决定呈现方式（与「绕过 UI 直请接口」同一拒绝路径）。
 */
export async function runPrompt(args: RunPromptArgs): Promise<SourceEventStream> {
  const middlewares = args.middlewares ?? [];
  const ctx: MiddlewareContext = {
    sourceId: args.ctx?.sourceId ?? args.source.id,
    cwd: args.ctx?.cwd ?? args.payload.opts.cwd,
  };
  const payload = await applyPromptMiddlewares(middlewares, args.payload, ctx);
  const raw = args.source.prompt(payload.sessionId, payload.message, payload.opts);
  return wrapEventStream(raw, middlewares, ctx);
}
