import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isValidEntityRef, planDrop } from '../../src/views/dnd-logic';

const task = (id: string) => ({ kind: 'task' as const, id });
const spec = (id: string) => ({ kind: 'spec' as const, id });

test('任务 → 项目：associate（去重、保序）', () => {
  const plan = planDrop({ kind: 'project', id: 'alpha' }, [task('t1'), task('t2'), task('t1')]);
  assert.deepEqual(plan, { action: 'associate', taskIds: ['t1', 't2'], projectId: 'alpha' });
});

test('Spec → 任务：refSpec（多 spec 去重）', () => {
  const plan = planDrop(task('t1'), [spec('s1'), spec('s2'), spec('s1')]);
  assert.deepEqual(plan, { action: 'refSpec', taskId: 't1', specIds: ['s1', 's2'] });
});

test('不支持组合 → null（反向/混合/跨类）', () => {
  // 任务 → 任务
  assert.equal(planDrop(task('t1'), [task('t2')]), null);
  // Spec → 项目
  assert.equal(planDrop({ kind: 'project', id: 'alpha' }, [spec('s1')]), null);
  // 项目 → 任意
  assert.equal(planDrop({ kind: 'project', id: 'alpha' }, [{ kind: 'project', id: 'beta' }]), null);
  // 混合拖拽（任务 + spec）
  assert.equal(planDrop({ kind: 'project', id: 'alpha' }, [task('t1'), spec('s1')]), null);
  assert.equal(planDrop(task('t1'), [task('t2'), spec('s1')]), null);
  // 空目标 / 空拖拽 / 空 id
  assert.equal(planDrop(null, [task('t1')]), null);
  assert.equal(planDrop({ kind: 'project', id: 'alpha' }, []), null);
  assert.equal(planDrop(task(''), [spec('s1')]), null);
});

test('isValidEntityRef：仅接受完整实体形状', () => {
  assert.ok(isValidEntityRef(task('t1')));
  assert.ok(isValidEntityRef({ kind: 'spec', id: 's1' }));
  assert.ok(isValidEntityRef({ kind: 'project', id: 'p1' }));
  assert.ok(!isValidEntityRef({ kind: 'group', id: 'g' }));
  assert.ok(!isValidEntityRef({ kind: 'task' }));
  assert.ok(!isValidEntityRef({ kind: 'task', id: 42 }));
  assert.ok(!isValidEntityRef(null));
  assert.ok(!isValidEntityRef('task:t1'));
});
