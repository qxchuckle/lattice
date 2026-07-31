/**
 * dispose / destroySession 韧性测试（v2 语义）
 *
 * 边界策略：dispose 是收尾路径，失败不抛（避免阻断其他源退出）但必可观测：
 * - dispose() 中单个 handle.close() 抛错不中断其他句柄清理（console.warn）
 * - driver.dispose() 抛错同样不抛出（console.warn）
 * - destroySession() 中 handle.close() 抛错不导致句柄泄漏
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineSource } from '../src/define-source.js';
import { createScriptedDriver } from '../src/testing/index.js';
import type { SourceDriver, DriverSessionHandle } from '../src/driver.js';

async function collect(iter: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('dispose 韧性：单个 handle.close() 失败不中断其他句柄清理', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('三个句柄，中间一个 close() reject → 其他两个仍被关闭', async () => {
    const closedIds: string[] = [];
    const base = createScriptedDriver();

    const driver: SourceDriver = {
      ...base,
      async connect(sessionId: string | null): Promise<DriverSessionHandle> {
        const id = sessionId ?? `handle-${closedIds.length}`;
        return {
          id,
          abort: () => {},
          close: async () => {
            if (id === 'handle-1') {
              throw new Error('close failed for handle-1');
            }
            closedIds.push(id);
          },
        };
      },
    };

    const source = defineSource(driver);
    await source.init();

    // 建立三个句柄
    await collect(source.prompt('handle-0', [{ type: 'text', text: 'a' }]));
    await collect(source.prompt('handle-1', [{ type: 'text', text: 'b' }]));
    await collect(source.prompt('handle-2', [{ type: 'text', text: 'c' }]));

    // dispose 不应抛错
    await expect(source.dispose()).resolves.toBeUndefined();

    // handle-0 和 handle-2 的 close 应该被调用
    expect(closedIds).toContain('handle-0');
    expect(closedIds).toContain('handle-2');
  });

  it('dispose() 不抛错（即使有 handle.close() reject）', async () => {
    const base = createScriptedDriver();
    const driver: SourceDriver = {
      ...base,
      async connect(sessionId: string | null): Promise<DriverSessionHandle> {
        return {
          id: sessionId ?? 'x',
          abort: () => {},
          close: async () => {
            throw new Error('close boom');
          },
        };
      },
    };

    const source = defineSource(driver);
    await source.init();
    await collect(source.prompt('s1', [{ type: 'text', text: 'a' }]));

    // dispose 不抛错
    await expect(source.dispose()).resolves.toBeUndefined();
  });

  it('dispose 错误被记录到 console.warn', async () => {
    const base = createScriptedDriver();
    const driver: SourceDriver = {
      ...base,
      async connect(sessionId: string | null): Promise<DriverSessionHandle> {
        return {
          id: sessionId ?? 'x',
          abort: () => {},
          close: async () => {
            throw new Error('close boom');
          },
        };
      },
    };

    const source = defineSource(driver);
    await source.init();
    await collect(source.prompt('s1', [{ type: 'text', text: 'a' }]));
    await source.dispose();

    // console.warn 应该被调用记录错误
    expect(warnSpy).toHaveBeenCalled();
  });

  it('driver.dispose() 在所有句柄关闭后仍被调用', async () => {
    let driverDisposed = false;
    const base = createScriptedDriver();
    const driver: SourceDriver = {
      ...base,
      async connect(sessionId: string | null): Promise<DriverSessionHandle> {
        return {
          id: sessionId ?? 'x',
          abort: () => {},
          close: async () => {
            throw new Error('close boom');
          },
        };
      },
      dispose: async () => {
        driverDisposed = true;
      },
    };

    const source = defineSource(driver);
    await source.init();
    await collect(source.prompt('s1', [{ type: 'text', text: 'a' }]));
    await source.dispose();

    expect(driverDisposed).toBe(true);
  });

  it('driver.dispose() 自身抛错 → dispose() 不抛出，仅 console.warn', async () => {
    const base = createScriptedDriver();
    const driver: SourceDriver = {
      ...base,
      dispose: async () => {
        throw new Error('driver dispose boom');
      },
    };

    const source = defineSource(driver);
    await source.init();

    await expect(source.dispose()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('driver dispose failed'),
      expect.stringContaining('driver dispose boom'),
    );
  });
});

describe('destroySession 韧性：handle.close() 失败不导致泄漏', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('handle.close() reject → destroySession 不抛错', async () => {
    const base = createScriptedDriver();
    const driver: SourceDriver = {
      ...base,
      async connect(sessionId: string | null): Promise<DriverSessionHandle> {
        return {
          id: sessionId ?? 'x',
          abort: () => {},
          close: async () => {
            throw new Error('close boom');
          },
        };
      },
    };

    const source = defineSource(driver);
    await source.init();
    await collect(source.prompt('s1', [{ type: 'text', text: 'a' }]));

    // destroySession 不抛错
    await expect(source.destroySession('s1')).resolves.toBeUndefined();
  });

  it('handle.close() reject → 句柄仍从 map 中移除（不泄漏）', async () => {
    const base = createScriptedDriver();
    let connectCount = 0;
    const driver: SourceDriver = {
      ...base,
      async connect(sessionId: string | null): Promise<DriverSessionHandle> {
        connectCount++;
        return {
          id: sessionId ?? `handle-${connectCount}`,
          abort: () => {},
          close: async () => {
            throw new Error('close boom');
          },
        };
      },
    };

    const source = defineSource(driver);
    await source.init();
    await collect(source.prompt('s1', [{ type: 'text', text: 'a' }]));

    // 销毁会话（close 会失败）
    await source.destroySession('s1');

    // 再次 prompt 同一 sessionId → 应该重新 connect（句柄已被移除）
    await collect(source.prompt('s1', [{ type: 'text', text: 'b' }]));
    expect(connectCount).toBe(2);
  });
});
