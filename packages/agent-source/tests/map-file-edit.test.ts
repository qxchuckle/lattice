/**
 * 映射纯函数测试：写入类工具调用 → file_edit 事件（C3）
 *
 * 背景：此前全仓无任何源产出 file_edit 事件，diff 块与 fileChanges 恒为空，
 * 回合末「改动文件汇总」无数据。源层职责：把写入类工具调用额外映射为 file_edit
 * （壳层凭此汇总改动文件，不认识工具名）。
 */
import { describe, it, expect } from 'vitest';
import { mapQoderMessage } from '../src/sources/qoder/map-message.js';
import { mapPiEvent } from '../src/sources/pi/map-event.js';

const src = { id: 'test', name: 'Test' };

describe('mapQoderMessage file_edit', () => {
  it('Write tool_use → tool_call + file_edit（kind=create，file_path 提取）', () => {
    const events = mapQoderMessage(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Write',
              input: { file_path: '/a/b.ts', content: 'x' },
            },
          ],
        },
      },
      src,
    );
    expect(events).toEqual([
      { type: 'tool_call', id: 't1', name: 'Write', args: { file_path: '/a/b.ts', content: 'x' } },
      { type: 'file_edit', path: '/a/b.ts', kind: 'create' },
    ]);
  });

  it('Edit tool_use → file_edit（kind=edit）', () => {
    const events = mapQoderMessage(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/a/c.ts' } }],
        },
      },
      src,
    );
    expect(events[1]).toEqual({ type: 'file_edit', path: '/a/c.ts', kind: 'edit' });
  });

  it('非写入类工具（Read）→ 只有 tool_call，无 file_edit', () => {
    const events = mapQoderMessage(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't3', name: 'Read', input: { file_path: '/a' } }],
        },
      },
      src,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_call', name: 'Read' });
  });

  it('写入类工具缺路径参数 → 不产生 file_edit（仅 tool_call）', () => {
    const events = mapQoderMessage(
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't4', name: 'Write', input: {} }] },
      },
      src,
    );
    expect(events).toHaveLength(1);
  });
});

describe('mapPiEvent file_edit', () => {
  it('write tool_execution_start → tool_call + file_edit（path 提取，kind=create）', () => {
    const mapped = mapPiEvent(
      {
        type: 'tool_execution_start',
        toolCall: { id: 'p1', name: 'write', arguments: { path: '/x/y.ts', content: 'z' } },
      },
      src,
    );
    expect(mapped).toEqual([
      { type: 'tool_call', id: 'p1', name: 'write', args: { path: '/x/y.ts', content: 'z' } },
      { type: 'file_edit', path: '/x/y.ts', kind: 'create' },
    ]);
  });

  it('edit tool_execution_start → file_edit（kind=edit）', () => {
    const mapped = mapPiEvent(
      {
        type: 'tool_execution_start',
        toolCall: { id: 'p2', name: 'edit', arguments: { path: '/x' } },
      },
      src,
    );
    expect(mapped[1]).toEqual({ type: 'file_edit', path: '/x', kind: 'edit' });
  });

  it('bash 工具 → 无 file_edit', () => {
    const mapped = mapPiEvent(
      {
        type: 'tool_execution_start',
        toolCall: { id: 'p3', name: 'bash', arguments: { cmd: 'ls' } },
      },
      src,
    );
    expect(mapped).toHaveLength(1);
  });
});
