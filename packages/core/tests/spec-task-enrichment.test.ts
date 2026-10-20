import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { enrichSpecResultsWithTaskRefs } from '../src/search/spec-task-enrichment';
import { closeDb, initDb, registerProjectWithIds } from '../src/index';
import { getGlobalSpecDir, getTaskMetaPath, getUserSpecDir } from '../src/paths';
import { writeJSON } from '../src/paths';
import { createTempLatticeHome, putFile } from './helpers';

const { hybridSearchMock } = vi.hoisted(() => ({ hybridSearchMock: vi.fn() }));

vi.mock('../src/search/search', () => ({ hybridSearch: hybridSearchMock }));

const U = 't';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
  hybridSearchMock.mockReset();
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

function taskRef(overrides: Record<string, unknown> = {}) {
  return {
    id: 'spec-abc12345',
    relativePath: 'topic/a.md',
    scope: 'global',
    firstReadAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function writeTask(
  id: string,
  title: string,
  referencedSpecs: unknown[],
  projects: string[] = [],
) {
  const now = '2026-01-01T00:00:00.000Z';
  await writeJSON(getTaskMetaPath(U, id), {
    id,
    title,
    status: 'in_progress',
    created: now,
    updated: now,
    projects,
    referencedSpecs,
  });
}

function taskResult(taskId: string, filePath = `/tasks/${taskId}/task.md`) {
  return {
    type: 'task' as const,
    score: 1,
    title: taskId,
    snippet: '',
    meta: { taskId, username: U, filePath },
  };
}

test('spec-task-enrichment：global/user/project 引用均能解析并追加', async () => {
  const projectDir = join(env.tmpRoot, 'proj');
  await initDb();
  const projectId = 'git:aaaa1111';
  await registerProjectWithIds(U, [projectId], projectDir, DERIVED);

  const globalPath = join(getGlobalSpecDir(), 'topic/a.md');
  await putFile(globalPath, '---\nid: spec-global\ntitle: 全局规范\n---\n\nbody');
  const userPath = join(getUserSpecDir(U), 'topic/a.md');
  await putFile(userPath, '---\nid: spec-user\ntitle: 用户规范\n---\n\nbody');
  const projectPath = join(
    env.latticeHome,
    'users',
    U,
    'projects',
    projectId,
    'spec',
    'topic/a.md',
  );
  await putFile(projectPath, '---\nid: spec-project\ntitle: 项目规范\n---\n\nbody');

  await writeTask('t-global', '全局任务', [taskRef()]);
  await writeTask('t-user', '用户任务', [
    taskRef({ id: 'spec-user', scope: 'user', projectId: undefined }),
  ]);
  await writeTask(
    't-project',
    '项目任务',
    [taskRef({ id: 'spec-project', scope: 'project', projectId })],
    [projectId],
  );
  await writeTask(
    't-fallback',
    '回退任务',
    [taskRef({ id: 'spec-project', scope: 'project', projectId: undefined })],
    [projectId],
  );

  hybridSearchMock.mockResolvedValue([
    taskResult('t-global'),
    taskResult('t-user'),
    taskResult('t-project'),
    taskResult('t-fallback'),
  ]);

  const results = await enrichSpecResultsWithTaskRefs([], 'query');
  assert.equal(results.length, 3, 'project spec 被两个任务引用只产生一条结果');
  const byId = (id: string) => results.find((r) => r.meta.specId === id);
  assert.equal(byId('spec-abc12345')?.title, '全局规范');
  assert.equal(byId('spec-abc12345')?.score, 0.08);
  assert.match(String(byId('spec-abc12345')?.snippet), /全局任务/);
  assert.equal(byId('spec-user')?.meta.source, 'task-ref');
  assert.equal(byId('spec-project')?.meta.username, U);
  assert.deepEqual(byId('spec-project')?.meta.projectIds, [projectId]);

  // 同一 spec 被两个任务引用 → 聚合 matchedVia.tasks
  const projectResult = byId('spec-project');
  assert.equal(projectResult?.meta.matchedVia?.docTitle, '项目任务、回退任务');
  assert.equal(projectResult?.meta.matchedVia?.tasks?.length, 2);
});

test('spec-task-enrichment：已有结果只补 matchedVia，不重复追加', async () => {
  const globalPath = join(getGlobalSpecDir(), 'topic/a.md');
  await putFile(globalPath, '---\nid: spec-abc12345\ntitle: 已存在\n---\n\nbody');
  await writeTask('t1', '任务一', [taskRef()]);
  await writeTask('t2', '任务二', [taskRef()]);
  hybridSearchMock.mockResolvedValue([taskResult('t1'), taskResult('t2')]);

  const existing = {
    type: 'spec' as const,
    score: 0.9,
    title: '已存在',
    snippet: '',
    meta: { filePath: globalPath },
  };
  const results = await enrichSpecResultsWithTaskRefs([existing], 'query');
  assert.equal(results.length, 1);
  assert.equal(results[0].score, 0.9, '原结果分数不变');
  assert.equal(results[0].meta.matchedVia?.docTitle, '任务一、任务二');

  // 已有 matchedVia 不覆盖
  const keep = {
    ...existing,
    meta: { filePath: globalPath, matchedVia: { docType: 'task', docTitle: '原' } },
  };
  const second = await enrichSpecResultsWithTaskRefs([keep], 'query');
  assert.equal(second[0].meta.matchedVia?.docTitle, '原');
});

test('spec-task-enrichment：坏 spec/缺失文件/无元数据任务跳过', async () => {
  const globalPath = join(getGlobalSpecDir(), 'topic/a.md');
  await putFile(globalPath, '---\n: bad: yaml: [\n---\nbody');
  await writeTask('t-bad', '坏 spec 任务', [taskRef()]);
  await writeTask('t-missing', '缺失任务', [
    taskRef({ id: 'spec-missing1', relativePath: 'nope.md' }),
  ]);
  await writeTask('t-noref', '无引用任务', []);
  await writeTask('t-nometa', '无元数据任务', [taskRef()]);

  hybridSearchMock.mockResolvedValue([
    taskResult('t-bad'),
    taskResult('t-missing'),
    taskResult('t-noref'),
    taskResult('t-nometa'),
  ]);

  const results = await enrichSpecResultsWithTaskRefs([], 'query');
  assert.equal(results.length, 0, '坏 YAML 与缺失文件都不应产出结果');

  // taskId/username 缺失的搜索结果直接跳过
  hybridSearchMock.mockResolvedValue([
    { type: 'task', score: 1, title: 'x', snippet: '', meta: {} },
    { type: 'task', score: 1, title: 'y', snippet: '', meta: { taskId: 't1' } },
  ]);
  assert.deepEqual(await enrichSpecResultsWithTaskRefs([], 'query'), []);
});

test('spec-task-enrichment：搜索异常/空结果/无引用时返回原结果', async () => {
  const base = [
    { type: 'spec' as const, score: 1, title: 'base', snippet: '', meta: { filePath: '/x' } },
  ];
  hybridSearchMock.mockRejectedValue(new Error('boom'));
  assert.deepEqual(await enrichSpecResultsWithTaskRefs(base, 'q'), base);

  hybridSearchMock.mockResolvedValue([]);
  assert.deepEqual(await enrichSpecResultsWithTaskRefs(base, 'q'), base);

  await writeTask('t-empty', '空引用', []);
  hybridSearchMock.mockResolvedValue([taskResult('t-empty')]);
  assert.deepEqual(await enrichSpecResultsWithTaskRefs(base, 'q'), base);
});
