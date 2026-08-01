/**
 * Block 渲染注册表模式测试
 *
 * 验证 BLOCK_RENDERERS 注册表：
 *   1. 每种已知 NodeContent type 都有注册的渲染器
 *   2. 注册表是 Map（可动态新增类型），而非硬编码 switch
 *   3. 未注册类型走 assertNever 兜底（不静默丢弃）
 *   4. 新增类型只需注册一项（不改 switch）
 */
import { describe, it, expect } from 'vitest';
import type { NodeContent } from '@qcqx/lattice-agent-protocol';
import { BLOCK_RENDERERS, getRegisteredBlockTypes } from './registry';
import { ContentBlockRenderer } from './index';

describe('BLOCK_RENDERERS 注册表', () => {
  it('注册了所有已知块类型', () => {
    const registered = getRegisteredBlockTypes();
    // tool_call / tool_result 由 groupToolBlocks 配对，ContentBlockRenderer 返回 null
    const expected = [
      'text',
      'code',
      'thinking',
      'diff',
      'image',
      'terminal',
      'error',
      'compaction',
      'notice',
      'tool_call',
      'tool_result',
    ];
    for (const type of expected) {
      expect(registered).toContain(type);
    }
  });

  it('注册表是 Map 实例（可动态扩展）', () => {
    expect(BLOCK_RENDERERS).toBeInstanceOf(Map);
  });

  it('tool_call 和 tool_result 渲染器返回 null（由 groupToolBlocks 处理）', () => {
    const callRenderer = BLOCK_RENDERERS.get('tool_call');
    const resultRenderer = BLOCK_RENDERERS.get('tool_result');
    expect(callRenderer).toBeDefined();
    expect(resultRenderer).toBeDefined();
    // 渲染器存在但返回 null（孤儿块无独立视觉）
    if (callRenderer) {
      const el = callRenderer({
        block: { type: 'tool_call', toolId: 't1', name: 'test', args: {} },
        streaming: false,
      });
      expect(el).toBeNull();
    }
    if (resultRenderer) {
      const el = resultRenderer({
        block: { type: 'tool_result', toolId: 't1', name: 'test', result: null },
        streaming: false,
      });
      expect(el).toBeNull();
    }
  });

  it('ContentBlockRenderer 对未知类型不静默丢弃（assertNever 兜底）', () => {
    // 未知类型应抛出而非返回 null
    const unknownBlock = { type: 'totally_unknown_type' } as unknown as NodeContent;
    expect(() => ContentBlockRenderer({ block: unknownBlock, streaming: false })).toThrow();
  });

  it('text 块通过注册表正确渲染', () => {
    const renderer = BLOCK_RENDERERS.get('text');
    expect(renderer).toBeDefined();
    if (renderer) {
      const el = renderer({
        block: { type: 'text', text: 'hello world' },
        streaming: false,
      });
      expect(el).not.toBeNull();
      expect(el?.type).toBeDefined();
    }
  });
});
