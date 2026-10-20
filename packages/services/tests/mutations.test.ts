/**
 * services 写用例与边界补测：分组注册表、任务生命周期/关联、spec 管理、回收站、关系、搜索、维护。
 * 与 contract.test.ts 同一 fixture 口径（隔离 LATTICE_HOME + tester 用户），硬离线。
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, test } from 'vitest';
import { createFixtureHome } from './fixture';

const fixture = createFixtureHome();
process.env.LATTICE_HOME = fixture.home;
writeFileSync(
  join(fixture.home, 'config', 'config.json'),
  JSON.stringify({ rag: { embedding: { allowRemoteModels: false } } }),
);

const services = await import('../src/index');
const core = await import('@qcqx/lattice-core');

beforeAll(async () => {
  await core.initDb();
  const betaDir = join(fixture.workspace, 'beta');
  mkdirSync(betaDir, { recursive: true });
  await core.registerProjectWithIds('tester', ['beta'], betaDir, {
    gitRemotes: [],
    packageNames: [],
    monorepoPackages: [],
  });
});

afterAll(() => {
  core.closeDb();
  fixture.cleanup();
});

// ── 项目分组 ──

test('project-groups：树/路径/计数与 CRUD 影响面', async () => {
  const missingParent = await services.createProjectGroup('tester', '不存在', '子组');
  assert.match(missingParent.error ?? '', /未找到父分组/);

  const root = await services.createProjectGroup('tester', null, '平台');
  assert.equal(root.path, '平台');
  const child = await services.createProjectGroup('tester', '平台', '基础');
  assert.equal(child.path, '平台/基础');

  const duplicate = await services.createProjectGroup('tester', '平台', '基础');
  assert.ok(duplicate.error);

  const set = await services.setProjectGroups('tester', 'alpha', { add: ['平台/基础'] });
  assert.equal(set.error, undefined);
  assert.deepEqual(set.createdPaths, []);

  const unknown = await services.setProjectGroups('tester', 'alpha', {
    remove: ['不存在的分组'],
  });
  assert.deepEqual(unknown.unknownRemovals, ['不存在的分组']);

  const badProject = await services.setProjectGroups('tester', 'no-such-project', {
    add: ['平台'],
  });
  assert.ok(badProject.error);

  const tree = await services.getProjectGroupTree('tester');
  assert.equal(tree.total, 2);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.roots[0].projectCount, 1, '父节点应统计子树项目引用');
  assert.equal(tree.roots[0].children[0].projectCount, 1);
  assert.equal(tree.ungroupedProjects, 1, 'beta 未分组');

  assert.deepEqual(await services.listProjectGroupPaths('tester'), ['平台', '平台/基础']);

  const missingPreview = await services.previewProjectGroupImpact('tester', '无此分组');
  assert.match(missingPreview.error ?? '', /未找到分组/);
  const preview = await services.previewProjectGroupImpact('tester', '平台');
  assert.equal(preview.path, '平台');
  assert.equal(preview.subgroupCount, 1);
  assert.ok(preview.affectedProjectIds.some((id) => /alpha$/.test(id)));

  const renamed = await services.renameProjectGroup('tester', '平台/基础', '基础设施');
  assert.equal(renamed.path, '平台/基础设施');
  assert.ok(renamed.affectedProjectIds?.some((id) => /alpha$/.test(id)));
  assert.match(
    (await services.renameProjectGroup('tester', '无此分组', 'x')).error ?? '',
    /未找到分组/,
  );

  const moved = await services.moveProjectGroup('tester', '平台/基础设施', null);
  assert.equal(moved.path, '基础设施');
  assert.match(
    (await services.moveProjectGroup('tester', '基础设施', '无此父组')).error ?? '',
    /未找到目标父分组/,
  );

  const removedChild = await services.removeProjectGroup('tester', '基础设施');
  assert.equal(removedChild.removedCount, 1);
  assert.ok(removedChild.affectedProjectIds?.some((id) => /alpha$/.test(id)));
  const removed = await services.removeProjectGroup('tester', '平台');
  assert.equal(removed.removedCount, 1);
  assert.ok((await services.removeProjectGroup('tester', '平台')).error);

  // 清掉 alpha 上残留的分组引用，避免影响后续断言
  await services.setProjectGroups('tester', 'alpha', { set: [] });
});

// ── 任务读模型 ──

test('tasks 读：详情/图/信息/检查点/上下文与缺失分支', async () => {
  await assert.rejects(() => services.requireTask('tester', 'no-such-task'), /未找到任务/);

  const found = await services.getTask('tester', 'task-alpha');
  assert.equal(found?.id, 'task-alpha-1', '支持 ID 前缀解析');

  const detail = await services.getTaskDetail('tester', 'task-alpha-1');
  assert.equal(detail.task?.id, 'task-alpha-1');
  assert.ok(detail.progress.length >= 1);
  const missingDetail = await services.getTaskDetail('tester', 'no-such-task');
  assert.equal(missingDetail.task, null);
  assert.deepEqual(missingDetail.progress, []);

  const graph = await services.getTaskGraph('tester', 'task-alpha-1');
  assert.ok(graph, '正常任务应返回图视图');
  const missingGraph = await services.getTaskGraph('tester', 'no-such-task');
  assert.equal(missingGraph?.tree ?? null, null);
  const lineage = await services.getTaskLineage('tester', 'task-alpha-1');
  assert.ok(Array.isArray(lineage));
  assert.equal(await services.getTaskLineage('tester', 'no-such-task'), null);

  const info = await services.getTaskInfo('tester', 'task-alpha-1');
  assert.match(info.prd, /Contract fixture PRD/);
  assert.deepEqual(await services.getTaskInfo('tester', 'no-such-task'), { meta: null, prd: '' });

  const checkpoint = await services.getTaskCheckpoint('tester', 'task-alpha-1', 'cp-alpha-1');
  assert.equal(checkpoint?.id, 'cp-alpha-1');
  assert.equal(await services.getTaskCheckpoint('tester', 'task-alpha-1', 'nope'), null);
  assert.equal(await services.getTaskCheckpoint('tester', 'no-such-task', 'cp-alpha-1'), null);

  assert.deepEqual(await services.listCheckpoints('tester', 'no-such-task'), []);
  const filtered = await services.listCheckpoints('tester', 'task-alpha-1', {
    last: 1,
    type: 'decision',
  });
  assert.equal(filtered.length, 1);

  const active = await services.listActiveCheckpoints('tester');
  assert.ok(active.some((entry) => entry.taskId === 'task-alpha-1'));

  const context = await services.getTaskContext('tester', 'task-alpha-1');
  assert.equal(typeof context, 'object');
  const projectContext = await services.getProjectContextBundle('tester', 'alpha');
  assert.equal(typeof projectContext, 'object');
});

// ── 任务生命周期 ──

test('tasks 写：状态机/标题/检查点/关联与解除/父任务', async () => {
  const started = await services.setTaskStatus('tester', 'task-alpha-1', 'start');
  assert.equal(started?.status, 'in_progress');
  const completed = await services.setTaskStatus('tester', 'task-alpha-1', 'complete');
  assert.equal(completed?.status, 'completed');
  const reopened = await services.setTaskStatus('tester', 'task-alpha-1', 'reopen');
  assert.equal(reopened?.status, 'in_progress');
  const archived = await services.setTaskStatus('tester', 'task-alpha-1', 'archive');
  assert.equal(archived?.status, 'archived');
  await services.setTaskStatus('tester', 'task-alpha-1', 'start');
  await assert.rejects(() => services.setTaskStatus('tester', 'no-such-task', 'start'));

  const renamed = await services.updateTaskTitle('tester', 'task-alpha-1', 'Alpha 任务');
  assert.equal(renamed?.title, 'Alpha 任务');

  const checkpoint = await services.addTaskCheckpoint('tester', 'task-alpha-1', {
    type: 'milestone',
    title: '里程碑',
    message: 'services 补测',
  });
  assert.equal(checkpoint.type, 'milestone');

  const associated = await services.associateTask('tester', 'task-alpha-1', {
    projectId: 'beta',
    paths: [fixture.workspace, join(fixture.workspace, 'not-a-project')],
  });
  assert.ok(associated?.projects?.some((id) => /alpha$/.test(id)));
  assert.ok(
    associated?.scopePaths?.some(
      (entry) => entry.path === join(fixture.workspace, 'not-a-project'),
    ),
  );

  const partial = await services.unassociateTask('tester', 'task-alpha-1', { projectId: 'beta' });
  assert.ok(!partial?.projects?.includes('beta'));
  const withoutPath = await services.unassociateTask('tester', 'task-alpha-1', {
    path: join(fixture.workspace, 'not-a-project'),
  });
  assert.ok(
    !withoutPath?.scopePaths?.some(
      (entry) => entry.path === join(fixture.workspace, 'not-a-project'),
    ),
  );
  const cleared = await services.unassociateTask('tester', 'task-alpha-1', { clearPaths: true });
  assert.deepEqual(cleared?.scopePaths, []);
  await assert.rejects(() => services.unassociateTask('tester', 'no-such-task', {}));

  const parent = await services.createTask('tester', '父任务', { projects: ['alpha'] });
  const child = await services.createTask('tester', '子任务', {
    projects: ['alpha'],
    parentTaskId: parent.id,
  });
  assert.equal(child.parentTaskId, parent.id);
  const withParent = await services.updateTaskParent('tester', child.id, parent.id);
  assert.equal(withParent?.parentTaskId, parent.id);
  const detached = await services.updateTaskParent('tester', child.id, undefined);
  assert.equal(detached?.parentTaskId, undefined);

  const refs = await services.addTaskSpecRefs('tester', 'task-alpha-1', ['spec-aaaa0001']);
  assert.equal(refs, undefined);
  await assert.rejects(
    () => services.addTaskSpecRefs('tester', 'task-alpha-1', ['spec-doesnotexist']),
    /引用 spec 失败/,
  );
  await services.removeTaskSpecRefs('tester', 'task-alpha-1', ['spec-aaaa0001']);
  await assert.rejects(() =>
    services.removeTaskSpecRefs('tester', 'no-such-task', ['spec-aaaa0001']),
  );

  assert.ok((await services.listTasks('tester', { projectId: 'alpha' })).length >= 1);
  assert.ok(
    (await services.listTasks('tester', { crossUser: true, projectId: 'alpha' })).length >= 1,
  );
  assert.ok(
    (
      await services.listTasks('tester', {
        crossUser: true,
        projectId: 'alpha',
        status: 'in_progress',
      })
    ).every((task) => task.status === 'in_progress'),
  );

  await services.deleteTask('tester', child.id);
  await assert.rejects(() => services.deleteTask('tester', 'no-such-task'));
  const deleted = (await services.listTrash('tester')).find((entry) => entry.entityId === child.id);
  assert.ok(deleted);
  const restored = await services.restoreTrash('tester', deleted.id);
  assert.equal(restored.entityId, child.id);
  assert.ok((await services.getTask('tester', child.id))?.id);
  await services.deleteTask('tester', child.id);
  const again = (await services.listTrash('tester')).find((entry) => entry.entityId === child.id);
  assert.ok(again);
  await services.purgeTrash(again.id);
  assert.equal(await services.getTask('tester', child.id), null);
  await assert.rejects(() => services.restoreTrash('tester', 'no-such-entry'), /未找到回收站条目/);
  await assert.rejects(() => services.purgeTrash('no-such-entry'), /未找到回收站条目/);
});

// ── spec 管理 ──

test('specs：分层列表/按 ID 名称查找/冲突/迁移/frontmatter 更新', async () => {
  const all = await services.listSpecs('tester');
  assert.ok(all.length >= 3);
  assert.ok(all.some((entry) => entry.scope === 'global'));
  assert.ok(all.some((entry) => entry.scope === 'user'));
  assert.ok(all.some((entry) => entry.scope === 'project' && /alpha$/.test(entry.projectId ?? '')));
  assert.ok(
    (await services.listSpecs('tester', { scope: 'global' })).every((e) => e.scope === 'global'),
  );
  assert.ok(
    (await services.listSpecs('tester', { scope: 'user' })).every((e) => e.scope === 'user'),
  );
  const projectOnly = await services.listSpecs('tester', {
    scope: 'project',
    projectId: 'alpha',
  });
  assert.ok(projectOnly.some((entry) => entry.spec.fileName === 'project-spec.md'));

  const byId = await services.findSpec('tester', 'spec-aaaa0001');
  assert.equal(byId?.spec.frontmatter.title, 'User spec');
  const byName = await services.findSpec('tester', 'User spec');
  assert.equal(byName?.spec.frontmatter.id, 'spec-aaaa0001');
  assert.equal(await services.findSpec('tester', 'definitely-missing'), null);

  assert.deepEqual(await services.detectConflicts('tester'), []);
  assert.deepEqual(await services.detectConflicts('tester', 'alpha'), []);
  assert.deepEqual(await services.detectAllConflicts('tester'), []);

  const dry = await services.migrateSpecs({ dryRun: true });
  assert.equal(typeof dry, 'object');

  const updated = await services.updateSpecFrontmatter('tester', 'spec-aaaa0001', {
    title: '用户规范',
    description: 'services 更新',
    tags: [' a ', 'a', 'b', ''],
  });
  assert.equal(updated?.specId, 'spec-aaaa0001');
  const reread = await services.findSpec('tester', 'spec-aaaa0001');
  assert.equal(reread?.spec.frontmatter.title, '用户规范');
  assert.deepEqual(reread?.spec.frontmatter.tags, ['a', 'b']);
  assert.equal(
    await services.updateSpecFrontmatter('tester', 'spec-missing', { title: 'x' }),
    null,
  );

  const brokenPath = join(fixture.home, 'users', 'tester', 'spec', 'broken-services.md');
  writeFileSync(brokenPath, '---\ntitle: [bad\n---\n');
  await assert.rejects(
    () => services.updateSpecFrontmatter('tester', 'broken-services.md', { title: 'x' }),
    /YAML 解析失败/,
  );
});

// ── 关系 / 内容 / 搜索 ──

test('relations：新增/删除与缺失项目边界', async () => {
  const relation = await services.addRelation('tester', 'alpha', 'beta', {
    type: 'depends_on',
    description: 'services 关系',
    taskId: 'task-alpha-1',
  });
  assert.ok(relation.id);
  assert.ok((await services.listRelations('tester')).some((r) => r.id === relation.id));
  await assert.rejects(() => services.addRelation('tester', 'ghost', 'beta'), /未找到项目/);
  await assert.rejects(() => services.addRelation('tester', 'alpha', 'ghost'), /未找到项目/);
  await services.removeRelation('tester', relation.id);
  assert.ok(!(await services.listRelations('tester')).some((r) => r.id === relation.id));
  await assert.rejects(() => services.removeRelation('tester', 'rel-missing'), /未找到项目关系/);
});

test('content：路径解析与读取的缺失分支', async () => {
  assert.match(
    await services.resolveContentPath('tester', 'task', 'task-alpha-1').then((p) => p ?? ''),
    /task-alpha-1/,
  );
  assert.match(
    await services.resolveContentPath('tester', 'project-dir', 'alpha').then((p) => p ?? ''),
    /projects\/alpha/,
  );
  assert.match(
    await services.resolveContentPath('tester', 'profile', 'alpha').then((p) => p ?? ''),
    /alpha/,
  );
  assert.equal(await services.resolveContentPath('tester', 'unknown', 'x'), null);
  assert.match(
    await services.readContent('tester', 'prd', 'task-alpha-1').then((c) => c ?? ''),
    /Contract fixture PRD/,
  );
  assert.equal(await services.readContent('tester', 'spec', 'spec-missing'), null);
});

test('search：多类型 fan-out、单类型与 limit 边界（硬离线可返回空）', async () => {
  const multi = await services.search('tester', 'Alpha', { types: ['task', 'spec'], limit: 5 });
  assert.ok(Array.isArray(multi));
  const single = await services.search('tester', 'Alpha', {
    types: ['task'],
    projectId: 'alpha',
    usernames: ['tester'],
  });
  assert.ok(Array.isArray(single));
  const zeroLimit = await services.search('tester', 'Alpha', { types: ['task'], limit: 0 });
  assert.ok(Array.isArray(zeroLimit));
  assert.ok(Array.isArray(await services.search('tester', 'Alpha')));
});

// ── 回收站（项目分支）/ 维护 ──

test('trash：删除项目后恢复会重新注册；emptyTrash 返回计数', async () => {
  await core.unregisterProject('tester', 'beta');
  const entry = (await services.listTrash('tester')).find(
    (item) => item.type === 'project' && item.entityId === 'beta',
  );
  assert.ok(entry);
  const restored = await services.restoreTrash('tester', entry.id);
  assert.equal(restored.type, 'project');
  const beta = await services.getProject('tester', 'beta');
  assert.ok(beta?.id.endsWith('beta'));
  assert.match(beta?.localPaths?.[0] ?? '', /projects\/beta$/);

  assert.equal(typeof (await services.emptyTrash('tester')), 'number');
});

test('maintenance：RAG 状态/update/rebuild 与 doctor 修复模式', async () => {
  const status = await services.getRagStatus();
  assert.equal(typeof status, 'object');
  assert.equal(typeof status.indexedDocuments, 'number');

  const report = await services.runDoctor({ fix: true, cliVersion: '0.0.0-test' });
  assert.ok(Array.isArray(report.entries));

  assert.equal(typeof (await services.updateRag('update')), 'number');
  assert.equal(typeof (await services.updateRag('rebuild')), 'number');
});
