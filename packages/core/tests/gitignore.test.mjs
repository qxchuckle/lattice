import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GITIGNORE_SECTIONS,
  renderGitignoreSections,
  computeMissingGitignoreSections,
  ensureGitignore,
} from '../dist/index.mjs';

// S1：gitignore 段单一来源（core/maintenance/gitignore.ts）
// 纯路径函数测试，不涉及 LATTICE_HOME；用独立 tmp 目录。

async function tempFile(name) {
  const dir = await mkdtemp(join(tmpdir(), 'lattice-gi-'));
  return { dir, path: join(dir, name) };
}

test('GITIGNORE_SECTIONS 含 v3 必需段', () => {
  const patterns = GITIGNORE_SECTIONS.flatMap((s) => s.entries.map((e) => e.pattern));
  assert.ok(patterns.includes('.trash/'), '缺 .trash/ 段');
  assert.ok(patterns.includes('models/'), '缺 models/ 段');
  assert.ok(patterns.includes('.sync-domains/'), '缺 .sync-domains/ 段');
  assert.ok(patterns.includes('config/config-local.json'), '缺本机配置段');
  assert.ok(patterns.includes('.cache/'), '缺缓存段');
});

test('renderGitignoreSections 输出含标题与全部 pattern', () => {
  const text = renderGitignoreSections(GITIGNORE_SECTIONS);
  for (const section of GITIGNORE_SECTIONS) {
    assert.ok(text.includes(`# ${section.title}`), `缺标题：${section.title}`);
    for (const entry of section.entries) {
      assert.ok(text.includes(entry.pattern), `缺 pattern：${entry.pattern}`);
    }
  }
});

test('computeMissingGitignoreSections：空内容 → 全部缺失', () => {
  const missing = computeMissingGitignoreSections('');
  assert.equal(missing.length, GITIGNORE_SECTIONS.length);
});

test('computeMissingGitignoreSections：完整内容 → 零缺失', () => {
  const full = renderGitignoreSections(GITIGNORE_SECTIONS);
  assert.equal(computeMissingGitignoreSections(full).length, 0);
});

test('computeMissingGitignoreSections：部分内容 → 恰缺对应段', () => {
  // 只有段 0 的内容 → 恰缺其余全部段
  const partial = renderGitignoreSections([GITIGNORE_SECTIONS[0]]);
  const missing = computeMissingGitignoreSections(partial);
  assert.equal(missing.length, GITIGNORE_SECTIONS.length - 1);
  assert.ok(!missing.some((s) => s.title === GITIGNORE_SECTIONS[0].title), '已覆盖段不应再缺');
});

test('computeMissingGitignoreSections：语义等价模式也算覆盖（cache 无尾斜杠）', () => {
  const equivalent = GITIGNORE_SECTIONS.map((s) => s.entries.map((e) => e.pattern).join('\n')).join(
    '\n',
  );
  assert.equal(
    computeMissingGitignoreSections(equivalent).length,
    0,
    '逐 pattern 原样内容应全覆盖',
  );
});

test('ensureGitignore：文件不存在 → 创建完整内容', async () => {
  const { path, dir } = await tempFile('.gitignore');
  try {
    await ensureGitignore(path);
    const content = await readFile(path, 'utf-8');
    assert.ok(content.includes('.sync-domains/'));
    assert.equal(computeMissingGitignoreSections(content).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ensureGitignore：缺段追加 + 幂等（跑两遍内容不变）', async () => {
  const { path, dir } = await tempFile('.gitignore');
  try {
    // 先写只有一段的旧文件
    const legacy = renderGitignoreSections([GITIGNORE_SECTIONS[0]]);
    await (await import('node:fs/promises')).writeFile(path, legacy, 'utf-8');

    await ensureGitignore(path);
    const once = await readFile(path, 'utf-8');
    assert.equal(computeMissingGitignoreSections(once).length, 0, '第一遍后应全覆盖');
    assert.ok(once.includes(`# ${GITIGNORE_SECTIONS[0].title}`), '旧内容保留');

    await ensureGitignore(path);
    const twice = await readFile(path, 'utf-8');
    assert.equal(once, twice, '第二遍应幂等，内容不变');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ensureGitignore：空文件 → 覆盖为完整内容', async () => {
  const { path, dir } = await tempFile('.gitignore');
  try {
    const fs = await import('node:fs/promises');
    await fs.writeFile(path, '\n  \n', 'utf-8');
    await ensureGitignore(path);
    const content = await readFile(path, 'utf-8');
    assert.ok(content.includes('# Lattice 本机配置'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
