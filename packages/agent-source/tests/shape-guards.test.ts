/**
 * 形状守卫与 dot-path 的边界行为
 *
 * 这些是「处理 SDK 松散数据」的地基：判定错了会把异常载荷当正常字段读，
 * 或让 dot-path 在中途撞上非对象时静默写坏结构。
 */
import { describe, it, expect } from 'vitest';
import { isRecord, stringField, recordField } from '../src/internal/shape.js';
import { getPath, setPath } from '../src/handshake.js';

describe('isRecord', () => {
  it('普通对象通过；null / 数组 / 原始值一律拒绝', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord([1, 2])).toBe(false); // 数组不算记录：防 obj[0] 被当字段读
    expect(isRecord('x')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe('stringField / recordField', () => {
  it('stringField：非字符串与空串都视为缺失', () => {
    expect(stringField({ a: 'v' }, 'a')).toBe('v');
    expect(stringField({ a: '' }, 'a')).toBeUndefined();
    expect(stringField({ a: 1 }, 'a')).toBeUndefined();
    expect(stringField(null, 'a')).toBeUndefined();
  });

  it('recordField：缺失或非对象回退空对象（调用方无需判空）', () => {
    expect(recordField({ a: { b: 1 } }, 'a')).toEqual({ b: 1 });
    expect(recordField({ a: 'x' }, 'a')).toEqual({});
    expect(recordField(undefined, 'a')).toEqual({});
  });
});

describe('dot-path 边界', () => {
  it('getPath：路径中途撞上非对象 → null（不抛）', () => {
    expect(getPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
    expect(getPath({ a: 'str' }, 'a.b')).toBeNull();
    expect(getPath({ a: [1] }, 'a.0')).toBeNull(); // 数组不当记录走
    expect(getPath(null, 'a')).toBeNull();
    expect(getPath({ a: undefined }, 'a')).toBeNull();
  });

  it('setPath：不改原对象，中间缺失节点自动创建', () => {
    const original = { session: { fork: { atMessage: true } } };
    const updated = setPath(original, 'session.fork.atMessage', false);
    expect(updated.session.fork.atMessage).toBe(false);
    expect(original.session.fork.atMessage).toBe(true); // 原对象不被篡改
    expect(updated).not.toBe(original);
  });

  it('setPath：中途是非对象时替换为对象再写入（不抛、不丢新值）', () => {
    const updated = setPath({ a: 'scalar' } as Record<string, unknown>, 'a.b', 1);
    expect(updated).toEqual({ a: { b: 1 } });
  });
});
