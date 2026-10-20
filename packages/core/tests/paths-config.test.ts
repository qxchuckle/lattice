import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  findAllUpwards,
  findUpwards,
  getFileMtime,
  getLatticeRoot,
  getTemplateRegistriesDir,
  homeToTilde,
  setLatticeRootOverride,
} from '../src/paths';
import {
  deepEqual,
  deleteByPath,
  diffConfig,
  getByPath,
  isPlainObject,
  setByPath,
} from '../src/config/utils';
import { createTempLatticeHome, putFile } from './helpers';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  setLatticeRootOverride(null);
  await env.cleanup();
});

test('paths：root override / tilde / templates / mtime', async () => {
  assert.equal(getLatticeRoot(), env.latticeHome);
  setLatticeRootOverride('/tmp/override');
  assert.equal(getLatticeRoot(), '/tmp/override');
  setLatticeRootOverride('   ');
  assert.equal(getLatticeRoot(), env.latticeHome);
  setLatticeRootOverride(null);

  assert.equal(homeToTilde(join(homedir(), 'a', 'b')), '~/a/b');
  assert.equal(homeToTilde('/other/path'), '/other/path');
  assert.match(getTemplateRegistriesDir(), /templates\/registries$/);

  const file = join(env.tmpRoot, 'mtime.txt');
  await putFile(file, 'x');
  assert.equal(typeof (await getFileMtime(file)), 'number');
  assert.equal(await getFileMtime(join(env.tmpRoot, 'missing')), null);
});

test('paths：findUpwards / findAllUpwards', async () => {
  const a = join(env.tmpRoot, 'up', 'a');
  const b = join(a, 'b');
  const c = join(b, 'c');
  await mkdir(c, { recursive: true });
  await putFile(join(a, '.marker'), 'a');
  await putFile(join(env.tmpRoot, 'up', '.marker'), 'up');

  assert.equal(await findUpwards('.marker', c), a);
  assert.equal(await findUpwards('.marker', a), a);
  assert.equal(await findUpwards('nope', c), null);

  assert.deepEqual(await findAllUpwards('.marker', c), [a, join(env.tmpRoot, 'up')]);
  assert.deepEqual(await findAllUpwards('.marker', a), [join(env.tmpRoot, 'up')]);
  assert.deepEqual(await findAllUpwards('nope', c), []);
});

test('config/utils：get/set/delete/deepEqual/isPlainObject/diff', () => {
  const obj: Record<string, unknown> = { a: { b: 1 }, keep: true };
  assert.equal(getByPath(obj, 'a.b'), 1);
  assert.equal(getByPath(obj, 'a.c'), undefined);
  assert.equal(getByPath(obj, 'x.y.z'), undefined);

  setByPath(obj, 'a.c', 2);
  assert.equal(getByPath(obj, 'a.c'), 2);
  setByPath(obj, 'x.y', 3);
  assert.deepEqual(getByPath(obj, 'x.y'), 3);
  setByPath(obj, 'arr', [1]);
  setByPath(obj, 'arr.child', 4); // 数组被视为非对象 → 替换为对象
  assert.deepEqual(getByPath(obj, 'arr'), { child: 4 });

  assert.equal(deleteByPath(obj, 'a.c'), true);
  assert.equal(getByPath(obj, 'a.c'), undefined);
  assert.equal(deleteByPath(obj, 'a.c'), false);
  assert.equal(deleteByPath(obj, 'keep.child'), false);

  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject('x'), false);

  assert.equal(deepEqual(1, 1), true);
  assert.equal(deepEqual([1, 2], [1, 2]), true);
  assert.equal(deepEqual([1, 2], [1]), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual({ a: { b: 2 } }, { a: { b: 2 } }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual(1, '1'), false);

  const defaults = { a: 1, nested: { x: 1, y: 2 }, arr: [1] };
  assert.deepEqual(diffConfig({ a: 1, nested: { x: 9, y: 2 }, arr: [1, 2] }, defaults), {
    nested: { x: 9 },
    arr: [1, 2],
  });
  assert.deepEqual(diffConfig({ a: 2, extra: undefined, nested: { x: 1 } }, defaults), {
    a: 2,
  });
});
