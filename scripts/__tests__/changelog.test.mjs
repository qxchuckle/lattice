import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACEHOLDER,
  groupCommits,
  insertVersionSection,
  readUnreleased,
  renderBody,
} from '../changelog.mjs';

test('groupCommits：按 Conventional Commits 类型归组，scope 加粗', () => {
  const groups = groupCommits([
    'feat(cli): 支持导出',
    'fix(core): 修复 X',
    'docs: 更新 README',
    'feat: 新增 Y',
  ]);

  assert.deepEqual(groups.get('Added'), ['**cli**: 支持导出', '新增 Y']);
  assert.deepEqual(groups.get('Fixed'), ['**core**: 修复 X']);
  assert.deepEqual(groups.get('Documentation'), ['更新 README']);
});

test('groupCommits：release 提交与内部类型不进 CHANGELOG', () => {
  const groups = groupCommits([
    'release: v1.2.3',
    'release: 1.2.4',
    'test(cli): 补测',
    'chore: 清理',
    'ci: 调整',
    'build: 构建',
    'style: 格式',
    '',
    '   ',
  ]);

  assert.equal(groups.size, 0);
});

test('groupCommits：未知类型与无类型标题归入 Changed', () => {
  const groups = groupCommits(['foo: bar', '随手提交一版']);

  assert.deepEqual(groups.get('Changed'), ['bar', '随手提交一版']);
});

test('renderBody：章节顺序固定为 Added / Changed / Fixed / Documentation', () => {
  const groups = new Map([
    ['Documentation', ['d1']],
    ['Fixed', ['f1']],
    ['Added', ['a1']],
  ]);

  assert.equal(
    renderBody(groups),
    [
      '### Added',
      '',
      '- a1',
      '',
      '### Fixed',
      '',
      '- f1',
      '',
      '### Documentation',
      '',
      '- d1',
    ].join('\n'),
  );
});

test('renderBody：没有条目时写占位', () => {
  assert.equal(renderBody(new Map()), PLACEHOLDER);
});

test('readUnreleased：空段、占位与真实内容分别处理', () => {
  assert.equal(readUnreleased('## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n').body, '');
  assert.equal(
    readUnreleased(`## [Unreleased]\n\n${PLACEHOLDER}\n\n## [1.0.0] - 2026-01-01\n`).body,
    '',
  );
  assert.equal(
    readUnreleased('## [Unreleased]\n\n### Added\n\n- a\n\n## [1.0.0] - 2026-01-01\n').body,
    '### Added\n\n- a',
  );
  assert.equal(readUnreleased('# Changelog 没有任何版本段').start, -1);
});

test('insertVersionSection：重置 Unreleased，并把新版本段插在最前', () => {
  const text =
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a\n\n## [1.0.0] - 2026-01-01\n\n- old\n';

  const next = insertVersionSection(text, {
    version: '1.1.0',
    date: '2026-02-02',
    body: '### Added\n\n- b',
  });

  assert.equal(
    next,
    '# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-02-02\n\n### Added\n\n- b\n\n## [1.0.0] - 2026-01-01\n\n- old\n',
  );
});

test('insertVersionSection：缺少 [Unreleased] 时抛错', () => {
  assert.throws(
    () =>
      insertVersionSection('# Changelog\n', { version: '1.0.0', date: '2026-01-01', body: 'x' }),
    /Unreleased/,
  );
});
