/**
 * Event Bus — 模块间发布/订阅通信
 * 零依赖，所有模块通过此总线解耦通信
 */

export interface LatticeAgentEvent {
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

type EventHandler = (event: LatticeAgentEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private wildcardHandlers = new Set<EventHandler>();

  /** 订阅指定类型事件，返回取消订阅函数 */
  on(type: string, handler: EventHandler): () => void {
    if (type === '*') {
      this.wildcardHandlers.add(handler);
      return () => this.wildcardHandlers.delete(handler);
    }
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  /** 订阅一次后自动取消 */
  once(type: string, handler: EventHandler): void {
    const unsub = this.on(type, (event) => {
      unsub();
      handler(event);
    });
  }

  /** 发射事件 */
  emit(type: string, payload: Record<string, unknown> = {}): void {
    const event: LatticeAgentEvent = { type, timestamp: Date.now(), payload };
    this.handlers.get(type)?.forEach((h) => {
      try {
        h(event);
      } catch (err) {
        console.error(`[EventBus] handler error for "${type}":`, err);
      }
    });
    this.wildcardHandlers.forEach((h) => {
      try {
        h(event);
      } catch (err) {
        console.error('[EventBus] wildcard handler error:', err);
      }
    });
  }

  /** 等待某类型事件（Promise 化） */
  waitFor(type: string, timeoutMs = 30_000): Promise<LatticeAgentEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`EventBus.waitFor("${type}") timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      const unsub = this.on(type, (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  /** 移除某类型的所有订阅 */
  removeAll(type?: string): void {
    if (type) {
      this.handlers.delete(type);
    } else {
      this.handlers.clear();
      this.wildcardHandlers.clear();
    }
  }

  /** 当前订阅数量（调试用） */
  get listenerCount(): number {
    let count = this.wildcardHandlers.size;
    for (const set of this.handlers.values()) count += set.size;
    return count;
  }
}
