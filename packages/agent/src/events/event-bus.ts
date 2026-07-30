/**
 * Event Bus — 模块间发布/订阅通信
 *
 * 由 RxJS Subject 驱动（不再手写 EventEmitter）：
 * - `emit` → subject.next；`on/once` → filtered subscribe；`waitFor` → firstValueFrom + timeout
 * - 额外暴露 `events$` / `ofType()` Observable 出口：消费者可用 operator（debounceTime/
 *   bufferTime/scan/merge…）组合事件流，而非只能拿回调
 *
 * 保留原回调式 API（on/once/emit/waitFor/removeAll/listenerCount）以免下游改动；
 * 语义与旧手写版一致：handler 抛错被隔离并记录，不影响其他订阅者。
 */
import { Subject, firstValueFrom, filter, take, timeout, throwError, type Observable } from 'rxjs';
import type { Subscription } from 'rxjs';

export interface LatticeAgentEvent {
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

type EventHandler = (event: LatticeAgentEvent) => void;

/** 通配符订阅键（内部用于 removeAll/listenerCount 归组） */
const WILDCARD = '*';

export class EventBus {
  private readonly subject = new Subject<LatticeAgentEvent>();
  /** 订阅登记：type（'*' = 通配）→ 活跃 Subscription 集，供 removeAll/listenerCount 统计与回收 */
  private readonly subs = new Map<string, Set<Subscription>>();

  /** 事件流出口：消费者可 pipe(filter/debounceTime/bufferTime/scan…) 自由组合 */
  get events$(): Observable<LatticeAgentEvent> {
    return this.subject.asObservable();
  }

  /** 某类型事件流（'*' 取全部）；等价 events$ + filter，供组合式消费 */
  ofType(type: string): Observable<LatticeAgentEvent> {
    return type === WILDCARD
      ? this.subject.asObservable()
      : this.subject.pipe(filter((e) => e.type === type));
  }

  /** 订阅指定类型事件，返回取消订阅函数 */
  on(type: string, handler: EventHandler): () => void {
    // handler 错误隔离：一个订阅者抛错不影响其他订阅者，也不终止 Subject
    const sub = this.ofType(type).subscribe((event) => {
      try {
        handler(event);
      } catch (err) {
        const label = type === WILDCARD ? 'wildcard handler' : `handler for "${type}"`;
        console.error(`[EventBus] ${label} error:`, err);
      }
    });
    this.track(type, sub);
    return () => {
      sub.unsubscribe();
      this.subs.get(type)?.delete(sub);
    };
  }

  /** 订阅一次后自动取消 */
  once(type: string, handler: EventHandler): void {
    const sub = this.ofType(type)
      .pipe(take(1))
      .subscribe((event) => {
        this.subs.get(type)?.delete(sub);
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventBus] once handler for "${type}" error:`, err);
        }
      });
    this.track(type, sub);
  }

  /** 发射事件 */
  emit(type: string, payload: Record<string, unknown> = {}): void {
    this.subject.next({ type, timestamp: Date.now(), payload });
  }

  /** 等待某类型事件（Promise 化）；超时 reject，语义同旧版 */
  waitFor(type: string, timeoutMs = 30_000): Promise<LatticeAgentEvent> {
    return firstValueFrom(
      this.ofType(type).pipe(
        timeout({
          each: timeoutMs,
          with: () =>
            throwError(() => new Error(`EventBus.waitFor("${type}") timeout after ${timeoutMs}ms`)),
        }),
      ),
    );
  }

  /** 移除某类型的所有订阅（无参 = 全部） */
  removeAll(type?: string): void {
    if (type) {
      this.drain(type);
    } else {
      for (const key of [...this.subs.keys()]) this.drain(key);
    }
  }

  /** 当前订阅数量（调试用） */
  get listenerCount(): number {
    let count = 0;
    for (const set of this.subs.values()) count += set.size;
    return count;
  }

  /** 登记订阅到分组表 */
  private track(type: string, sub: Subscription): void {
    let set = this.subs.get(type);
    if (!set) {
      set = new Set();
      this.subs.set(type, set);
    }
    set.add(sub);
  }

  /** 退订并清空某分组 */
  private drain(type: string): void {
    const set = this.subs.get(type);
    if (!set) return;
    for (const sub of set) sub.unsubscribe();
    this.subs.delete(type);
  }
}
