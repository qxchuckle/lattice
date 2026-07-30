/**
 * EventBus 语义测试（RxJS Subject 驱动后锁定行为不变）
 *
 * 覆盖：on/emit 基本收发、取消订阅、通配符、once 单次、waitFor 成功/超时、
 * handler 错误隔离、removeAll、listenerCount、以及新增的 events$/ofType 组合能力。
 */
import { describe, it, expect, vi } from 'vitest';
import { bufferCount, firstValueFrom } from 'rxjs';
import { EventBus } from '../src/events/event-bus.js';

describe('EventBus（RxJS 驱动）', () => {
  it('on/emit 收发 + payload 透传 + timestamp 打点', () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on('a', (e) => seen.push(e));
    bus.emit('a', { x: 1 });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { type: string }).type).toBe('a');
    expect((seen[0] as { payload: { x: number } }).payload.x).toBe(1);
    expect(typeof (seen[0] as { timestamp: number }).timestamp).toBe('number');
  });

  it('类型隔离：只收订阅类型的事件', () => {
    const bus = new EventBus();
    let a = 0;
    let b = 0;
    bus.on('a', () => a++);
    bus.on('b', () => b++);
    bus.emit('a');
    bus.emit('a');
    bus.emit('b');
    expect(a).toBe(2);
    expect(b).toBe(1);
  });

  it('取消订阅后不再收到 + listenerCount 归零', () => {
    const bus = new EventBus();
    let n = 0;
    const off = bus.on('a', () => n++);
    bus.emit('a');
    expect(bus.listenerCount).toBe(1);
    off();
    bus.emit('a');
    expect(n).toBe(1);
    expect(bus.listenerCount).toBe(0);
  });

  it('通配符 * 收到所有类型', () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.on('*', (e) => types.push(e.type));
    bus.emit('a');
    bus.emit('b');
    expect(types).toEqual(['a', 'b']);
  });

  it('once 只触发一次并自动退订', () => {
    const bus = new EventBus();
    let n = 0;
    bus.once('a', () => n++);
    bus.emit('a');
    bus.emit('a');
    expect(n).toBe(1);
    expect(bus.listenerCount).toBe(0);
  });

  it('handler 抛错被隔离：不影响其他订阅者、不终止 Subject', () => {
    const bus = new EventBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let survived = 0;
    bus.on('a', () => {
      throw new Error('boom');
    });
    bus.on('a', () => survived++);
    bus.emit('a');
    bus.emit('a'); // Subject 未因上次抛错而终止
    expect(survived).toBe(2);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('waitFor 成功 resolve', async () => {
    const bus = new EventBus();
    const p = bus.waitFor('ready', 1000);
    bus.emit('ready', { ok: true });
    const e = await p;
    expect(e.payload.ok).toBe(true);
  });

  it('waitFor 超时 reject（消息含类型与时长）', async () => {
    const bus = new EventBus();
    await expect(bus.waitFor('never', 20)).rejects.toThrow(/waitFor\("never"\) timeout after 20ms/);
  });

  it('removeAll(type) 只清该类型；removeAll() 清全部', () => {
    const bus = new EventBus();
    bus.on('a', () => {});
    bus.on('a', () => {});
    bus.on('b', () => {});
    expect(bus.listenerCount).toBe(3);
    bus.removeAll('a');
    expect(bus.listenerCount).toBe(1);
    bus.removeAll();
    expect(bus.listenerCount).toBe(0);
  });

  it('新增 ofType()：可用 operator 组合事件流', async () => {
    const bus = new EventBus();
    // 攒够两条 a 事件成组发出（bufferCount）——回调式 API 做不到，operator 天然支持
    const pair = firstValueFrom(bus.ofType('a').pipe(bufferCount(2)));
    bus.emit('a', { i: 1 });
    bus.emit('b');
    bus.emit('a', { i: 2 });
    const batch = await pair;
    expect(batch.map((e) => e.payload.i)).toEqual([1, 2]);
  });
});
