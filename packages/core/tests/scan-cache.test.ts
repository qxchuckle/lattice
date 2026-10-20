import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readScanCache, shouldScan, writeScanCache } from '../src/cache/scan-cache';
import { createTempLatticeHome, putFile } from './helpers';
import { getCacheDir, join } from '../src/paths';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  await env.cleanup();
});

test('scan-cache：空/写入/读取/间隔判断', async () => {
  assert.equal(await readScanCache(), null);
  assert.equal(await shouldScan(), true);

  await writeScanCache({
    lastSuccessAt: new Date().toISOString(),
    lastScanDirs: ['/a'],
    lastResult: { added: 1, updated: 2 },
  });
  const cache = await readScanCache();
  assert.deepEqual(cache?.lastScanDirs, ['/a']);
  assert.equal(cache?.lastResult.added, 1);
  assert.equal(await shouldScan(), false);
  assert.equal(await shouldScan(0), true);

  await writeScanCache({
    lastSuccessAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastScanDirs: [],
    lastResult: { added: 0, updated: 0 },
  });
  assert.equal(await shouldScan(), true);
});

test('scan-cache：坏 JSON / 缺时间字段', async () => {
  await putFile(join(getCacheDir(), 'last-scan.json'), 'not json');
  assert.equal(await readScanCache(), null);
  assert.equal(await shouldScan(), true);

  await putFile(
    join(getCacheDir(), 'last-scan.json'),
    JSON.stringify({ lastScanDirs: [], lastResult: { added: 0, updated: 0 } }),
  );
  assert.equal(await shouldScan(), true);

  await putFile(
    join(getCacheDir(), 'last-scan.json'),
    JSON.stringify({
      lastSuccessAt: 'not-a-date',
      lastScanDirs: [],
      lastResult: { added: 0, updated: 0 },
    }),
  );
  assert.equal(await shouldScan(), false, '非法时间戳按不需要扫描处理');
});
