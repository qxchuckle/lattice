import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { classifyLatticePath } from '../../src/state/watcher';

const ROOT = path.sep === '/' ? '/home/u/.lattice' : 'C:\\home\\u\\.lattice';
const j = (...parts: string[]) => path.join(ROOT, ...parts);

test('users/<u>/tasks/** → tasks', () => {
  assert.deepEqual(classifyLatticePath(ROOT, j('users', 'qcqx', 'tasks', 't1', 'prd.md')), [
    'tasks',
  ]);
});

test('users/<u>/spec/** → specs', () => {
  assert.deepEqual(classifyLatticePath(ROOT, j('users', 'qcqx', 'spec', 'a.md')), ['specs']);
});

test('users/<u>/fast-tasks/** → 忽略', () => {
  assert.deepEqual(classifyLatticePath(ROOT, j('users', 'qcqx', 'fast-tasks', 'log-1.yaml')), []);
});

test('项目 spec 变更 → specs + projects', () => {
  assert.deepEqual(
    classifyLatticePath(ROOT, j('users', 'qcqx', 'projects', 'p1', 'spec', 'x.md')),
    ['specs', 'projects'],
  );
});

test('project.json 变更 → projects', () => {
  assert.deepEqual(
    classifyLatticePath(ROOT, j('users', 'qcqx', 'projects', 'p1', 'project.json')),
    ['projects'],
  );
});

test('全局 spec 目录 → specs', () => {
  assert.deepEqual(classifyLatticePath(ROOT, j('spec', 'global.md')), ['specs']);
});

test('.trash → tasks + projects + specs', () => {
  assert.deepEqual(classifyLatticePath(ROOT, j('.trash', 'x', 'content')), [
    'tasks',
    'projects',
    'specs',
  ]);
});

test('config → user + projects + tasks + specs', () => {
  assert.deepEqual(classifyLatticePath(ROOT, j('config', 'config.json')), [
    'user',
    'projects',
    'tasks',
    'specs',
  ]);
});

test('.cache / .sync-domains / 根外路径 → 忽略', () => {
  assert.deepEqual(classifyLatticePath(ROOT, j('.cache', 'lattice.db')), []);
  assert.deepEqual(classifyLatticePath(ROOT, j('.sync-domains', 'abc', 'x')), []);
  assert.deepEqual(classifyLatticePath(ROOT, path.join('/tmp', 'elsewhere')), []);
});
