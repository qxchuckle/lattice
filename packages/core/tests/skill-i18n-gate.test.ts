import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'check-skill-i18n.mjs',
);
const roots: string[] = [];

async function put(root: string, path: string, content: string): Promise<void> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lattice-i18n-gate-'));
  roots.push(root);
  await put(
    root,
    'templates/languages.json',
    JSON.stringify({ supportedLanguages: ['zh', 'en'], defaultLanguage: 'zh' }),
  );
  await put(
    root,
    'templates/skills/zh/a.md',
    '# 标题\n\n## 小节\n\n[链接](b.md) `ltc task list --json`\n',
  );
  await put(
    root,
    'templates/skills/en/a.md',
    '# Title\n\n## Section\n\n[link](b.md) `ltc task list --json`\n',
  );
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf-8' });
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test('skill i18n gate：结构/链接/命令 token 一致时通过', async () => {
  const root = await makeRoot();
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /门禁通过/);
});

test('skill i18n gate：命令 token 缺失 / 标题结构漂移 / 文件缺失均报错', async () => {
  const root = await makeRoot();
  await put(root, 'templates/skills/en/a.md', '# Title\n\n[link](b.md) `ltc task list`\n');
  let result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /命令\/选项 token 不一致/);
  assert.match(result.stderr, /标题层级序列不一致/);

  await put(
    root,
    'templates/skills/en/a.md',
    '# Title\n\n## Section\n\n[link](b.md) `ltc task list --json`\n',
  );
  await rm(join(root, 'templates/skills/en/a.md'));
  result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少 a.md/);
});

test('skill i18n gate：英文包正文含中文会报错，frontmatter 中文不报', async () => {
  const root = await makeRoot();
  await put(
    root,
    'templates/skills/en/a.md',
    '---\nname: a\ndescription: Title 中文触发词\n---\n\n# Title\n\n这是中文正文\n',
  );
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CJK 比例/);
});
