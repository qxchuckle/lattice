export interface DisposableLike {
  dispose(): void;
}

/** vscode-free 最小事件发射器（供可单测的状态层使用）。 */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  get event(): (listener: (value: T) => void) => DisposableLike {
    return (listener) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
  }

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch {
        // 监听器异常不得破坏生产者（视图层各自处理错误）。
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
