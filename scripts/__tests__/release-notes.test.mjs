import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildReleaseBody, normalizeVersion, readChangelogSection } from '../release-notes.mjs';

const root = resolve(import.meta.dirname, '..', '..');

test('normalizeVersion：v 前缀可有可无', () => {
  assert.equal(normalizeVersion('v1.29.0'), '1.29.0');
  assert.equal(normalizeVersion('1.29.0'), '1.29.0');
});

test('readChangelogSection：只取当前版本段，不吃掉下一段', () => {
  const section = readChangelogSection('1.29.0');

  assert.match(section, /## \[1\.29\.0\]/);
  assert.match(section, /Project and task groups/);
  assert.doesNotMatch(section, /## \[1\.28\.1\]/);
  assert.equal(readChangelogSection('9.9.9'), '');
});

test('buildReleaseBody：含安装命令、包表与站点链接', () => {
  const body = buildReleaseBody('v1.29.0');

  assert.match(body, /npm i -g @qcqx\/lattice-cli/);
  assert.match(
    body,
    /@qcqx\/lattice-cli\]\(https:\/\/www\.npmjs\.com\/package\/@qcqx\/lattice-cli\) \| 1\.29\.0/,
  );
  assert.match(body, /lattice\.qcqx\.cn\/demo/);
  assert.doesNotMatch(body, /not released/);
});

test('buildReleaseBody：CHANGELOG 缺段时写占位，并把未发布的包标出来', () => {
  const body = buildReleaseBody('9.9.9');

  assert.match(body, /No curated notes for this tag/);
  assert.equal(body.match(/not released/g)?.length, 3, '三个包都不该声称是 9.9.9');
});

test('buildReleaseBody：带附件时给出文件名、大小与 sha256', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const file = join(dir, 'lattice-context-0.4.2.vsix');
  writeFileSync(file, 'fake-vsix-binary');

  const body = buildReleaseBody('v1.29.0', file);
  const sha256 = createHash('sha256').update('fake-vsix-binary').digest('hex');

  assert.match(body, /## 附件 · Assets/);
  assert.match(body, /lattice-context-0\.4\.2\.vsix/);
  assert.ok(body.includes(sha256), '正文应带该附件的 sha256');
  assert.match(body, /code --install-extension lattice-context-0\.4\.2\.vsix/);
});

test('CLI：按 <tag> --out --asset 写出正文文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-cli-'));
  const asset = join(dir, 'lattice-context-0.4.2.vsix');
  const out = join(dir, 'notes.md');
  writeFileSync(asset, 'fake-vsix-binary');

  execFileSync(
    process.execPath,
    ['scripts/release-notes.mjs', 'v1.29.0', '--out', out, '--asset', asset],
    { cwd: root, encoding: 'utf8' },
  );

  const written = readFileSync(out, 'utf-8');
  assert.match(written, /## \[1\.29\.0\]/);
  assert.match(written, /## 附件 · Assets/);
  assert.ok(written.includes(createHash('sha256').update('fake-vsix-binary').digest('hex')));
});

test('CLI：缺参数时以非 0 退出', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, ['scripts/release-notes.mjs', 'v1.29.0'], {
        cwd: root,
        stdio: 'pipe',
      }),
    (error) => error.status === 2,
  );
});
