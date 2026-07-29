/**
 * PromptComposer 测试 — 结构化输入段 → 最终 prompt 文本
 *
 * 覆盖：纯文本 / 本地命令模板展开（标记包裹 + args 前置）/ 源级命令透传 /
 * ref 解析与降级 / inline-ref 注入 / displayText 与展开文本分离 / 超限截断。
 */
import { describe, it, expect } from 'vitest';
import { composePrompt } from '../src/prompt/prompt-composer.js';
import type { PromptSegment, ContentBlock } from '@qcqx/lattice-agent-protocol';

/** 取全部 text block 拼接（断言用） */
function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

describe('composePrompt', () => {
  it('纯文本：单 text block，displayText 一致', async () => {
    const segs: PromptSegment[] = [{ type: 'text', text: '你好' }];
    const r = await composePrompt(segs);
    expect(r.blocks).toEqual([{ type: 'text', text: '你好' }]);
    expect(r.displayText).toBe('你好');
  });

  it('本地命令：模板全文标记包裹，args 拼在用户文本区', async () => {
    const segs: PromptSegment[] = [{ type: 'command', name: 'lattice/task/start', args: '123' }];
    const r = await composePrompt(segs, {
      resolveCommandTemplate: async (name) => (name === 'lattice/task/start' ? '模板正文' : null),
    });
    const text = textOf(r.blocks);
    expect(text).toContain('123\n\n--- Lattice Command: lattice/task/start ---');
    expect(text).toContain('模板正文');
    expect(text).toContain('--- End Command ---');
    // displayText 是用户可见形式，不含模板全文
    expect(r.displayText).toBe('/lattice/task/start 123');
    expect(r.displayText).not.toContain('模板正文');
  });

  it('非本地命令（源级/未知）：透传 slash 文本', async () => {
    const segs: PromptSegment[] = [{ type: 'command', name: 'compact', args: 'now' }];
    const r = await composePrompt(segs, { resolveCommandTemplate: async () => null });
    expect(textOf(r.blocks)).toBe('/compact now');
  });

  it('无 deps：命令降级为 slash 文本（缺省契约）', async () => {
    const r = await composePrompt([{ type: 'command', name: 'x' }]);
    expect(textOf(r.blocks)).toBe('/x');
  });

  it('图片段：独立 image block 保序，文本段在前后各自合并', async () => {
    const segs: PromptSegment[] = [
      { type: 'text', text: '看这张图' },
      { type: 'image', data: 'AAA=', mimeType: 'image/png', name: 's.png' },
      { type: 'text', text: '有什么问题' },
    ];
    const r = await composePrompt(segs);
    expect(r.blocks).toEqual([
      { type: 'text', text: '看这张图' },
      { type: 'image', data: 'AAA=', mimeType: 'image/png' },
      { type: 'text', text: '有什么问题' },
    ]);
    expect(r.displayText).toBe('看这张图[图片:s.png]有什么问题');
  });

  it('文件引用：行内路径，不读内容不走 resolveRef', async () => {
    let called = false;
    const r = await composePrompt(
      [{ type: 'ref', refType: 'file', id: 'src/a.ts', display: 'a.ts' }],
      {
        resolveRef: async () => {
          called = true;
          return '不应被读取';
        },
      },
    );
    expect(textOf(r.blocks)).toBe('@src/a.ts');
    expect(called).toBe(false);
  });

  it('ref 解析成功：内容标记包裹；失败：保留 @display', async () => {
    const segs: PromptSegment[] = [
      { type: 'ref', refType: 'spec', id: 'spec-a', display: 'spec-a' },
      { type: 'ref', refType: 'task', id: 'no-such', display: '任务X' },
    ];
    const r = await composePrompt(segs, {
      resolveRef: async (_t, id) => (id === 'spec-a' ? 'spec 正文' : null),
    });
    const text = textOf(r.blocks);
    expect(text).toContain('--- Ref spec: spec-a ---\nspec 正文\n--- End Ref ---');
    expect(text).toContain('@任务X');
  });

  it('inline-ref：携带内容直接注入', async () => {
    const segs: PromptSegment[] = [
      { type: 'inline-ref', refType: 'selection', display: '选中代码', content: 'const a = 1;' },
    ];
    const r = await composePrompt(segs);
    expect(textOf(r.blocks)).toContain(
      '--- Ref selection: 选中代码 ---\nconst a = 1;\n--- End Ref ---',
    );
    expect(r.displayText).toBe('@选中代码');
  });

  it('超长引用内容截断加注', async () => {
    const big = 'x'.repeat(40_000);
    const r = await composePrompt([
      { type: 'inline-ref', refType: 'node', display: 'n', content: big },
    ]);
    const text = textOf(r.blocks);
    expect(text.length).toBeLessThan(40_000);
    expect(text).toContain('内容超限已截断');
  });

  it('混合段落按序拼接', async () => {
    const segs: PromptSegment[] = [
      { type: 'command', name: 'cmd' },
      { type: 'text', text: '补充说明' },
    ];
    const r = await composePrompt(segs, { resolveCommandTemplate: async () => 'T' });
    const text = textOf(r.blocks);
    const cmdIdx = text.indexOf('--- Lattice Command');
    const textIdx = text.indexOf('补充说明');
    expect(cmdIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeGreaterThan(cmdIdx);
    expect(r.displayText).toBe('/cmd补充说明');
  });
});
