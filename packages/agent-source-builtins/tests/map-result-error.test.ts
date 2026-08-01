/**
 * 映射纯函数测试：SDK result 消息 → SourceEvent（错误判定契约）
 *
 * 背景：Qoder SDK(@qoder-ai/qoder-agent-sdk) 的错误 result 的 subtype 为
 * error_during_execution / error_max_turns / error_max_budget_usd /
 * error_max_structured_output_retries（永不为 'error'），错误文案在 errors: string[]；
 * SDKResultSuccess 也可能携带 is_error=true（文案在 result: string）。
 * 旧实现只判 subtype==='error' 导致无额度等错误被当成正常完成（空节点无重试）。
 */
import { describe, it, expect } from 'vitest';
import { mapQoderMessage } from '../src/qoder/map-message.js';

const src = { id: 'test', name: 'Test' };

describe('mapQoderMessage result 错误映射', () => {
  it('error_during_execution + errors[] → error 事件（多条 join）', () => {
    const events = mapQoderMessage(
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['quota exceeded', 'please recharge'],
      },
      src,
    );
    expect(events).toEqual([
      {
        type: 'error',
        message: 'quota exceeded\nplease recharge',
        code: 'unknown',
        retryable: false,
        source: src,
      },
    ]);
  });

  it('error_max_budget_usd → error 事件（error 前缀 subtype 均命中）', () => {
    const events = mapQoderMessage(
      { type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: ['budget'] },
      src,
    );
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', message: 'budget', retryable: false }),
    ]);
  });

  it('success + is_error=true → error 事件（文案取 result 字段）', () => {
    const events = mapQoderMessage(
      { type: 'result', subtype: 'success', is_error: true, result: 'insufficient quota' },
      src,
    );
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', message: 'insufficient quota' }),
    ]);
  });

  it('errors 含非字符串/空串 → 过滤后 join', () => {
    const events = mapQoderMessage(
      { type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['', 42, 'real'] },
      src,
    );
    expect(events).toEqual([expect.objectContaining({ type: 'error', message: 'real' })]);
  });

  it('错误 result 无 errors 也无 result → 兜底 Unknown error', () => {
    const events = mapQoderMessage(
      { type: 'result', subtype: 'error_during_execution', is_error: true },
      src,
    );
    expect(events).toEqual([expect.objectContaining({ type: 'error', message: 'Unknown error' })]);
  });

  it('success + is_error=false → 不产生 error 事件', () => {
    expect(
      mapQoderMessage({ type: 'result', subtype: 'success', is_error: false, result: 'done' }, src),
    ).toEqual([]);
  });

  it('success 无 is_error 字段 → 不产生 error 事件', () => {
    expect(mapQoderMessage({ type: 'result', subtype: 'success', result: 'ok' }, src)).toEqual([]);
  });
});
