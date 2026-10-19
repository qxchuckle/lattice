import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  sortProjectsForSpecPick,
  specCreateArgsFromTreeArg,
} from '../../src/commands/spec-create-logic';

test('树节点入口：项目分组 / 用户级 / 全局级 / 项目级分区根 → 预置 scope', () => {
  assert.deepEqual(
    specCreateArgsFromTreeArg({ lattice: { kind: 'specProjectGroup', projectId: 'p1' } }),
    { scope: 'project', projectId: 'p1' },
  );
  assert.deepEqual(
    specCreateArgsFromTreeArg({ lattice: { kind: 'group', groupId: 'spec-user' } }),
    {
      scope: 'user',
    },
  );
  assert.deepEqual(
    specCreateArgsFromTreeArg({ lattice: { kind: 'group', groupId: 'spec-global' } }),
    { scope: 'global' },
  );
  assert.deepEqual(
    specCreateArgsFromTreeArg({ lattice: { kind: 'group', groupId: 'spec-project' } }),
    { scope: 'project' },
  );
});

test('树节点入口：无关 payload / 缺 projectId / 程序化参数 → undefined', () => {
  assert.equal(
    specCreateArgsFromTreeArg({ lattice: { kind: 'group', groupId: 'conflicts' } }),
    undefined,
  );
  assert.equal(specCreateArgsFromTreeArg({ lattice: { kind: 'specProjectGroup' } }), undefined);
  assert.equal(specCreateArgsFromTreeArg({ scope: 'user' }), undefined);
  assert.equal(specCreateArgsFromTreeArg('lattice.spec.create'), undefined);
  assert.equal(specCreateArgsFromTreeArg(undefined), undefined);
  assert.equal(specCreateArgsFromTreeArg(null), undefined);
});

test('项目选择排序：当前项目置顶，其余按名称升序；不修改入参', () => {
  const projects = [
    { id: 'z', name: 'Zeta' },
    { id: 'm', name: null },
    { id: 'a', name: 'Alpha' },
  ];
  assert.deepEqual(
    sortProjectsForSpecPick(projects, 'm').map((p) => p.id),
    ['m', 'a', 'z'],
  );
  assert.deepEqual(
    sortProjectsForSpecPick(projects).map((p) => p.id),
    ['a', 'm', 'z'],
  );
  assert.deepEqual(
    projects.map((p) => p.id),
    ['z', 'm', 'a'],
  );
});
