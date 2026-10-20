import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, initDb, registerProjectWithIds } from '../src/index';
import { collectFingerprint } from '../src/project/fingerprint';
import { computeProjectIds } from '../src/project/identity-generate';
import { detectAndLinkNestedIn } from '../src/project/nested-in';
import { readRelationsFile } from '../src/project/relation';
import {
  isTaskAssociatedWithProject,
  isTaskAssociatedWithProjectId,
} from '../src/project/association';
import type { ProjectMeta, TaskMeta } from '../src/types';
import { createTempLatticeHome, putFile } from './helpers';

const U = 't';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await initDb();
});

afterEach(async () => {
  try {
    closeDb();
  } catch {
    // ignore
  }
  await env.cleanup();
});

async function initRepo(dir: string, marker: string) {
  const { execFileSync } = await import('node:child_process');
  await mkdir(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await putFile(join(dir, 'unique.txt'), marker);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', marker], {
    cwd: dir,
  });
}

async function registerPath(dir: string) {
  const { derived } = await collectFingerprint(dir);
  const ids = computeProjectIds(derived);
  assert.ok(ids.length > 0, `未生成项目 ID: ${dir}`);
  const meta = await registerProjectWithIds(U, ids, dir, derived);
  return { meta, id: meta.ids[0] };
}

test('nested-in：直接父级与多级祖先（git 仓库）', async () => {
  const grand = join(env.tmpRoot, 'nest', 'grand');
  const parent = join(grand, 'parent');
  const child = join(parent, 'child');
  await initRepo(grand, 'grand');
  await initRepo(parent, 'parent');
  await initRepo(child, 'child');

  const g = await registerPath(grand);
  const p = await registerPath(parent);
  const c = await registerPath(child);

  const found = await detectAndLinkNestedIn(U, c.id, child);
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((f) => f.type),
    ['direct', 'ancestor'],
  );

  const relations = (await readRelationsFile(U)).relations.filter(
    (r) => r.projectA === c.id || r.projectB === c.id,
  );
  assert.equal(relations.length, 2);
  assert.ok(
    relations.some(
      (r) => (r.projectA === p.id || r.projectB === p.id) && r.description === '直接父级项目',
    ),
  );
  assert.ok(
    relations.some(
      (r) => (r.projectA === g.id || r.projectB === g.id) && r.description === '第 2 级祖先项目',
    ),
  );

  // 幂等：重复检测不新增关系
  await detectAndLinkNestedIn(U, c.id, child);
  assert.equal(
    (await readRelationsFile(U)).relations.filter((r) => r.projectA === c.id || r.projectB === c.id)
      .length,
    2,
  );
});

test('nested-in：lattice.json 祖先与未注册祖先', async () => {
  const legacyRoot = join(env.tmpRoot, 'legacy-nest');
  await mkdir(legacyRoot, { recursive: true });
  await putFile(join(legacyRoot, 'lattice.json'), JSON.stringify({ id: 'abcd1234abcd1234' }));
  const legacyId = 'legacy:abcd1234abcd1234';
  await registerProjectWithIds(U, [legacyId], legacyRoot, DERIVED);

  const child = join(legacyRoot, 'child');
  await initRepo(child, 'legacy-child');
  const c = await registerPath(child);

  const found = await detectAndLinkNestedIn(U, c.id, child);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, legacyId);
  assert.equal(found[0].type, 'direct');

  // 未注册的 git 祖先 → 不产生关系
  const lonely = join(env.tmpRoot, 'lonely');
  const lonelyChild = join(lonely, 'child');
  await initRepo(lonely, 'lonely');
  await initRepo(lonelyChild, 'lonely-child');
  const lc = await registerPath(lonelyChild);
  assert.deepEqual(await detectAndLinkNestedIn(U, lc.id, lonelyChild), []);

  // 自己指向自己 → 跳过
  assert.deepEqual(await detectAndLinkNestedIn(U, legacyId, legacyRoot), []);
});

test('association：直接/无前缀/虚拟合并/空集合', async () => {
  const p1Dir = join(env.tmpRoot, 'assoc-p1');
  const p2Dir = join(env.tmpRoot, 'assoc-p2');
  const p3Dir = join(env.tmpRoot, 'assoc-p3');
  const p4Dir = join(env.tmpRoot, 'assoc-p4');
  for (const d of [p1Dir, p2Dir, p3Dir, p4Dir]) await mkdir(d, { recursive: true });

  const p1 = await registerProjectWithIds(U, ['legacy:1111aaaa', 'git:aaaa1111'], p1Dir, DERIVED);
  const p2 = await registerProjectWithIds(U, ['legacy:2222bbbb', 'git:bbbb2222'], p2Dir, DERIVED);
  const p3 = await registerProjectWithIds(U, ['git:shared999'], p3Dir, DERIVED);
  const p4 = await registerProjectWithIds(U, ['legacy:4444dddd', 'git:shared999'], p4Dir, DERIVED);

  const task = (projects: string[]) => ({ projects }) as unknown as TaskMeta;

  assert.equal(isTaskAssociatedWithProject(task(['git:aaaa1111']), p1), true);
  assert.equal(isTaskAssociatedWithProject(task(['1111aaaa']), p1), true);
  assert.equal(isTaskAssociatedWithProject(task(['git:bbbb2222']), p1), false);
  assert.equal(isTaskAssociatedWithProject(task([]), p1), false);
  assert.equal(
    isTaskAssociatedWithProject(task(['git:aaaa1111']), { ...p1, ids: [] } as ProjectMeta),
    false,
  );

  // 虚拟合并：p3/p4 共享 git:shared999，任务关联任一 ID 都应命中两边
  assert.equal(isTaskAssociatedWithProject(task(['git:shared999']), p3), true);
  assert.equal(isTaskAssociatedWithProject(task(['git:shared999']), p4), true);
  assert.equal(isTaskAssociatedWithProjectId(task(['git:shared999']), p3.ids[0]), true);
  assert.equal(isTaskAssociatedWithProjectId(task(['4444dddd']), p3.ids[0]), true);
  assert.equal(isTaskAssociatedWithProjectId(task(['git:aaaa1111']), p3.ids[0]), false);
  assert.equal(isTaskAssociatedWithProjectId(task([]), p1.ids[0]), false);

  assert.ok(p2.ids.length > 0);
});
