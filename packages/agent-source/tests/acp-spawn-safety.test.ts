/**
 * ACP driver spawn 安全测试（v2 语义）
 *
 * - spawn 后子进程 'error' 事件被监听（不导致 uncaughtException）；
 * - driver 裸抛原生 Error，由工厂按源设施边界（init）包为
 *   SourceError source_unavailable（retryable=false）。
 */
import { describe, it, expect, vi } from 'vitest';
import { createAcpSource } from '../src/sources/acp/index.js';
import { defineSource } from '../src/define-source.js';
import { SourceError } from '../src/types/error.js';

describe('ACP spawn 安全', () => {
  it('spawn 后子进程 error 事件被监听（不导致 uncaughtException）', async () => {
    // 监听 uncaughtException 以验证不会泄漏
    const uncaughtHandler = vi.fn();
    process.on('uncaughtException', uncaughtHandler);

    // 使用不存在的命令触发 spawn error
    const driver = createAcpSource({ command: 'definitely-not-a-real-cmd-xyz', id: 'spawn-test' });
    const source = defineSource(driver);

    // init 应该 reject
    await expect(source.init()).rejects.toThrow();

    // 给事件循环时间处理未处理的错误事件
    await new Promise((r) => setTimeout(r, 50));

    // 验证：没有 uncaughtException（意味着 error 事件被监听了）
    expect(uncaughtHandler).not.toHaveBeenCalled();

    process.removeListener('uncaughtException', uncaughtHandler);
  });

  it('spawn 失败（ENOENT）→ init() reject SourceError source_unavailable（工厂按边界包装）', async () => {
    const driver = createAcpSource({
      command: 'definitely-not-a-real-cmd-xyz',
      id: 'spawn-enoent',
    });
    const source = defineSource(driver);

    try {
      await source.init();
      expect.fail('should have thrown');
    } catch (err) {
      // driver 裸抛原生 Error，工厂在 init（源设施边界）包为 source_unavailable
      expect(err).toBeInstanceOf(SourceError);
      const se = err as SourceError;
      expect(se.code).toBe('source_unavailable');
      // 源设施不可用不可重试（恢复走 rehandshake）
      expect(se.retryable).toBe(false);
      // 错误消息应包含有用信息（命令名）
      expect(se.message.toLowerCase()).toMatch(/definitely-not-a-real-cmd-xyz|enoent|spawn/);
    }
  });

  it('spawn 失败不导致 uncaughtException', async () => {
    // 记录任何 uncaughtException
    const errors: Error[] = [];
    const handler = (err: Error) => errors.push(err);
    process.on('uncaughtException', handler);

    const driver = createAcpSource({ command: 'another-fake-cmd-12345', id: 'spawn-safety' });
    const source = defineSource(driver);

    // init 会失败
    await expect(source.init()).rejects.toThrow();

    // 等待事件循环处理完毕
    await new Promise((r) => setTimeout(r, 50));

    // 验证：没有 uncaughtException 被触发
    expect(errors).toHaveLength(0);

    process.removeListener('uncaughtException', handler);
  });
});
