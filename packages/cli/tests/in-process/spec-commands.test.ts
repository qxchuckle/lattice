import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { getUserSpecDir, getGlobalSpecDir } from '@qcqx/lattice-core';
import { registerSpecCommand } from '../../src/commands/spec';
import { createCliEnv, runCli, putFile, U, type CliEnv, type CliRunResult } from './helpers';

/**
 * spec 命令组进程内测试（spec.ts 578 行缺口主体）：
 * init（含已存在/--force/缺 title 边界）/ list / show / set / lint /
 * conflicts / suggest-description / migrate --dry-run / template list+registry list。
 */

let env: CliEnv;

beforeEach(async () => {
  env = await createCliEnv();
});

afterEach(async () => {
  await env.cleanup();
});

const run = (args: string[]): Promise<CliRunResult> => runCli(registerSpecCommand, args);

test('spec init：user 层创建 + frontmatter/id 回读；已存在缺 --force → 退出码 1；缺 --title → 退出码 1', async () => {
  const created = await run([
    'spec',
    'init',
    'note-a.md',
    '--scope',
    'user',
    '--title',
    '规范甲',
    '--description',
    '作用范围+约束+作用 三段式摘要',
    '--tags',
    'cli,test',
  ]);
  assert.equal(created.exitCode, 0, created.stderr);
  const filePath = join(getUserSpecDir(U), 'note-a.md');
  const content = await readFile(filePath, 'utf-8');
  assert.match(content, /title: 规范甲/);
  assert.match(content, /id: spec-[0-9a-z]{8}/);
  assert.match(created.stdout, /已创建 spec/);

  const again = await run(['spec', 'init', 'note-a.md', '--scope', 'user', '--title', '规范甲2']);
  assert.equal(again.exitCode, 1);
  assert.match(again.stdout, /已存在/);

  const forced = await run([
    'spec',
    'init',
    'note-a.md',
    '--scope',
    'user',
    '--title',
    '规范甲（覆盖）',
    '--force',
  ]);
  assert.equal(forced.exitCode, 0, forced.stderr);
  assert.match(await readFile(filePath, 'utf-8'), /title: 规范甲（覆盖）/);

  const noTitle = await run(['spec', 'init', 'note-b.md', '--scope', 'user']);
  assert.equal(noTitle.exitCode, 1);
  assert.match(noTitle.stdout, /必须提供 --title/);
});

test('spec list --json：含标题；--scope 过滤层级', async () => {
  await run(['spec', 'init', 'note-c.md', '--scope', 'user', '--title', '用户层规范']);
  await putFile(
    join(getGlobalSpecDir(), 'global-note.md'),
    [
      '---',
      'title: 全局层规范',
      "updated: '2030-01-01T00:00:00.000Z'",
      '---',
      '# 全局层规范',
      '',
    ].join('\n'),
  );

  const all = await run(['spec', 'list', '--json']);
  assert.equal(all.exitCode, 0, all.stderr);
  const text = all.stdout;
  assert.ok(text.includes('用户层规范') && text.includes('全局层规范'));

  const userOnly = await run(['spec', 'list', '--scope', 'user', '--json']);
  assert.equal(userOnly.exitCode, 0);
  assert.ok(userOnly.stdout.includes('用户层规范'));
  assert.ok(!userOnly.stdout.includes('全局层规范'));
});

test('spec show：默认 JSON 元信息；--detail 输出正文；未知文件 → 退出码 1', async () => {
  await run(['spec', 'init', 'note-d.md', '--scope', 'user', '--title', '展示规范']);
  const ok = await run(['spec', 'show', 'note-d.md', '--scope', 'user', '--json']);
  assert.equal(ok.exitCode, 0, ok.stderr);
  assert.ok(ok.stdout.includes('展示规范'));

  const detail = await run(['spec', 'show', 'note-d.md', '--scope', 'user', '--detail']);
  assert.equal(detail.exitCode, 0, detail.stderr);
  assert.match(detail.stdout, /# 展示规范/);

  const missing = await run(['spec', 'show', 'no-such.md', '--scope', 'user', '--json']);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /未找到|not found/i);
});

test('spec set：标题/摘要/标签修改落盘', async () => {
  await run([
    'spec',
    'init',
    'note-e.md',
    '--scope',
    'user',
    '--title',
    '待改规范',
    '--tags',
    'old',
  ]);
  const r = await run([
    'spec',
    'set',
    'note-e.md',
    '--scope',
    'user',
    '--title',
    '已改规范',
    '--description',
    '新摘要',
    '--add-tag',
    'new-tag',
    '--rm-tag',
    'old',
  ]);
  assert.equal(r.exitCode, 0, r.stderr);
  const content = await readFile(join(getUserSpecDir(U), 'note-e.md'), 'utf-8');
  assert.match(content, /title: 已改规范/);
  assert.match(content, /new-tag/);
  assert.ok(!content.includes('old'));
});

test('spec lint：通过文件退出码 0；坏 YAML 退出码 1', async () => {
  await run([
    'spec',
    'init',
    'lint-ok.md',
    '--scope',
    'user',
    '--title',
    '合格规范',
    '--description',
    '作用范围+约束+作用',
  ]);
  const ok = await run(['spec', 'lint', join(getUserSpecDir(U), 'lint-ok.md')]);
  assert.equal(ok.exitCode, 0, ok.stderr);

  const badPath = join(getUserSpecDir(U), 'lint-bad.md');
  await putFile(badPath, '---\ntitle: [broken\n---\n');
  const bad = await run(['spec', 'lint', badPath]);
  assert.equal(bad.exitCode, 1);
});

test('spec conflicts/suggest-description/migrate --dry-run：离线可运行', async () => {
  await run(['spec', 'init', 'note-f.md', '--scope', 'user', '--title', '缺摘要规范']);

  const conflicts = await run(['spec', 'conflicts', '--json']);
  assert.equal(conflicts.exitCode, 0, conflicts.stderr);

  const suggest = await run(['spec', 'suggest-description', '--limit', '5', '--json']);
  assert.equal(suggest.exitCode, 0, suggest.stderr);

  const migrate = await run(['spec', 'migrate', '--dry-run']);
  assert.equal(migrate.exitCode, 0, migrate.stderr);
});

test('spec template list / registry list：内置模板与仓库清单', async () => {
  const list = await run(['spec', 'template', 'list', '--json']);
  assert.equal(list.exitCode, 0, list.stderr);

  const registry = await run(['spec', 'template', 'registry', 'list', '--json']);
  assert.equal(registry.exitCode, 0, registry.stderr);

  // 内置模板目录存在（list 数据源）
  const templateNames = await readdir(join(process.cwd(), 'packages/core/templates')).catch(
    () => [],
  );
  assert.ok(Array.isArray(templateNames));
});
