/**
 * 管线 runner：middleware 编排 + prompt 执行
 *
 * 两个拦截点、两种方向（均以 RxJS operator 表达，不手写事件泵）：
 * - prompt 入向：按相位正序 normalize → expand → inject → guard（同相位按注册序）
 * - 事件出向：`from(raw).pipe(concatMap(applyChain))`，按相位**逆序**包装（洋葱语义）
 *
 * runPrompt 返回 `Observable<SourceEvent>`（事件主干全程 Observable：源 AsyncIterable → from 桥接 → operator 变换 → 宿主）。
 *
 * 不变式（测试锁定）：
 * - 流透明：逐事件变换，无跨事件缓冲；无 transformEvent 时直接 from(raw)（零包装）
 * - 终止事件不可被吞：done 变换后必须仍恰有一个 done，否则 middleware_failure
 * - middleware 抛错一律包为 PipelineError('middleware_failure') → Observable error，不静默吞
 * - 源错误走 error **事件**通道（defineSource 工厂保证 fail 前先 push error 事件），from(raw) 自然 complete
 */
import type {
  ISource,
  SourceEvent,
  SourceMiddleware,
  MiddlewareContext,
  MiddlewarePhase,
  PromptPayload,
  SourceEventStream,
} from '@qcqx/lattice-agent-protocol';
import { MIDDLEWARE_PHASES } from '@qcqx/lattice-agent-protocol';
import { Observable, defer, from, of, concatMap } from 'rxjs';
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
 * 事件变换链：把「可选的 transformEvent」在构建期收成「必存的函数」，
 * 使后续调用无需非空断言（类型保证而非程序员保证）。
 */
interface EventTransformer {
  readonly name: string;
  readonly transform: NonNullable<SourceMiddleware['transformEvent']>;
}

function eventChainOf(middlewares: readonly SourceMiddleware[]): EventTransformer[] {
  const chain: EventTransformer[] = [];
  for (const mw of sortMiddlewares(middlewares)) {
    if (mw.transformEvent) chain.push({ name: mw.name, transform: mw.transformEvent.bind(mw) });
  }
  return chain.reverse(); // 出向逆序（洋葱）
}

/**
 * 事件出向变换：from(raw) 桥接 AsyncIterable，concatMap 逐事件过链。
 * 无 transformEvent middleware 时直接 from(raw)（零变换）。
 */
export function transformEvents(
  raw: SourceEventStream,
  middlewares: readonly SourceMiddleware[],
  ctx: MiddlewareContext,
): Observable<SourceEvent> {
  const chain = eventChainOf(middlewares);
  if (chain.length === 0) return from(raw);
  return from(raw).pipe(
    concatMap((event) => {
      // applyChain 抛 PipelineError('middleware_failure') → concatMap 使 Observable error
      const produced = applyChain(chain, event, ctx);
      if (event.type === 'done' && produced.filter((e) => e.type === 'done').length !== 1) {
        throw new PipelineError(
          'middleware_failure',
          'middleware 吞掉或复制了 done 事件（终止事件不可增删）',
          { sourceId: ctx.sourceId },
        );
      }
      // 一变多：按序发出；空数组 = 滤除（of() 不发值直接 complete）
      return of(...produced);
    }),
  );
}

/** 事件出向：单事件经链变换（一变多用数组，滤除用空数组） */
function applyChain(
  chain: readonly EventTransformer[],
  event: SourceEvent,
  ctx: MiddlewareContext,
): SourceEvent[] {
  let batch: SourceEvent[] = [event];
  for (const { name, transform } of chain) {
    const next: SourceEvent[] = [];
    for (const e of batch) {
      try {
        next.push(...transform(e, ctx));
      } catch (err) {
        throw PipelineError.middlewareFailed(name, err);
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
  /** sourceId 缺省取 source.id、cwd 缺省取 payload.opts.cwd；threadId/metadata 由宿主给 */
  ctx?: Partial<MiddlewareContext>;
}

/**
 * 执行一轮 prompt：入向变换 → source.prompt → 出向 operator 变换，返回 `Observable<SourceEvent>`。
 *
 * defer：订阅时才跑入向 middleware（副作用不早发）。
 * 入向失败（middleware 抛错 / guard 拒绝）→ Observable error，且不调源（concatMap 未进入）；
 * 宿主据 PipelineError.code 决定呈现（与「绕过 UI 直请接口」同一拒绝路径）。
 */
export function runPrompt(args: RunPromptArgs): Observable<SourceEvent> {
  const middlewares = args.middlewares ?? [];
  const ctx: MiddlewareContext = {
    ...args.ctx,
    sourceId: args.ctx?.sourceId ?? args.source.id,
    cwd: args.ctx?.cwd ?? args.payload.opts.cwd,
  };
  return defer(() => from(applyPromptMiddlewares(middlewares, args.payload, ctx))).pipe(
    concatMap((payload) =>
      transformEvents(
        args.source.prompt(payload.sessionId, payload.message, payload.opts),
        middlewares,
        ctx,
      ),
    ),
  );
}
