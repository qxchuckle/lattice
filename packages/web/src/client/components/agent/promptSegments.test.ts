/**
 * chipDisplay exhaustiveness 兜底测试
 *
 * PromptSegment 新增变体而 switch 未补时，default assertNever 应抛错而非静默落空。
 */
import { describe, it, expect } from 'vitest';
import type { PromptSegment } from '@qcqx/lattice-agent-protocol';
import { chipDisplay } from './promptSegments';

describe('chipDisplay：exhaustiveness 兜底', () => {
  it('未知 PromptSegment.type 触达 default → assertNever 抛错（不静默返回 undefined）', () => {
    const bogus = { type: '__bogus_chip__' } as unknown as PromptSegment;
    expect(() => chipDisplay(bogus)).toThrow(/__bogus_chip__|Unexpected/);
  });
});
