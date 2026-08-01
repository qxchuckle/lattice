/**
 * EventStream — 流式系统基石（借 pi-ai 设计：同时是 AsyncIterable 与 Promise-like）
 *
 * 生产者 push()，消费者 for-await 或 .result()（或两者混用）。
 * 终止事件由 isComplete 判定，result() 一直等到终止事件（或 fail()）。
 * 单消费者约定：同一时刻只应有一个 for-await 消费者（多消费者不分发、不广播）。
 *
 * 零依赖纯工具，protocol 层「共享纯逻辑」定位（对齐 content-builder/node-state 先例）。
 */
import type { SourceEvent, TokenUsage } from './events.js';

/** 背压监控指标快照（只读视图，反映 push 时的队列状态） */
export interface EventStreamMetrics {
  /** 当前队列长度（未消费事件数） */
  readonly queueSize: number;
  /** 队列长度历史峰值（消费后不重置） */
  readonly maxQueueSize: number;
  /** 是否触发过背压告警（queue 超 BACKPRESSURE_THRESHOLD 后 sticky true） */
  readonly isBackpressured: boolean;
}

export class EventStream<T, R = T> implements AsyncIterable<T> {
  /** 队列上界：push 时 queue 长度超过此值即标记背压告警 */
  static readonly BACKPRESSURE_THRESHOLD = 1000;

  private queue: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private done = false;
  private resolveResult!: (value: R) => void;
  private rejectResult!: (err: unknown) => void;
  private readonly resultPromise: Promise<R>;
  private _maxQueueSize = 0;
  private _isBackpressured = false;

  /** 背压监控指标（只读快照） */
  get metrics(): EventStreamMetrics {
    return {
      queueSize: this.queue.length,
      maxQueueSize: this._maxQueueSize,
      isBackpressured: this._isBackpressured,
    };
  }

  constructor(
    private readonly isComplete: (event: T) => boolean,
    private readonly extractResult: (event: T) => R,
  ) {
    this.resultPromise = new Promise<R>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // result() 未被消费时不产生 unhandled rejection
    this.resultPromise.catch(() => {});
  }

  /** 生产者推入事件；终止事件会同时敲定 result() */
  push(event: T): void {
    if (this.done) return;
    if (this.isComplete(event)) {
      this.done = true;
      this.resolveResult(this.extractResult(event));
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
      // 背压监控：记录峰值 + 超阈值标记告警（sticky）
      if (this.queue.length > this._maxQueueSize) this._maxQueueSize = this.queue.length;
      if (this.queue.length > EventStream.BACKPRESSURE_THRESHOLD) this._isBackpressured = true;
    }
    if (this.done) this.flushWaiters();
  }

  /** 生产者异常终止：迭代结束 + result() reject */
  fail(err: unknown): void {
    if (this.done) return;
    this.done = true;
    this.rejectResult(err);
    this.flushWaiters();
  }

  private flushWaiters(): void {
    for (const w of this.waiters.splice(0)) {
      w({ value: undefined as never, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
        if (result.done) return;
        yield result.value;
      }
    }
  }

  /** 最终结果：终止事件的载荷；fail() 时 reject */
  result(): Promise<R> {
    return this.resultPromise;
  }
}

// ── Source 专用形态 ──

/** prompt 一轮的最终载荷（done 事件形态化，上层不再扫流找 done） */
export interface PromptResult {
  /** 本轮源会话 ID（新建会话时为新 ID） */
  sessionId: string;
  usage?: TokenUsage;
  /** 最后一条消息在源 session 中的 ID（fork 锚点） */
  sourceMessageId?: string;
  /** 源生成的轮次摘要（有则透传） */
  summary?: string;
}

/**
 * 源事件流：AsyncIterable<SourceEvent> + result(): Promise<PromptResult>。
 * done 事件敲定 result；error 事件仍作为普通事件产出（呈现层需要），
 * 是否 reject 由生产方（defineSource 工厂）在流终止时统一裁决。
 *
 * 工厂保证（契约套件验证项）：done 事件必携 sessionId（工厂持有句柄，映射前注入），
 * 故 PromptResult.sessionId 恒非空；'' 回退仅防御性，出现即 driver bug。
 */
export class SourceEventStream extends EventStream<SourceEvent, PromptResult> {
  constructor() {
    super(
      (e) => e.type === 'done',
      (e) => {
        if (e.type !== 'done') throw new Error('unreachable: non-done terminal event');
        return {
          sessionId: e.sessionId ?? '',
          usage: e.usage,
          sourceMessageId: e.sourceMessageId,
          summary: e.summary,
        };
      },
    );
  }
}
