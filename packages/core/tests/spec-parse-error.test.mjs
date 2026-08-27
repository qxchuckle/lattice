import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  parseSpec,
  parseFrontmatter,
  writeSpec,
  lintSpecFrontmatter,
  lintSpecs,
  migrateSpecs,
  getUserSpecs,
  addSpecRefs,
  formatSpecParseError,
} from '../dist/index.mjs';
import { createTempLatticeHome, putFile } from './helpers.mjs';

// 坏 YAML 隔离：单个 spec frontmatter 语法错误不阻塞同目录其他 spec 的加载，
// 且 parseError 携带 js-yaml 定位（line = 文件内绝对行号）；写回类操作
// （migrate 自愈 backfill）跳过坏文件避免重建 frontmatter 丢失原内容。

const U = 't';

// 折叠块标量基准缩进 2、某行 1 空格（真实事故形态）；坏行为文件第 6 行
const BAD_SPEC = [
  '---',
  'id: spec-aaaaaaaa',
  'title: bad',
  'description: >-',
  '  line1',
  ' line2', // 坏行：1 空格 < 基准 2 空格
  '---',
  '# body',
  '',
].join('\n');

const GOOD_SPEC = [
  '---',
  'id: spec-bbbbbbbb',
  'title: good',
  'updated: ' + new Date().toISOString(),
  '---',
  '# good body',
  '',
].join('\n');

let env;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
  );
});

afterEach(async () => {
  await env.cleanup();
});

test('parseSpec：坏 YAML 返回 parseError 且不抛出', async () => {
  const badPath = join(env.latticeHome, 'users', U, 'spec', 'bad.md');
  await putFile(badPath, BAD_SPEC);

  const spec = await parseSpec(badPath);
  assert.ok(spec, '应返回 ParsedSpec 而非 null');
  assert.ok(spec.parseError, '应携带 parseError');
  assert.equal(spec.parseError.message, 'All mapping items must start at the same column');
  assert.equal(spec.parseError.line, 6, 'line 应为文件内绝对行号');
  assert.equal(spec.parseError.column, 1);
  assert.deepEqual(spec.frontmatter, {}, 'frontmatter 应为空对象');
  assert.equal(spec.content, '# body', '正文应被切出保留');
});

test('parseSpec：正常文件不受影响', async () => {
  const goodPath = join(env.latticeHome, 'users', U, 'spec', 'good.md');
  await putFile(goodPath, GOOD_SPEC);

  const spec = await parseSpec(goodPath);
  assert.ok(spec);
  assert.equal(spec.parseError, undefined);
  assert.equal(spec.frontmatter.id, 'spec-bbbbbbbb');
});

test('parseFrontmatter：空围栏 ---\\n---\\n 与 gray-matter 行为对齐', () => {
  const r = parseFrontmatter('---\n---\nbody\n');
  assert.deepEqual(r.frontmatter, {});
  assert.equal(r.parseError, undefined);
  assert.equal(r.content, 'body');
});

test('parseFrontmatter：闭合围栏尾随空格仍可解析', () => {
  const r = parseFrontmatter('---\nid: spec-aaaaaaaa\n--- \nbody\n');
  assert.equal(r.parseError, undefined);
  assert.equal(r.frontmatter.id, 'spec-aaaaaaaa');
  assert.equal(r.content, 'body');
});

test('parseFrontmatter：块标量内的缩进 --- 行不误切围栏', () => {
  const r = parseFrontmatter('---\ndescription: |-\n  ---\n  not a fence\n  more\n---\nbody\n');
  assert.equal(r.parseError, undefined);
  assert.equal(r.frontmatter.description, '---\nnot a fence\nmore');
  assert.equal(r.content, 'body');
});

test('parseFrontmatter：无围栏文件整体作为正文', () => {
  const r = parseFrontmatter('# 只有正文\n');
  assert.deepEqual(r.frontmatter, {});
  assert.equal(r.parseError, undefined);
  assert.equal(r.content, '# 只有正文');
});

