import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { appendSyncLog, getSyncLogPath, readSyncLog } from '../src/sync/log';
import { validateSpecScope, validateSpecsScope } from '../src/spec/validate';
import { createTempLatticeHome, putFile } from './helpers';
import type { ParsedSpec } from '../src/types';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  await env.cleanup();
});

test('sync log：追加/读取/limit/坏行隔离/缺失文件', async () => {
  assert.deepEqual(await readSyncLog('origin'), []);
  const entry = (message: string) => ({
    at: '2026-01-01T00:00:00.000Z',
    target: 'origin',
    action: 'pull' as const,
    status: 'ok' as const,
    message,
  });
  await appendSyncLog(entry('one'));
  await appendSyncLog({ ...entry('two'), detail: { files: 2 } });
  await appendSyncLog({ ...entry('three'), action: 'push', status: 'error' });

  const all = await readSyncLog('origin');
  assert.deepEqual(
    all.map((e) => e.message),
    ['one', 'two', 'three'],
  );
  assert.deepEqual(all[1].detail, { files: 2 });
  assert.equal(all[2].status, 'error');
  assert.deepEqual(
    (await readSyncLog('origin', 1)).map((e) => e.message),
    ['three'],
  );

  // 损坏行隔离
  const path = getSyncLogPath('origin');
  const raw = (await import('node:fs/promises')).readFile(path, 'utf-8');
  await putFile(path, `${await raw}\nnot json\n`);
  assert.equal((await readSyncLog('origin')).length, 3);

  assert.deepEqual(await readSyncLog('missing'), []);
  assert.match(getSyncLogPath('abc'), /sync-log\/abc\.jsonl$/);
});

function spec(content: string, title = 'T'): ParsedSpec {
  return {
    filePath: '/x.md',
    relativePath: 'x.md',
    fileName: 'x.md',
    content,
    frontmatter: { id: 'spec-x', title },
  };
}

test('validateSpecScope：适用范围声明与 user/global 文案', () => {
  assert.equal(validateSpecScope(spec('# T\n\n## 适用范围\n\n适用于所有项目'), 'global'), null);
  assert.equal(validateSpecScope(spec('## 适用范围（重要）'), 'user'), null);
  assert.equal(validateSpecScope(spec('### 适用范围'), 'user'), null);
  assert.equal(validateSpecScope(spec('#### 适用范围'), 'user')?.type, 'missing-scope');
  assert.equal(validateSpecScope(spec('## Scope\n\nApplies to all projects'), 'global'), null);
  assert.equal(validateSpecScope(spec('### Scope (important)'), 'user'), null);
  assert.equal(validateSpecScope(spec('## scope'), 'user'), null);
  assert.equal(validateSpecScope(spec('#### Scope'), 'user')?.type, 'missing-scope');
  assert.equal(validateSpecScope(spec('## Scoped'), 'user')?.type, 'missing-scope');

  const user = validateSpecScope(spec('body', '用户规范'), 'user');
  assert.equal(user?.type, 'missing-scope');
  assert.match(user?.message ?? '', /用户级 spec「用户规范」/);
  assert.match(user?.message ?? '', /## 适用范围/);
  assert.equal(user?.spec.frontmatter.id, 'spec-x');

  const global = validateSpecScope(spec('body'), 'global');
  assert.match(global?.message ?? '', /全局级 spec「T」/);

  // 无标题时回落文件名
  const noTitle = validateSpecScope({ ...spec('body'), frontmatter: { id: 's' } }, 'global');
  assert.match(noTitle?.message ?? '', /全局级 spec「x\.md」/);

  const warnings = validateSpecsScope(
    [spec('body', 'A'), spec('## 适用范围', 'B'), spec('body', 'C')],
    'user',
  );
  assert.deepEqual(
    warnings.map((w) => w.spec.frontmatter.title),
    ['A', 'C'],
  );
  assert.deepEqual(validateSpecsScope([], 'global'), []);
});
