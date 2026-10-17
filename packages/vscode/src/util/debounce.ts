export interface DebouncedFunction<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): DebouncedFunction<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const invoke = () => {
    timer = undefined;
    const args = lastArgs;
    lastArgs = undefined;
    if (args) fn(...args);
  };

  const wrapped = ((...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(invoke, Math.max(0, ms));
  }) as DebouncedFunction<A>;

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      invoke();
    }
  };
  return wrapped;
}
