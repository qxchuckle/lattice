/**
 * 判别联合 switch 的 exhaustiveness 兜底测试
 *
 * 编译期：漏 case 时 default 处的 assertNever(x) 因 x 收窄不到 never 而报错；
 * 运行时：被触达即抛错携带违规值，防漏 case 静默 fall-through。
 *
 * 本文件验证运行时兜底行为：传入 `as unknown as` 伪造的判别值时，
 * switch 末尾的 default assertNever 必须抛错（而非静默返回/落空）。
 */
import { describe, it, expect } from 'vitest';
import { applyEventToContent } from '../src/source/content-builder.js';
import { segmentsToDisplayText } from '../src/source/prompt-input.js';
import type { SourceEvent, PromptSegment } from '../src/index.js';

describe('applyEventToContent：exhaustiveness 兜底', () => {
  it('未知 SourceEvent.type 触达 default → assertNever 抛错（不静默 fall-through）', () => {
    const bogus = { type: '__bogus_event__', content: 'x' } as unknown as SourceEvent;
    expect(() => applyEventToContent([], bogus)).toThrow(/__bogus_event__|Unexpected/);
  });
});

describe('segmentsToDisplayText：exhaustiveness 兜底', () => {
  it('未知 PromptSegment.type 触达 default → assertNever 抛错（不静默落空）', () => {
    const bogus = { type: '__bogus_seg__' } as unknown as PromptSegment;
    expect(() => segmentsToDisplayText([bogus])).toThrow(/__bogus_seg__|Unexpected/);
  });
});
