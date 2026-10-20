import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, initDb, registerProjectWithIds } from '../src/index';
import { findSpecById, findSpecByName } from '../src/spec/query';
import { getGlobalSpecDir, getProjectSpecDir, getUserSpecDir } from '../src/paths';
import { createTempLatticeHome, putFile } from './helpers';

const U = 't';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;
let projectId: string;
let otherProjectId: string;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
  const p1 = join(env.tmpRoot, 'p1');
  const p2 = join(env.tmpRoot, 'p2');
  await mkdir(p1, { recursive: true });
  await mkdir(p2, { recursive: true });
  projectId = 'legacy:1111222233334444';
  otherProjectId = 'legacy:5555666677778888';
  await registerProjectWithIds(U, [projectId], p1, DERIVED);
  await registerProjectWithIds(U, [otherProjectId], p2, DERIVED);

  await putFile(
    join(getGlobalSpecDir(), 'guide.md'),
    '---\nid: spec-global1\ntitle: Global Guide\n---\n\nbody',
  );
  await putFile(
    join(getUserSpecDir(U), 'guide.md'),
    '---\nid: spec-user1\ntitle: User Guide\n---\n\nbody',
  );
  await putFile(
    join(getProjectSpecDir(U, projectId), 'guide.md'),
    '---\nid: spec-proj1\ntitle: Project Guide\n---\n\nbody',
  );
  await putFile(
    join(getProjectSpecDir(U, otherProjectId), 'guide.md'),
    '---\nid: spec-dup1\ntitle: Duplicate Guide\n---\n\nbody',
  );
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

test('findSpecByName：精确匹配跨层级与 scope 限定', async () => {
  const all = await findSpecByName(U, projectId, 'guide.md');
  assert.deepEqual(
    all.map((m) => m.scope),
    ['project', 'user', 'global'],
  );
  assert.equal(all[0].spec.frontmatter.id, 'spec-proj1');

  const userOnly = await findSpecByName(U, projectId, 'guide.md', { scope: 'user' });
  assert.equal(userOnly.length, 1);
  assert.equal(userOnly[0].scope, 'user');

  const withoutProject = await findSpecByName(U, null, 'guide.md', { scope: 'project' });
  assert.deepEqual(withoutProject, []);

  // 绝对路径 → direct
  const direct = await findSpecByName(U, projectId, join(getGlobalSpecDir(), 'guide.md'));
  assert.equal(direct.length, 1);
  assert.equal(direct[0].scope, 'direct');
  assert.equal(direct[0].spec.frontmatter.id, 'spec-global1');
});

test('findSpecByName：glob 与模糊匹配', async () => {
  const glob = await findSpecByName(U, projectId, '*.md');
  assert.equal(glob.length, 3);

  const titleGlob = await findSpecByName(U, projectId, 'Global*');
  assert.equal(titleGlob.length, 1);
  assert.equal(titleGlob[0].scope, 'global');

  const bracket = await findSpecByName(U, projectId, '[Gg]uide.md');
  assert.equal(bracket.length, 3);

  const fuzzy = await findSpecByName(U, projectId, 'PROJECT');
  assert.equal(fuzzy.length, 1);
  assert.equal(fuzzy[0].spec.frontmatter.title, 'Project Guide');

  const fuzzyNoExt = await findSpecByName(U, projectId, 'guide');
  assert.equal(fuzzyNoExt.length, 3);

  assert.deepEqual(await findSpecByName(U, projectId, 'nope'), []);
});

test('findSpecById：global/user/project、跨项目 prefer、未找到', async () => {
  const global = await findSpecById(U, 'spec-global1');
  assert.equal(global?.scope, 'global');
  const user = await findSpecById(U, 'spec-user1');
  assert.equal(user?.scope, 'user');
  const proj = await findSpecById(U, 'spec-proj1');
  assert.equal(proj?.scope, 'project');
  assert.equal(proj?.projectId, projectId);
  assert.equal(proj?.projectName, 'p1');

  assert.equal(await findSpecById(U, 'spec-missing'), null);

  // 跨项目重复 ID：preferProjectId 优先；无偏好取首个
  await putFile(
    join(getProjectSpecDir(U, otherProjectId), 'dup.md'),
    '---\nid: spec-same1\ntitle: Same\n---\n\nbody',
  );
  await putFile(
    join(getProjectSpecDir(U, projectId), 'dup.md'),
    '---\nid: spec-same1\ntitle: Same\n---\n\nbody',
  );
  const preferred = await findSpecById(U, 'spec-same1', { preferProjectId: otherProjectId });
  assert.equal(preferred?.projectId, otherProjectId);
  const first = await findSpecById(U, 'spec-same1');
  assert.ok(first?.projectId === projectId || first?.projectId === otherProjectId);
  assert.equal((await findSpecById(U, 'spec-same1', { preferProjectId: null }))?.scope, 'project');
});
