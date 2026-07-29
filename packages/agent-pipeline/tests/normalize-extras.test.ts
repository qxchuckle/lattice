/**
 * normalize 的哨兵归一化 + 工具语义回填（两个「宿主本不该自己写」的活）
 */
import { describe, it, expect } from 'vitest';
import type {
  MiddlewareContext,
  SourceEvent,
  SourceToolSemantic,
} from '@qcqx/lattice-agent-protocol';
import { createNormalizeMiddleware, createToolSemanticMiddleware } from '../src/index.js';
import { PI_LIKE, QODER_LIKE } from './fixtures.js';

const CTX: MiddlewareContext = { sourceId: 'fake' };

describe("thinkingLevel 哨兵 'none'", () => {
  const mw = createNormalizeMiddleware({ capabilities: PI_LIKE });
  const base = { sessionId: null, message: [{ type: 'text' as const, text: 'hi' }] };

  it("'none' → 不传（源永不看到哨兵值）", async () => {
    const out = await mw.transformPrompt!({ ...base, opts: { thinkingLevel: 'none' } }, CTX);
    expect('thinkingLevel' in out.opts).toBe(false);
  });

  it('有效等级原样保留', async () => {
    const out = await mw.transformPrompt!({ ...base, opts: { thinkingLevel: 'high' } }, CTX);
    expect(out.opts.thinkingLevel).toBe('high');
  });

  it('未指定时不引入该字段', async () => {
    const payload = { ...base, opts: {} };
    expect(await mw.transformPrompt!(payload, CTX)).toBe(payload);
  });
});

describe('工具语义回填', () => {
  const mw = createToolSemanticMiddleware(QODER_LIKE); // builtin: Write → file-write

  const call = (name: string, semantic?: SourceToolSemantic): SourceEvent => ({
    type: 'tool_call',
    id: 't1',
    name,
    args: {},
    ...(semantic ? { semantic } : {}),
  });

  it('声明表命中 → 补语义', () => {
    const [out] = mw.transformEvent!(call('Write'), CTX);
    expect(out).toMatchObject({ type: 'tool_call', semantic: 'file-write' });
  });

  it('未声明的工具 → other（不猜）', () => {
    const [out] = mw.transformEvent!(call('MysteryTool'), CTX);
    expect(out).toMatchObject({ semantic: 'other' });
  });

  it('事件自带语义 → 不覆盖（driver 映射时的判断更准）', () => {
    const [out] = mw.transformEvent!(call('Write', 'terminal'), CTX);
    expect(out).toMatchObject({ semantic: 'terminal' });
  });

  it('非 tool_call 事件原样放行（同一对象，零拷贝）', () => {
    const event: SourceEvent = { type: 'text', content: 'a' };
    expect(mw.transformEvent!(event, CTX)[0]).toBe(event);
  });
});
