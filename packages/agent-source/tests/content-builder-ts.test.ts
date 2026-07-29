/**
 * 事件→内容转换测试：时间戳吸收（A3）
 *
 * 背景：时长信息走「事件打点 + 内容块吸收」——编排层给 SourceEvent 注入 ts，
 * applyEventToContent（协议纯函数）消费 event.ts 写入 thinking/tool_call 块，
 * 保证 live/reload/多端看到同一套时间。纯函数内部禁止 Date.now()。
 *
 * 放在 agent-source/tests（protocol 包无独立测试项目，agent-source 依赖 protocol）。
 */
import { describe, it, expect } from 'vitest';
import { applyEventToContent, StreamAccumulator } from '@qcqx/lattice-agent-protocol';
import type { NodeContent } from '@qcqx/lattice-agent-protocol';

type ThinkingBlock = Extract<NodeContent, { type: 'thinking' }>;
type ToolCallBlock = Extract<NodeContent, { type: 'tool_call' }>;

describe('applyEventToContent 时间吸收', () => {
  it('thinking 首 delta 写 startedAt，后续 delta 刷新 endedAt', () => {
    const content: NodeContent[] = [];
    applyEventToContent(content, { type: 'thinking', content: 'a', ts: 1000 });
    applyEventToContent(content, { type: 'thinking', content: 'b', ts: 2500 });
    const block = content[0] as ThinkingBlock;
    expect(block.text).toBe('ab');
    expect(block.startedAt).toBe(1000);
    expect(block.endedAt).toBe(2500);
  });

  it('thinking 无 ts（旧事件）→ 不写时间字段（向后兼容）', () => {
    const content: NodeContent[] = [];
    applyEventToContent(content, { type: 'thinking', content: 'x' });
    const block = content[0] as ThinkingBlock;
    expect(block.startedAt).toBeUndefined();
    expect(block.endedAt).toBeUndefined();
  });

  it('tool_call 写 startedAt + semantic', () => {
    const content: NodeContent[] = [];
    applyEventToContent(content, {
      type: 'tool_call',
      id: 't1',
      name: 'Bash',
      args: { command: 'ls' },
      semantic: 'terminal',
      ts: 5000,
    });
    const block = content[0] as ToolCallBlock;
    expect(block.startedAt).toBe(5000);
    expect(block.semantic).toBe('terminal');
    expect(block.status).toBe('pending');
  });

  it('tool_result 回填对应 tool_call 的 endedAt 与 status', () => {
    const content: NodeContent[] = [];
    applyEventToContent(content, { type: 'tool_call', id: 't1', name: 'Bash', args: {}, ts: 5000 });
    applyEventToContent(content, {
      type: 'tool_result',
      id: 't1',
      name: 'Bash',
      result: 'ok',
      ts: 6200,
    });
    const call = content[0] as ToolCallBlock;
    expect(call.endedAt).toBe(6200);
    expect(call.status).toBe('success');
    // tool_result 块仍独立存在（视图层配对，落盘格式不变）
    expect(content[1]).toMatchObject({ type: 'tool_result', toolId: 't1' });
  });

  it('file_edit diff 可缺失 + kind 落盘为 diff 块', () => {
    const content: NodeContent[] = [];
    applyEventToContent(content, { type: 'file_edit', path: '/a/b.ts', kind: 'create' });
    expect(content[0]).toEqual({ type: 'diff', path: '/a/b.ts', text: undefined, kind: 'create' });
  });
});

describe('StreamAccumulator 时间收敛', () => {
  it('toolCalls 记录优先用事件 ts', () => {
    const acc = new StreamAccumulator();
    acc.apply({ type: 'tool_call', id: 't1', name: 'Bash', args: {}, ts: 5000 });
    acc.apply({ type: 'tool_result', id: 't1', name: 'Bash', result: 'ok', ts: 6200 });
    expect(acc.toolCalls[0].startedAt).toBe(5000);
    expect(acc.toolCalls[0].endedAt).toBe(6200);
  });

  it('file_edit 累积进 fileChanges（diff 缺失兜底空串）', () => {
    const acc = new StreamAccumulator();
    acc.apply({ type: 'file_edit', path: '/a/b.ts', kind: 'edit' });
    expect(acc.fileChanges[0]).toMatchObject({ path: '/a/b.ts', diff: '', status: 'pending' });
  });
});
