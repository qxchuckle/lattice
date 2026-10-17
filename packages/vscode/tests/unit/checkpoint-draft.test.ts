import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDraftContent,
  buildSummaryBody,
  firstHeading,
  parseCheckpointDraft,
} from '../../src/editor/checkpoint-draft-logic';

test('草稿构建 → 解析往返：字段保真（含中文 / 冒号）', () => {
  const content = buildDraftContent({
    taskId: 'task-abc123',
    type: 'note',
    title: '结论：需要保留多行',
    body: '第一段。\n\n第二段：\n- 要点 1\n- 要点 2',
  });
  assert.match(content, /^---\n/);
  assert.match(content, /lattice-checkpoint: true/);

  const parsed = parseCheckpointDraft(content);
  assert.ok(parsed);
  assert.equal(parsed?.taskId, 'task-abc123');
  assert.equal(parsed?.type, 'note');
  assert.equal(parsed?.title, '结论：需要保留多行');
  assert.match(parsed?.body ?? '', /第一段/);
  assert.match(parsed?.body ?? '', /第二段：/);
  assert.match(parsed?.body ?? '', /- 要点 2/);
});

test('解析非草稿：无 frontmatter / 缺标记 / YAML 损坏 → null', () => {
  assert.equal(parseCheckpointDraft('# 普通文档\n正文'), null);
  assert.equal(parseCheckpointDraft('---\ntitle: other\n---\n\n正文'), null);
  assert.equal(parseCheckpointDraft('---\n: : :\n---\n\n正文'), null);
  // 标记必须为 true（字符串 'yes' 不算）
  assert.equal(parseCheckpointDraft('---\nlattice-checkpoint: yes\n---\n'), null);
});

test('title 缺省兜底：正文首个一级标题', () => {
  assert.equal(firstHeading('说明\n\n# 真正的标题\n\n更多'), '真正的标题');
  assert.equal(firstHeading('## 二级不算'), undefined);
  const parsed = parseCheckpointDraft(
    '---\nlattice-checkpoint: true\ntask: t1\n---\n\n# 兜底标题\n',
  );
  assert.equal(parsed?.title, '');
  assert.equal(firstHeading(parsed?.body ?? ''), '兜底标题');
});

test('总结骨架：任务行 + 三段结构', () => {
  const body = buildSummaryBody({
    taskLine: '任务：X · 状态：active',
    sections: ['完成项', '遗留', '下一步'],
  });
  assert.match(body, /^> 任务：X/);
  assert.match(body, /## 完成项/);
  assert.match(body, /## 遗留/);
  assert.match(body, /## 下一步/);
});
