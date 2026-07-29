/**
 * turnSummary 纯函数测试：工具配对（B1）+ 改动文件聚合（D2）+ 耗时格式化
 */
import { describe, it, expect } from 'vitest';
import type { NodeContent } from '@qcqx/lattice-agent-protocol';
import { groupToolBlocks, collectFileChanges, formatDuration } from './turnSummary';

describe('groupToolBlocks', () => {
  it('tool_call + tool_result 配对为一个 tool-group', () => {
    const blocks: NodeContent[] = [
      { type: 'tool_call', toolId: 't1', name: 'Bash', args: {}, status: 'success' },
      { type: 'tool_result', toolId: 't1', name: 'Bash', result: 'ok' },
    ];
    const out = groupToolBlocks(blocks);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'tool-group' });
    const group = out[0] as Extract<(typeof out)[number], { type: 'tool-group' }>;
    expect(group.call.toolId).toBe('t1');
    expect(group.result?.result).toBe('ok');
  });

  it('多个调用交错仍按 toolId 正确配对', () => {
    const blocks: NodeContent[] = [
      { type: 'tool_call', toolId: 'a', name: 'X', args: {} },
      { type: 'tool_call', toolId: 'b', name: 'Y', args: {} },
      { type: 'tool_result', toolId: 'a', name: 'X', result: 'ra' },
      { type: 'tool_result', toolId: 'b', name: 'Y', result: 'rb' },
    ];
    const out = groupToolBlocks(blocks);
    expect(out).toHaveLength(2);
    expect(
      (out[0] as { call: { toolId: string }; result?: { result: unknown } }).result?.result,
    ).toBe('ra');
    expect(
      (out[1] as { call: { toolId: string }; result?: { result: unknown } }).result?.result,
    ).toBe('rb');
  });

  it('流式期间 result 未到 → call 单独成组（result 缺省）', () => {
    const blocks: NodeContent[] = [
      { type: 'tool_call', toolId: 't1', name: 'Bash', args: {}, status: 'pending' },
    ];
    const out = groupToolBlocks(blocks);
    expect(out).toHaveLength(1);
    expect((out[0] as { result?: unknown }).result).toBeUndefined();
  });

  it('孤儿 tool_result（无对应 call）→ 原样保留', () => {
    const blocks: NodeContent[] = [
      { type: 'tool_result', toolId: 'ghost', name: 'X', result: 'r' },
    ];
    const out = groupToolBlocks(blocks);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'tool_result', toolId: 'ghost' });
  });

  it('普通块原样保留顺序', () => {
    const blocks: NodeContent[] = [
      { type: 'text', text: 'hi' },
      { type: 'tool_call', toolId: 't1', name: 'Bash', args: {} },
      { type: 'tool_result', toolId: 't1', name: 'Bash', result: 'ok' },
      { type: 'text', text: 'bye' },
    ];
    const out = groupToolBlocks(blocks);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: 'text', text: 'hi' });
    expect(out[1]).toMatchObject({ type: 'tool-group' });
    expect(out[2]).toMatchObject({ type: 'text', text: 'bye' });
  });
});

describe('collectFileChanges', () => {
  it('diff 块按路径聚合 + kind + 次数', () => {
    const blocks: NodeContent[] = [
      { type: 'diff', path: '/a.ts', kind: 'create' },
      { type: 'diff', path: '/a.ts', kind: 'edit' },
      { type: 'diff', path: '/b.ts', kind: 'edit' },
    ];
    const items = collectFileChanges(blocks);
    expect(items).toEqual([
      { path: '/a.ts', kind: 'create', count: 2 },
      { path: '/b.ts', kind: 'edit', count: 1 },
    ]);
  });

  it('file-write tool_call 兜底（无 diff 块时从 args 提取路径，kind 不推断）', () => {
    const blocks: NodeContent[] = [
      {
        type: 'tool_call',
        toolId: 't1',
        name: 'Write',
        args: { file_path: '/c.ts' },
        semantic: 'file-write',
      },
    ];
    const items = collectFileChanges(blocks);
    expect(items).toEqual([{ path: '/c.ts', count: 1 }]);
  });

  it('同文件 tool_call + diff 共存（源层实际产出顺序）→ 不重复计数', () => {
    // map-event 对写入类工具同时产出 tool_call 与 file_edit，tool_call 块在前、diff 块在后
    const blocks: NodeContent[] = [
      {
        type: 'tool_call',
        toolId: 't1',
        name: 'Write',
        args: { file_path: '/a.ts' },
        semantic: 'file-write',
      },
      { type: 'diff', path: '/a.ts', kind: 'create' },
    ];
    const items = collectFileChanges(blocks);
    expect(items).toEqual([{ path: '/a.ts', kind: 'create', count: 1 }]);
  });

  it('diff 块已记录的路径不被 tool_call 兜底重复计数（diff 在前）', () => {
    const blocks: NodeContent[] = [
      { type: 'diff', path: '/a.ts', kind: 'edit' },
      {
        type: 'tool_call',
        toolId: 't1',
        name: 'Edit',
        args: { file_path: '/a.ts' },
        semantic: 'file-write',
      },
    ];
    const items = collectFileChanges(blocks);
    expect(items).toEqual([{ path: '/a.ts', kind: 'edit', count: 1 }]);
  });

  it('无改动 → 空数组', () => {
    expect(collectFileChanges([{ type: 'text', text: 'hi' }])).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('<1s 显示毫秒', () => {
    expect(formatDuration(320)).toBe('320ms');
  });
  it('<60s 显示秒（一位小数）', () => {
    expect(formatDuration(1234)).toBe('1.2s');
    expect(formatDuration(78000 - 60000)).toBe('18.0s');
  });
  it('≥60s 显示 1m2s', () => {
    expect(formatDuration(62000)).toBe('1m2s');
    expect(formatDuration(120000)).toBe('2m');
  });
  it('非法值 → 空串', () => {
    expect(formatDuration(-1)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
  });
});
