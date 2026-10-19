import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import {
  initDb,
  closeDb,
  registerProjectWithIds,
  syncProjectMetaToDb,
  createTask,
  updateTask,
  writeGroupRegistry,
  findProjectDirName,
  getProjectSpecDir,
  getUserSpecDir,
  getGlobalSpecDir,
  getContextForProject,
  getSmartContext,
  resolveSpecScope,
  formatContextAsMarkdown,
  parseSpec,
} from '../src/index';
import { createTempLatticeHome, putFile } from './helpers';

/**
 * 上下文聚合（context.ts）此前 0% 覆盖：
 * - resolveSpecScope / formatContextAsMarkdown 纯函数全分支
 * - getContextForProject：三层 spec 聚合 / 祖先级联 / 活跃任务 / 关系 / 同组 / 跨用户开关
 * - getSmartContext：任务直连 spec / 分组相关 spec / 未知任务错误
 */

const U = 't';
const U2 = 't2';
const ID_A = 'legacy:aaaabbbbccccdddd';
const ID_B = 'legacy:ffff000011112222';
const ID_C = 'legacy:9999888877776666';
const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };
const FUTURE = "updated: '2030-01-01T00:00:00.000Z'";

let env;

async function specText(title, description, extra = '') {
  return [
    '---',
    extra || null,
    `title: ${title}`,
    description ? `description: ${description}` : null,
    FUTURE,
    '---',
    `# ${title}`,
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function registerProject(ids, dirName, username = U) {
  const dir = join(env.tmpRoot, dirName);
  await putFile(join(dir, '.keep'), '');
  await registerProjectWithIds(username, ids, dir, DERIVED);
}

async function writeProjectSpec(primaryId, fileName, content, username = U) {
  const dirName = await findProjectDirName(username, primaryId);
  const path = join(getProjectSpecDir(username, dirName), fileName);
  await putFile(path, content);
  return path;
}

async function mutateMetaAndSync(dirName, mutate, username = U) {
  const metaPath = join(env.latticeHome, 'users', username, 'projects', dirName, 'project.json');
  const { readFile } = await import('node:fs/promises');
  const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
  mutate(meta);
  await putFile(metaPath, JSON.stringify(meta));
  syncProjectMetaToDb(username, meta, dirName);
  return meta;
}

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
  );
  await initDb();
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

// ─── 纯函数：resolveSpecScope ───

test('resolveSpecScope：四层命中 + 路径 fallback 推断', async () => {
  const mk = (filePath) => ({ filePath, fileName: 'x.md', frontmatter: {} });
  const ctx = {
    projectSpecs: [mk('/p/projects/a/spec/1.md')],
    ancestorSpecs: [mk('/p/projects/old/spec/2.md')],
    userSpecs: [mk('/p/users/u/spec/3.md')],
    globalSpecs: [mk('/p/spec/4.md')],
  };
  assert.equal(resolveSpecScope(mk('/p/projects/a/spec/1.md'), ctx), 'project');
  assert.equal(resolveSpecScope(mk('/p/projects/old/spec/2.md'), ctx), 'ancestor');
  assert.equal(resolveSpecScope(mk('/p/users/u/spec/3.md'), ctx), 'user');
  assert.equal(resolveSpecScope(mk('/p/spec/4.md'), ctx), 'global');
  assert.equal(resolveSpecScope(mk('/x/projects/y/spec/z.md'), ctx), 'project');
  assert.equal(resolveSpecScope(mk('/x/users/y/spec/z.md'), ctx), 'user');
  assert.equal(resolveSpecScope(mk('/x/other/z.md'), ctx), 'global');
});

// ─── 纯函数：formatContextAsMarkdown ───

test('formatContextAsMarkdown：画像/祖先/规范三态/任务/关联项目', async () => {
  const badSpecPath = join(env.latticeHome, 'spec', 'bad.md');
  await putFile(badSpecPath, '---\ntitle: [broken\n---\n');
  const badSpec = await parseSpec(badSpecPath);
  assert.ok(badSpec?.parseError, '坏 YAML 应产出 parseError');

  const ctx = {
    projectSpecs: [
      {
        filePath: '/p/users/t/projects/a/spec/p1.md',
        fileName: 'p1.md',
        frontmatter: { title: '项目规范', description: '项目级摘要', id: 'spec-p1' },
      },
    ],
    userSpecs: [
      { filePath: '/p/users/t/spec/u1.md', fileName: 'u1.md', frontmatter: { title: '用户规范' } },
    ],
    globalSpecs: [badSpec],
    cascadedSpecs: [
      {
        filePath: '/p/users/t/projects/a/spec/p1.md',
        fileName: 'p1.md',
        frontmatter: { title: '项目规范', description: '项目级摘要', id: 'spec-p1' },
      },
      { filePath: '/p/users/t/spec/u1.md', fileName: 'u1.md', frontmatter: { title: '用户规范' } },
      badSpec,
    ],
    activeTasks: [
      { id: '2026-01-01-aaaa', title: '进行中任务', status: 'in_progress' },
      { id: '2026-01-01-bbbb', title: '规划任务', status: 'planning' },
    ],
    relatedProjects: [
      {
        id: 'legacy:beef000011112222',
        name: '关联项目甲',
        relations: [{ relId: 'r1', type: 'depends-on', description: '依赖甲' }],
      },
    ],
    ancestors: [
      { id: 'legacy:1111222233334444', name: '父项目', root: '/repo/parent' },
      { id: 'legacy:5555666677778888', root: '/repo/grand' },
    ],
  };

  const md = formatContextAsMarkdown(
    ctx,
    '## 项目画像\n画像内容',
    new Set(['/p/users/t/spec/u1.md']),
  );

  assert.match(md, /^# 项目上下文/);
  assert.match(md, /## 项目画像/);
  assert.match(md, /本项目检测到 2 个祖先 Lattice 项目/);
  assert.match(md, /\*\*父项目\*\* \(直接父级\)/);
  assert.match(md, /\*\*legacy:5\*\* \(第 2 级祖先\)/);
  assert.match(md, /级联优先级：当前项目 > 父项目 > legacy:5 > 用户级 > 全局级/);
  assert.match(md, /### ★ 用户规范/, '语义匹配项应带 ★ 且排前');
  assert.match(md, /- 项目级/);
  assert.match(md, /- id：spec-p1/);
  assert.match(md, /\[缺失摘要\]/);
  assert.match(md, /frontmatter 解析失败/);
  assert.match(md, /## 活跃任务/);
  assert.match(md, /\*\*进行中任务\*\* \(in_progress\)/);
  assert.match(md, /\*\*关联项目甲\*\* — 依赖甲/);
});

test('formatContextAsMarkdown：无关联项目走提示语；跨用户聚合各段齐备', async () => {
  const ctx = {
    projectSpecs: [],
    userSpecs: [],
    globalSpecs: [],
    cascadedSpecs: [],
    activeTasks: [],
    relatedProjects: [],
    crossUserData: [
      {
        username: 'other',
        projectId: 'legacy:other',
        projectSpecs: [
          {
            filePath: '/p/users/other/projects/x/spec/a.md',
            fileName: 'a.md',
            frontmatter: { title: '他人项目规范', description: '摘要A', id: 'spec-a' },
          },
          {
            filePath: '/p/users/other/projects/x/spec/b.md',
            fileName: 'b.md',
            frontmatter: { title: '无摘要规范' },
          },
        ],
        userSpecs: [
          {
            filePath: '/p/users/other/spec/u.md',
            fileName: 'u.md',
            frontmatter: { title: '他人用户规范' },
          },
        ],
        activeTasks: [{ id: '2026-02-02-cccc', title: '他人任务', status: 'in_progress' }],
        relatedProjects: [
          {
            id: 'legacy:rrrr',
            name: '他人关联项目',
            relations: [{ relId: 'r2', type: 'related' }],
          },
        ],
      },
    ],
  };

  const md = formatContextAsMarkdown(ctx);
  assert.match(md, /暂无记录。如涉及多项目协作/);
  assert.match(md, /## 跨用户聚合/);
  assert.match(md, /### 来源用户：other/);
  assert.match(md, /#### 项目级 Spec（2）/);
  assert.match(md, /#### 用户级 Spec（1）/);
  assert.match(md, /#### 活跃任务（1）/);
  assert.match(md, /#### 关联项目（1）/);
  assert.match(md, /id：spec-a/);
  assert.match(md, /\*\*他人关联项目\*\* — related/);
});

// ─── getContextForProject ───

test('三层聚合：project/user/global spec 各归其位且 cascaded 合并', async () => {
  await registerProject([ID_A], 'projA');
  const pSpec = await writeProjectSpec(
    ID_A,
    'proj-spec.md',
    await specText('项目规范', '项目摘要'),
  );
  const uSpec = join(getUserSpecDir(U), 'user-spec.md');
  await putFile(uSpec, await specText('用户规范', '用户摘要'));
  const gSpec = join(getGlobalSpecDir(), 'global-spec.md');
  await putFile(gSpec, await specText('全局规范', '全局摘要'));

  const ctx = await getContextForProject(U, ID_A);
  assert.deepEqual(
    ctx.projectSpecs.map((s) => s.filePath),
    [pSpec],
  );
  assert.deepEqual(
    ctx.userSpecs.map((s) => s.filePath),
    [uSpec],
  );
  assert.deepEqual(
    ctx.globalSpecs.map((s) => s.filePath),
    [gSpec],
  );
  const cascaded = ctx.cascadedSpecs.map((s) => s.filePath);
  for (const p of [pSpec, uSpec, gSpec]) assert.ok(cascaded.includes(p), `cascaded 应包含 ${p}`);
  assert.equal(ctx.ancestors, undefined);
  assert.equal(ctx.ancestorSpecs, undefined);
  assert.deepEqual(ctx.activeTasks, []);
  assert.deepEqual(ctx.relatedProjects, []);
});

test('祖先级联：ancestorProjectIds + ancestors 输出', async () => {
  await registerProject([ID_A], 'projA');
  await registerProject([ID_C], 'projOld');
  const aSpec = await writeProjectSpec(ID_A, 'a.md', await specText('当前项目规范', 'A'));
  const oldSpec = await writeProjectSpec(ID_C, 'old.md', await specText('祖先规范', 'OLD'));

  const ctx = await getContextForProject(U, ID_A, {
    ancestorProjectIds: [ID_C],
    ancestors: [{ id: ID_C, name: '祖先项目', root: '/repo/old' }],
  });
  assert.deepEqual(
    ctx.projectSpecs.map((s) => s.filePath),
    [aSpec],
  );
  assert.deepEqual(
    ctx.ancestorSpecs?.map((s) => s.filePath),
    [oldSpec],
  );
  assert.deepEqual(ctx.ancestors, [{ id: ID_C, name: '祖先项目', root: '/repo/old' }]);
  const cascaded = ctx.cascadedSpecs.map((s) => s.filePath);
  assert.ok(cascaded.includes(aSpec) && cascaded.includes(oldSpec));
});

test('活跃任务：in_progress/planning 保留，completed 排除', async () => {
  await registerProject([ID_A], 'projA');
  const live = await createTask(U, '活跃任务', { projects: [ID_A] });
  const done = await createTask(U, '已完成任务', { projects: [ID_A] });
  await updateTask(U, done.id, { status: 'completed' });

  const ctx = await getContextForProject(U, ID_A);
  const ids = ctx.activeTasks.map((t) => t.id);
  assert.ok(ids.includes(live.id));
  assert.ok(!ids.includes(done.id));
});

test('关联项目：关系条目携带名称与描述；跨用户默认聚合（无他人时 undefined）', async () => {
  await registerProject([ID_A], 'projA');
  await registerProject([ID_B], 'projB');
  await putFile(
    join(env.latticeHome, 'users', U, 'relations.json'),
    JSON.stringify({
      version: 1,
      relations: [
        {
          id: 'rel-ctx-1',
          type: 'depends-on',
          projectA: ID_A,
          projectB: ID_B,
          description: '依赖 B',
          createdBy: 'manual',
          created: new Date().toISOString(),
        },
      ],
    }),
  );

  const ctx = await getContextForProject(U, ID_A);
  assert.equal(ctx.relatedProjects.length, 1);
  assert.equal(ctx.relatedProjects[0].name, 'projB');
  assert.equal(ctx.relatedProjects[0].relations[0].description, '依赖 B');
  assert.equal(ctx.crossUserData, undefined);
});

test('同组项目：分组路径共享祖先 → same-group 关联', async () => {
  await registerProject([ID_A], 'projA');
  await registerProject([ID_B], 'projB');
  await writeGroupRegistry(U, {
    version: 1,
    groups: [
      { id: 'grp-root', name: '团队' },
      { id: 'grp-fe', name: '前端', parentId: 'grp-root' },
    ],
  });
  const dirA = await findProjectDirName(U, ID_A);
  const dirB = await findProjectDirName(U, ID_B);
  await mutateMetaAndSync(dirA, (m) => {
    m.groupIds = ['grp-fe'];
  });
  await mutateMetaAndSync(dirB, (m) => {
    m.groupIds = ['grp-root'];
  });

  const ctx = await getContextForProject(U, ID_A);
  const sameGroup = ctx.relatedProjects.find((p) => p.relations[0]?.type === 'same-group');
  assert.ok(sameGroup, '应检出同组项目');
  assert.equal(sameGroup.name, 'projB');
  assert.match(sameGroup.relations[0].description ?? '', /同组：团队/);
});

test('跨用户聚合：他人注册同项目且有 spec → crossUserData 携带；crossUser=false 关闭', async () => {
  await registerProject([ID_A], 'projA');
  await registerProject([ID_A], 'projA-u2', U2);
  const u2Spec = await writeProjectSpec(
    ID_A,
    'u2-spec.md',
    await specText('U2 规范', 'U2 摘要'),
    U2,
  );

  const ctx = await getContextForProject(U, ID_A);
  assert.ok(ctx.crossUserData, '应聚合到他人数据');
  const entry = ctx.crossUserData.find((d) => d.username === U2);
  assert.ok(entry);
  assert.ok(entry.projectSpecs.some((s) => s.filePath === u2Spec));

  const off = await getContextForProject(U, ID_A, { crossUser: false });
  assert.equal(off.crossUserData, undefined);
});

// ─── getSmartContext ───

test('getSmartContext：未知任务抛错', async () => {
  await assert.rejects(() => getSmartContext(U, '2020-01-01-0000-ghos'), /未找到任务/);
});

test('getSmartContext：直连项目 spec 去重聚合；语义离线回退为空', async () => {
  await registerProject([ID_A], 'projA');
  const pSpec = await writeProjectSpec(ID_A, 'a.md', await specText('任务直连规范', '摘要'));

  const task = await createTask(U, '智能上下文任务', { projects: [ID_A] });
  const ctx = await getSmartContext(U, task.id);
  assert.equal(ctx.task.id, task.id);
  assert.deepEqual(
    ctx.directSpecs.map((s) => s.filePath),
    [pSpec],
  );
  assert.deepEqual(ctx.relatedSpecs, []);
  assert.deepEqual(ctx.semanticSpecs, []);
  assert.equal(ctx.crossUserData, undefined);
});

test('getSmartContext：任务项目所在分组 → 同组项目 spec 进 relatedSpecs', async () => {
  await registerProject([ID_A], 'projA');
  await registerProject([ID_B], 'projB');
  await writeGroupRegistry(U, {
    version: 1,
    groups: [
      { id: 'grp-root', name: '团队' },
      { id: 'grp-fe', name: '前端', parentId: 'grp-root' },
    ],
  });
  const dirA = await findProjectDirName(U, ID_A);
  const dirB = await findProjectDirName(U, ID_B);
  await mutateMetaAndSync(dirA, (m) => {
    m.groupIds = ['grp-fe'];
  });
  await mutateMetaAndSync(dirB, (m) => {
    m.groupIds = ['grp-root'];
  });
  const bSpec = await writeProjectSpec(ID_B, 'b.md', await specText('同组规范', '摘要'));

  const task = await createTask(U, '分组智能上下文', { projects: [ID_A] });
  const ctx = await getSmartContext(U, task.id);
  assert.ok(
    ctx.relatedSpecs.some((s) => s.filePath === bSpec),
    `relatedSpecs 应包含同组项目 spec，实际：${ctx.relatedSpecs.map((s) => s.filePath).join(', ')}`,
  );
});

// 断言项目目录写盘确实发生（防 fixture 静默失败）
test('fixture 自检：项目目录存在', async () => {
  await registerProject([ID_A], 'projA');
  const dirs = await readdir(join(env.latticeHome, 'users', U, 'projects'));
  assert.ok(dirs.length >= 1);
});