test('lintSpecFrontmatter：parseError 报单条 error，跳过字段级校验', async () => {
  const badPath = join(env.latticeHome, 'users', U, 'spec', 'bad.md');
  await putFile(badPath, BAD_SPEC);
  const spec = await parseSpec(badPath);

  const report = lintSpecFrontmatter(spec);
  assert.equal(report.ok, false);
  assert.equal(report.issues.length, 1, '应只有一条 YAML error，不叠加字段缺失噪音');
  assert.equal(report.issues[0].severity, 'error');
  assert.equal(report.issues[0].field, 'frontmatter');
  assert.match(report.issues[0].message, /All mapping items must start at the same column/);
  assert.match(report.issues[0].message, /第 6 行/);
});

test('lintSpecs：好文件 + 坏文件混合不抛错，坏文件 ok=false', async () => {
  const specDir = join(env.latticeHome, 'users', U, 'spec');
  await putFile(join(specDir, 'bad.md'), BAD_SPEC);
  await putFile(join(specDir, 'good.md'), GOOD_SPEC);

  const specs = await getUserSpecs(U);
  assert.equal(specs.length, 2, '坏文件不应阻塞同目录其他 spec 加载');
  const reports = lintSpecs(specs);
  const byOk = Object.fromEntries(reports.map((r) => [r.ok, r]));
  assert.ok(byOk.false, '坏文件 lint 不通过');
  assert.ok(byOk.true, '好文件 lint 通过');
});

test('migrateSpecs：坏文件进 errors 不进 migrated，且文件内容不被改写', async () => {
  const specDir = join(env.latticeHome, 'users', U, 'spec');
  const badPath = join(specDir, 'bad.md');
  await putFile(badPath, BAD_SPEC);
  await putFile(join(specDir, 'good.md'), GOOD_SPEC);

  const result = await migrateSpecs({ scope: 'user' });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].filePath, badPath);
  assert.match(result.errors[0].message, /YAML 解析失败/);
  assert.equal(
    result.migrated.some((m) => m.filePath === badPath),
    false,
    '坏文件不得进入 migrated',
  );

  // 防数据丢失：坏文件必须原样保留（writeSpec 重建会丢整个 frontmatter）
  const after = await readFile(badPath, 'utf-8');
  assert.equal(after, BAD_SPEC);
});

test('writeSpec → parseSpec 往返：frontmatter 保真、content 一字不改', async () => {
  const specDir = join(env.latticeHome, 'users', U, 'spec');
  const filePath = join(specDir, 'roundtrip.md');
  const fm = {
    title: '往返测试',
    description: '多行 description\n第二行',
    tags: ['a', 'b'],
    updated: '2026-08-27T00:00:00.000Z',
  };
  const content = '# 标题\n\n正文段落，一字不改。';
  await writeSpec(filePath, fm, content);

  const reread = await parseSpec(filePath);
  assert.equal(reread.parseError, undefined);
  assert.equal(reread.frontmatter.title, fm.title);
  assert.equal(reread.frontmatter.description, fm.description);
  assert.deepEqual(reread.frontmatter.tags, fm.tags);
  // updated 被 normalize 刷新为当前时刻，仅验证类型与可解析性
  assert.equal(typeof reread.frontmatter.updated, 'string');
  assert.equal(reread.content, content);
  assert.ok(reread.frontmatter.id, 'id 应被自动补全');
});

test('formatSpecParseError：输出原因 + 行列位置', () => {
  const text = formatSpecParseError({
    message: 'boom',
    line: 3,
    column: 5,
  });
  assert.match(text, /boom/);
  assert.match(text, /第 3 行，第 5 列/);
});

test('addSpecRefs：坏 YAML 的 spec 拒绝自愈 backfill，文件不被改写', async () => {
  const specDir = join(env.latticeHome, 'users', U, 'spec');
  const badPath = join(specDir, 'bad.md');
  await putFile(badPath, BAD_SPEC);

  // 最小 task.json（getTaskMeta 仅 readJSON + normalize，字段透传）
  const taskId = '2026-08-27-test';
  await putFile(
    join(env.latticeHome, 'users', U, 'tasks', taskId, 'task.json'),
    JSON.stringify({ id: taskId, title: '测试任务', status: 'in-progress' }),
  );

  const result = await addSpecRefs(U, taskId, ['bad.md']);
  assert.equal(result.added.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /YAML 解析失败/);

  // 防数据丢失：坏文件必须原样保留
  const after = await readFile(badPath, 'utf-8');
  assert.equal(after, BAD_SPEC);
});
