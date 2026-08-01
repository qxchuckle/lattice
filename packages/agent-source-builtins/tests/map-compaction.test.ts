/**
 * 映射纯函数测试：SDK 消息 → SourceEvent（compaction 透传契约）
 *
 * 背景：qoder/pi 内部自动压缩上下文（auto-compaction），源层职责是把
 * 各源的压缩消息统一映射为 SourceEvent 'compaction'（透传观察，不改 fork/resume 语义）。
 */
import { describe, it, expect } from 'vitest';
import { mapQoderMessage } from '../src/qoder/map-message.js';
import { mapPiEvent } from '../src/pi/map-event.js';

const src = { id: 'test', name: 'Test' };

describe('mapQoderMessage compaction', () => {
  it('system/compact_boundary → compaction 事件（trigger/preTokens 透传）', () => {
    const events = mapQoderMessage(
      {
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'auto', pre_tokens: 37418 },
      },
      src,
    );
    expect(events).toEqual([{ type: 'compaction', trigger: 'auto', preTokens: 37418 }]);
  });

  it('compact_metadata 缺失 → trigger 兜底 auto、无 preTokens', () => {
    const events = mapQoderMessage({ type: 'system', subtype: 'compact_boundary' }, src);
    expect(events).toEqual([{ type: 'compaction', trigger: 'auto' }]);
  });

  it('其他 system 子类型不产生事件', () => {
    expect(mapQoderMessage({ type: 'system', subtype: 'status' }, src)).toEqual([]);
  });
});

describe('mapPiEvent compaction', () => {
  it('compaction_end 成功 → compaction 事件（summary/tokens 透传，threshold→auto）', () => {
    const mapped = mapPiEvent(
      {
        type: 'compaction_end',
        reason: 'threshold',
        aborted: false,
        result: { summary: '摘要内容', tokensBefore: 180000, estimatedTokensAfter: 20000 },
      },
      src,
    );
    expect(mapped).toEqual([
      {
        type: 'compaction',
        trigger: 'auto',
        preTokens: 180000,
        postTokens: 20000,
        summary: '摘要内容',
      },
    ]);
  });

  it('reason=manual → trigger manual', () => {
    const mapped = mapPiEvent(
      { type: 'compaction_end', reason: 'manual', result: { summary: 's', tokensBefore: 1 } },
      src,
    );
    expect(mapped).toEqual([expect.objectContaining({ type: 'compaction', trigger: 'manual' })]);
  });

  it('aborted / 无 result → 不产生标记', () => {
    expect(
      mapPiEvent({ type: 'compaction_end', reason: 'manual', aborted: true, result: {} }, src),
    ).toEqual([]);
    expect(mapPiEvent({ type: 'compaction_end', reason: 'overflow' }, src)).toEqual([]);
  });

  it('compaction_start 不产生事件（只在 end 落标记）', () => {
    expect(mapPiEvent({ type: 'compaction_start', reason: 'threshold' }, src)).toEqual([]);
  });
});
