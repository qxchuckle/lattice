import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  clearInitMetaPlatforms,
  readInitMeta,
  updateInitMetaPlatforms,
  writeInitMeta,
} from '../src/cache/init-meta';
import { createTempLatticeHome } from './helpers';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  await env.cleanup();
});

test('init-meta：写入/读取，部分 uninject 移除平台并保留注入时间', async () => {
  await writeInitMeta('1.2.3', ['cursor', 'claude-code'], 'en');
  const before = await readInitMeta();
  assert.ok(before);
  assert.deepEqual(before.platforms, ['cursor', 'claude-code']);

  await updateInitMetaPlatforms(['cursor']);
  const after = await readInitMeta();
  assert.ok(after);
  assert.deepEqual(after.platforms, ['claude-code']);
  assert.equal(after.injectedAt, before.injectedAt);
  assert.equal(after.language, 'en');
});

test('init-meta：平台清空时保留空记录（已 uninject），clear 幂等', async () => {
  await writeInitMeta('1.2.3', ['cursor'], 'zh');
  await updateInitMetaPlatforms(['cursor']);
  const cleared = await readInitMeta();
  assert.ok(cleared);
  assert.deepEqual(cleared.platforms, []);

  await clearInitMetaPlatforms();
  const afterClear = await readInitMeta();
  assert.ok(afterClear);
  assert.deepEqual(afterClear.platforms, []);
  assert.equal(afterClear.language, 'zh');
});
