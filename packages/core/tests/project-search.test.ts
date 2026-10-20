import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { closeDb, initDb, upsertProject } from '../src/index';
import { projectSearchResultsToSearchResults, searchProjects } from '../src/search/project-search';
import type { ProjectRow } from '../src/types';
import { createTempLatticeHome } from './helpers';

const { hybridSearchMock, isModelLoadedMock } = vi.hoisted(() => ({
  hybridSearchMock: vi.fn(),
  isModelLoadedMock: vi.fn(),
}));

vi.mock('../src/search/search', () => ({ hybridSearch: hybridSearchMock }));
vi.mock('../src/rag/embeddings', () => ({ isModelLoaded: isModelLoadedMock }));

const U = 'u1';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
  hybridSearchMock.mockReset();
  isModelLoadedMock.mockReset();
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

function row(
  id: string,
  name: string,
  opts: { path?: string; groups?: string[]; tags?: string[]; description?: string } = {},
): ProjectRow {
  return {
    id,
    name,
    local_path: JSON.stringify(opts.path ? [opts.path] : []),
    description: opts.description ?? null,
    git_remote: null,
    git_first_commit: null,
    git_default_branch: null,
    package_names: null,
    monorepo_packages: null,
    groups: opts.groups ? JSON.stringify(opts.groups) : null,
    tags: opts.tags ? JSON.stringify(opts.tags) : null,
    username: U,
    created: '2026-01-01T00:00:00.000Z',
    updated: null,
  };
}

function seed() {
  upsertProject(
    row('p1', 'Alpha', {
      path: '/src/a',
      groups: ['team/backend'],
      tags: ['x'],
      description: 'A desc',
    }),
  );
  upsertProject(row('p2', 'Beta', { path: '/src/b', groups: ['team/frontend'] }));
  upsertProject(row('p3', 'Gamma'));
}

test('searchProjects：keyword-only 与关键词快路径', async () => {
  seed();
  const keywordOnly = await searchProjects([U], 'alpha', { keywordOnly: true });
  assert.deepEqual(
    keywordOnly.projects.map((p) => p.id),
    ['p1'],
  );
  assert.equal(keywordOnly.scores.p1, 1);
  assert.equal(hybridSearchMock.mock.calls.length, 0);

  isModelLoadedMock.mockReturnValue(false);
  const fast = await searchProjects([U], 'alpha');
  assert.deepEqual(
    fast.projects.map((p) => p.id),
    ['p1'],
  );
  assert.equal(hybridSearchMock.mock.calls.length, 0);

  // group/tag 过滤
  const byGroup = await searchProjects([U], 'a', { keywordOnly: true, group: 'team/backend' });
  assert.deepEqual(
    byGroup.projects.map((p) => p.id),
    ['p1'],
  );
  const byTag = await searchProjects([U], 'a', { keywordOnly: true, tag: 'x' });
  assert.deepEqual(
    byTag.projects.map((p) => p.id),
    ['p1'],
  );
  const noMatch = await searchProjects([U], 'a', { keywordOnly: true, tag: 'nope' });
  assert.deepEqual(noMatch.projects, []);
});

test('searchProjects：语义 direct/indirect/去重/过滤/回退', async () => {
  seed();
  isModelLoadedMock.mockReturnValue(true);
  hybridSearchMock.mockResolvedValue([
    {
      type: 'project',
      score: 0.9,
      title: 'Alpha',
      snippet: '',
      meta: { projectIds: ['p1'] },
    },
    {
      type: 'task',
      score: 0.7,
      title: 'Task About Beta',
      snippet: '',
      meta: { projectIds: ['p2'], filePath: '/tasks/t1/task.md' },
    },
    { type: 'task', score: 0.6, title: 'orphan', snippet: '', meta: { projectIds: ['missing'] } },
    { type: 'spec', score: 0.5, title: 'no project', snippet: '', meta: {} },
  ]);

  const result = await searchProjects([U], 'zzz');
  assert.deepEqual(
    result.projects.map((p) => p.id),
    ['p1', 'p2'],
  );
  assert.equal(result.semanticFallback, true);
  assert.equal(result.scores.p1, 0.9);
  assert.deepEqual(result.matchProvenance.p2, {
    docType: 'task',
    docTitle: 'Task About Beta',
    docPath: '/tasks/t1/task.md',
  });
  assert.equal(hybridSearchMock.mock.calls[0][1].limit, 40);

  // group/tag 过滤语义候选
  const filteredGroup = await searchProjects([U], 'zzz', { group: 'team/frontend' });
  assert.deepEqual(
    filteredGroup.projects.map((p) => p.id),
    ['p2'],
  );
  const filteredTag = await searchProjects([U], 'zzz', { tag: 'x' });
  assert.deepEqual(
    filteredTag.projects.map((p) => p.id),
    ['p1'],
  );

  // 关键词已命中 → seenIds 去重，且不算 semanticFallback
  hybridSearchMock.mockResolvedValue([
    { type: 'project', score: 0.9, title: 'Alpha', snippet: '', meta: { projectIds: ['p1'] } },
    { type: 'project', score: 0.8, title: 'Beta', snippet: '', meta: { projectIds: ['p2'] } },
  ]);
  const mixed = await searchProjects([U], 'alpha');
  assert.deepEqual(
    mixed.projects.map((p) => p.id),
    ['p1', 'p2'],
  );
  assert.equal(mixed.semanticFallback, false);

  // hybridSearch 异常静默回退
  hybridSearchMock.mockRejectedValue(new Error('rag down'));
  const failed = await searchProjects([U], 'zzz');
  assert.deepEqual(failed.projects, []);
  assert.equal(failed.semanticFallback, false);
});

test('projectSearchResultsToSearchResults：provenance/描述/路径/坏 JSON', async () => {
  const result = {
    projects: [
      row('p1', 'Alpha', { path: '/src/a', description: 'A desc' }),
      row('p2', 'Beta', { path: '/src/b' }),
      { ...row('p3', 'Gamma'), local_path: '[]' },
      { ...row('p4', 'Broken'), local_path: 'not json' },
    ],
    semanticFallback: false,
    matchProvenance: {
      p1: { docType: 'task' as const, docTitle: 'T1', docPath: '/t1' },
    },
    scores: { p1: 0.9, p2: 0.8 },
  };
  const converted = projectSearchResultsToSearchResults(result);
  assert.equal(converted.length, 4);
  assert.equal(converted[0].snippet, '通过 task: T1 反查');
  assert.equal(converted[0].score, 0.9);
  assert.deepEqual(converted[0].meta.projectIds, ['p1']);
  assert.equal(converted[1].snippet, '/src/b', '无描述时回落本地路径');
  assert.equal(converted[2].snippet, '', '无路径无描述');
  assert.equal(converted[3].snippet, '');
  assert.equal(converted[3].type, 'project');
  assert.equal(converted[1].score, 0.8);
  assert.equal(converted[3].score, 1, '缺省分数兜底 1');
  assert.equal(converted[0].meta.matchedVia?.docTitle, 'T1');
});
