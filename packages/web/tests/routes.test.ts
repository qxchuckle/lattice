/**
 * web 路由覆盖测试：走 fastify inject，补齐契约测试之外的写接口/错误分支/管理端点。
 * 与 contract.test.ts 同一 fixture 口径（隔离 LATTICE_HOME + tester 用户），
 * 硬离线（allowRemoteModels=false），不触发 open/编辑器等宿主进程。
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, test } from 'vitest';
import { createFixtureHome } from '../../services/tests/fixture';

const fixture = createFixtureHome();
process.env.LATTICE_HOME = fixture.home;
// 硬离线：任何 RAG 路径都不尝试下载模型
writeFileSync(
  join(fixture.home, 'config', 'config.json'),
  JSON.stringify({ rag: { embedding: { allowRemoteModels: false } } }),
);

const lattice = await import('@qcqx/lattice-services');
const core = await import('@qcqx/lattice-core');
const { createServer } = await import('../src/server/app');
const { signJwt, verifyJwt, extractToken } = await import('../src/server/auth');
const { createSseStream } = await import('../src/server/sse');

const app = await createServer();

const get = (url: string, headers?: Record<string, string>) =>
  app.inject({ method: 'GET', url, headers });
const post = (url: string, payload?: unknown, headers?: Record<string, string>) =>
  app.inject({ method: 'POST', url, payload: payload as never, headers });
const del = (url: string) => app.inject({ method: 'DELETE', url });

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

afterAll(async () => {
  await app.close();
  core.closeDb();
  fixture.cleanup();
});

// ── 任务扩展读接口 ──

test('tasks 扩展：context / lineage / tree / active checkpoints / relations', async () => {
  const context = await get('/api/tasks/task-alpha-1/context');
  assert.equal(context.statusCode, 200);
  assert.equal(typeof context.json(), 'object');

  const lineage = await get('/api/tasks/task-alpha-1/lineage');
  assert.equal(lineage.statusCode, 200);

  const tree = await get('/api/tasks/task-alpha-1/tree');
  assert.equal(tree.statusCode, 200);

  const active = await get('/api/checkpoints/active');
  assert.equal(active.statusCode, 200);
  assert.ok(Array.isArray(active.json()));

  const relations = await get('/api/relations');
  assert.equal(relations.statusCode, 200);
  assert.ok(
    (relations.json() as Array<{ id: string }>).some((r) => r.id === 'rel-1'),
    '应包含 fixture 关系 rel-1',
  );
});

// ── 项目扩展读接口 ──

test('projects 扩展：git-status / local-paths / specs / tasks / relations / paths / content', async () => {
  const git = await get('/api/projects/alpha/git-status');
  assert.equal(git.statusCode, 200);
  assert.equal(git.json(), null, '非 git 仓库应返回 null');

  const paths = await get('/api/projects/alpha/local-paths');
  assert.equal(paths.statusCode, 200);
  assert.deepEqual((paths.json() as { paths: string[] }).paths, [fixture.workspace]);

  const specs = await get('/api/projects/alpha/specs');
  assert.equal(specs.statusCode, 200);
  assert.ok(
    (specs.json() as Array<{ fileName: string }>).some((s) => s.fileName === 'project-spec.md'),
  );

  const tasks = await get('/api/projects/alpha/tasks');
  assert.equal(tasks.statusCode, 200);
  assert.ok((tasks.json() as Array<{ id: string }>).some((t) => t.id === 'task-alpha-1'));

  const relations = await get('/api/projects/alpha/relations');
  assert.equal(relations.statusCode, 200);
  assert.ok((relations.json() as Array<{ id: string }>).some((r) => r.id === 'rel-1'));

  const entityPath = await get('/api/paths/task-dir/task-alpha-1');
  assert.equal(entityPath.statusCode, 200);
  assert.match((entityPath.json() as { path: string }).path, /task-alpha-1/);

  const badPathType = await get('/api/paths/unknown-type/task-alpha-1');
  assert.equal((badPathType.json() as { error: string }).error, 'bad_request');

  const content = await get('/api/content/prd/task-alpha-1');
  assert.equal(content.statusCode, 200);
  assert.match((content.json() as { content: string }).content, /Contract fixture PRD/);

  const specContent = await post('/api/spec/content', { specId: 'spec-aaaa0001' });
  assert.equal(specContent.statusCode, 200);
  assert.match((specContent.json() as { content: string }).content, /user spec body/);

  const missing = await get('/api/content/spec/not-exist');
  assert.equal((missing.json() as { error: string }).error, 'not_found');
});

// ── 项目分组 / 更新 / 关系 ──

test('project-groups：tree / impact / create / rename / move / remove 全链路', async () => {
  const empty = await get('/api/project-groups');
  assert.equal(empty.statusCode, 200);

  const bad = await post('/api/project-groups/create', { parentRef: null, name: '' });
  assert.equal((bad.json() as { success: boolean }).success, false);

  const root = await post('/api/project-groups/create', { parentRef: null, name: '团队' });
  assert.equal(root.statusCode, 200);
  assert.equal((root.json() as { success: boolean }).success, true);

  const child = await post('/api/project-groups/create', { parentRef: '团队', name: '前端' });
  assert.equal((child.json() as { path: string }).path, '团队/前端');

  const impact = await get('/api/project-groups/impact?ref=团队');
  assert.equal(impact.statusCode, 200);

  const rename = await post('/api/project-groups/rename', {
    ref: '团队/前端',
    newName: '前端组',
  });
  assert.equal((rename.json() as { success: boolean }).success, true);

  const move = await post('/api/project-groups/move', {
    ref: '团队/前端组',
    newParentRef: null,
  });
  assert.equal((move.json() as { success: boolean }).success, true);

  const remove = await post('/api/project-groups/remove', { ref: '团队' });
  assert.equal((remove.json() as { success: boolean }).success, true);

  const badRef = await post('/api/project-groups/rename', { ref: '不存在/分组', newName: 'x' });
  assert.equal((badRef.json() as { success: boolean }).success, false);
});

test('projects update：名称/描述/标签/分组落盘；未知分组移除给出 unknownRemovals', async () => {
  const updated = await post('/api/projects/alpha/update', {
    name: 'Alpha 更新',
    description: 'web 更新',
    tags: ['web', 'test'],
    addGroups: ['发布/稳定'],
  });
  const body = updated.json() as { success: boolean; createdPaths: string[] };
  assert.equal(body.success, true);
  assert.ok(body.createdPaths.includes('发布/稳定'));

  const info = await get('/api/projects/alpha');
  const project = info.json() as { name: string; description: string; tags: string[] };
  assert.equal(project.name, 'Alpha 更新');
  assert.equal(project.description, 'web 更新');
  assert.deepEqual(project.tags, ['web', 'test']);

  const unknown = await post('/api/projects/alpha/update', { removeGroups: ['不存在'] });
  assert.ok((unknown.json() as { unknownRemovals: string[] }).unknownRemovals.includes('不存在'));
});

test('relations：新增与删除项目关系', async () => {
  const added = await post('/api/projects/alpha/relations', {
    projectB: 'beta',
    type: 'related',
    description: 'web 关系',
  });
  const { id } = added.json() as { success: boolean; id: string };
  assert.ok(id);

  const removed = await del(`/api/projects/alpha/relations/${id}`);
  assert.equal((removed.json() as { success: boolean }).success, true);
});

test('projects remove：beta 项目移入垃圾桶', async () => {
  const removed = await post('/api/projects/beta/remove');
  assert.equal((removed.json() as { success: boolean }).success, true);
  const projects = await lattice.listProjects('tester');
  assert.ok(!projects.some((p) => p.id === 'beta'));
});

// ── 用户管理 ──

test('users：list / create / switch / rename / remove 与非法用户名边界', async () => {
  const list = await get('/api/users');
  assert.equal(list.statusCode, 200);
  const usersBody = list.json() as { users: string[]; currentUser: string };
  assert.ok(usersBody.users.includes('tester'));
  assert.equal(usersBody.currentUser, 'tester');

  const invalid = await post('/api/users/create', { name: '../evil' });
  assert.equal((invalid.json() as { error: string }).error, 'bad_request');

  const created = await post('/api/users/create', { name: 'alice' });
  assert.equal((created.json() as { success: boolean }).success, true);

  await post('/api/users/switch', { username: 'alice' });
  const afterSwitch = (await get('/api/users')).json() as { currentUser: string };
  assert.equal(afterSwitch.currentUser, 'alice');
  await post('/api/users/switch', { username: 'tester' });

  const renamed = await post('/api/users/rename', { oldName: 'alice', newName: 'bob' });
  assert.equal((renamed.json() as { success: boolean }).success, true);

  const renameMissing = await post('/api/users/rename', { oldName: 'ghost', newName: 'ghost2' });
  assert.equal((renameMissing.json() as { error: string }).error, 'rename_failed');

  const removeCurrent = await post('/api/users/remove', { name: 'tester' });
  assert.equal((removeCurrent.json() as { error: string }).error, 'forbidden');

  const removeMissing = await post('/api/users/remove', { name: 'nobody' });
  assert.equal((removeMissing.json() as { error: string }).error, 'not_found');

  const removed = await post('/api/users/remove', { name: 'bob' });
  assert.equal((removed.json() as { success: boolean }).success, true);
});

test('scan：未指定目录 → bad_request（SSE 成功路径由专项测试覆盖）', async () => {
  const res = await post('/api/scan', { dirs: [] });
  assert.equal((res.json() as { error: string }).error, 'bad_request');
});

// ── RAG ──

test('rag：status / model status / model remove / update（SSE 完成事件）', async () => {
  const status = await get('/api/rag/status');
  assert.equal(status.statusCode, 200);

  const model = await get('/api/rag/model/status');
  const modelBody = model.json() as { installed: boolean; loaded: boolean };
  assert.equal(typeof modelBody.installed, 'boolean');
  assert.equal(typeof modelBody.loaded, 'boolean');

  const removed = await post('/api/rag/model/remove');
  assert.equal((removed.json() as { success: boolean }).success, true);

  const update = await post('/api/rag/update');
  assert.equal(update.statusCode, 200);
  assert.match(update.body, /data: .*"done":true/);
});

// ── Spec 管理 ──

test('specs init：user 层创建；非法路径/层级边界', async () => {
  const created = await post('/api/specs/init', {
    relativePath: 'web-note.md',
    scope: 'user',
    title: 'Web 规范',
    description: 'web 创建',
    tags: 'a,b',
  });
  assert.equal((created.json() as { success: boolean }).success, true);
  const file = join(fixture.home, 'users', 'tester', 'spec', 'web-note.md');
  const text = readFileSync(file, 'utf-8');
  assert.match(text, /title: Web 规范/);
  assert.match(text, /- a/);

  const traversal = await post('/api/specs/init', {
    relativePath: '../escape.md',
    scope: 'user',
    title: 'x',
    description: '',
  });
  assert.equal((traversal.json() as { error: string }).error, 'bad_request');

  const projectScope = await post('/api/specs/init', {
    relativePath: 'p.md',
    scope: 'project',
    title: 'x',
    description: '',
  });
  assert.equal((projectScope.json() as { error: string }).error, 'bad_request');
});

test('spec frontmatter：更新保留 id；未知/坏 YAML 走错误分支', async () => {
  const ok = await post('/api/specs/spec-aaaa0001/frontmatter', {
    title: '用户规范（改）',
    description: '新描述',
    tags: 'x,y',
  });
  assert.equal((ok.json() as { success: boolean }).success, true);
  const updated = readFileSync(
    join(fixture.home, 'users', 'tester', 'spec', 'alpha-spec.md'),
    'utf-8',
  );
  assert.match(updated, /title: 用户规范（改）/);
  assert.match(updated, /id: spec-aaaa0001/, '必须保留原 id');

  const missing = await post('/api/specs/spec-doesnotexist/frontmatter', { title: 'x' });
  assert.equal((missing.json() as { error: string }).error, 'not_found');

  writeFileSync(
    join(fixture.home, 'users', 'tester', 'spec', 'broken.md'),
    '---\ntitle: [bad\n---\n',
  );
  const broken = await post('/api/specs/broken.md/frontmatter', { title: 'x' });
  assert.equal((broken.json() as { error: string }).error, 'parse_error');
});

test('specs lint/conflicts/templates：只读面可用；未知模板 not_found', async () => {
  const lint = await post('/api/specs/lint');
  assert.equal(lint.statusCode, 200);

  const conflicts = await post('/api/specs/conflicts');
  assert.equal(conflicts.statusCode, 200);

  const templates = await get('/api/spec-templates');
  assert.equal(templates.statusCode, 200);
  assert.ok(Array.isArray(templates.json()));

  const apply = await post('/api/spec-templates/apply', { name: 'definitely-missing-template' });
  assert.equal((apply.json() as { error: string }).error, 'not_found');
});

// ── config ──

test('config：global/local 读写、diffDefaults、非法键拒绝', async () => {
  const globalCfg = await get('/api/config?scope=global');
  assert.equal(globalCfg.statusCode, 200);

  const localDiff = await get('/api/config?scope=local&diffDefaults=true');
  assert.equal(localDiff.statusCode, 200);

  const setGlobal = await post('/api/config/set', {
    key: 'ui.theme',
    value: 'dark',
    scope: 'global',
  });
  assert.equal((setGlobal.json() as { success: boolean }).success, true);

  const setLocal = await post('/api/config/set', {
    key: 'editor',
    value: 'vscode',
    scope: 'local',
  });
  assert.equal((setLocal.json() as { success: boolean }).success, true);

  const badKey = await post('/api/config/set', {
    key: '__proto__.polluted',
    value: 1,
    scope: 'global',
  });
  assert.equal((badKey.json() as { error: string }).error, 'bad_request');

  const unsetGlobal = await post('/api/config/unset', { key: 'ui.theme', scope: 'global' });
  assert.equal((unsetGlobal.json() as { success: boolean }).success, true);
  const unsetLocal = await post('/api/config/unset', { key: 'editor', scope: 'local' });
  assert.equal((unsetLocal.json() as { success: boolean }).success, true);
});

// ── 任务管理 ──

test('task-management：状态/检查点非法值拒绝；创建/归档/删除链路', async () => {
  const badStatus = await post('/api/tasks/task-alpha-1/status', { status: 'weird' });
  assert.equal((badStatus.json() as { error: string }).error, 'bad_request');

  const okStatus = await post('/api/tasks/task-alpha-1/status', { status: 'completed' });
  assert.equal((okStatus.json() as { success: boolean }).success, true);
  await post('/api/tasks/task-alpha-1/status', { status: 'in_progress' });

  const badCp = await post('/api/tasks/task-alpha-1/checkpoint', {
    type: 'weird',
    title: 't',
    message: 'm',
  });
  assert.equal((badCp.json() as { error: string }).error, 'bad_request');

  const cp = await post('/api/tasks/task-alpha-1/checkpoint', {
    type: 'note',
    title: 'Web 检查点',
    message: '内容',
  });
  assert.equal((cp.json() as { success: boolean }).success, true);

  const created = await post('/api/tasks/create', {
    title: 'Web 创建任务',
    projectIds: ['alpha'],
  });
  const createdTask = (created.json() as { success: boolean; task: { id: string } }).task;
  assert.ok(createdTask.id);

  const archived = await post(`/api/tasks/${createdTask.id}/archive`);
  assert.equal((archived.json() as { success: boolean }).success, true);

  const removed = await post(`/api/tasks/${createdTask.id}/delete`);
  assert.equal((removed.json() as { success: boolean }).success, true);
});

// ── 垃圾桶 / doctor ──

test('doctor + trash：run / list(type) / restore / purge / empty', async () => {
  const doctor = await post('/api/doctor/run', {});
  const report = doctor.json() as { entries: unknown[] };
  assert.ok(Array.isArray(report.entries));

  const trash = await get('/api/trash?type=task');
  const items = trash.json() as Array<{ id: string; entityId: string; title: string }>;
  const webTask = items.find((i) => i.title === 'Web 创建任务');
  assert.ok(webTask, '删除的任务应在垃圾桶（task 过滤）');

  const restored = await post(`/api/trash/restore/${webTask.id}`);
  assert.equal((restored.json() as { success: boolean }).success, true);

  const task = await lattice.getTask('tester', webTask.entityId);
  assert.equal(task?.title, 'Web 创建任务');

  await post(`/api/tasks/${webTask.entityId}/delete`);
  const trashAgain = (await get('/api/trash?type=task')).json() as Array<{
    id: string;
    entityId: string;
  }>;
  const reDeleted = trashAgain.find((i) => i.entityId === webTask.entityId);
  assert.ok(reDeleted, '再次删除应生成新的垃圾桶条目');
  const purged = await post(`/api/trash/purge/${reDeleted.id}`);
  assert.equal((purged.json() as { success: boolean }).success, true);

  const empty = await post('/api/trash/empty');
  assert.equal((empty.json() as { success: boolean }).success, true);
});

// ── 内容保存 / 全局状态 ──

test('content save：写入 PRD；未知实体 not_found；open-with-editor 未知实体不触发宿主进程', async () => {
  const saved = await post('/api/content/save', {
    type: 'prd',
    entityId: 'task-alpha-1',
    content: '# 更新后的 PRD\n',
  });
  assert.equal((saved.json() as { success: boolean }).success, true);
  const content = readFileSync(
    join(fixture.home, 'users', 'tester', 'tasks', 'task-alpha-1', 'prd.md'),
    'utf-8',
  );
  assert.match(content, /更新后的 PRD/);

  const missing = await post('/api/content/save', {
    type: 'spec',
    entityId: 'spec-doesnotexist',
    content: 'x',
  });
  assert.equal((missing.json() as { error: string }).error, 'not_found');

  const openMissing = await post('/api/open-with-editor', {
    type: 'spec',
    entityId: 'spec-doesnotexist',
    app: 'vscode',
  });
  assert.equal((openMissing.json() as { error: string }).error, 'not_found');

  const global = await get('/api/global-status');
  assert.equal(global.statusCode, 200);
  assert.ok((global.json() as { home?: string }).home);

  const stats = await get('/api/stats');
  assert.equal(stats.statusCode, 200);
});

test('terminal：mode 查询可用', async () => {
  const res = await get('/api/terminal/mode');
  assert.equal(res.statusCode, 200);
  assert.match((res.json() as { mode: string }).mode, /^(pty|spawn)$/);
});

// ── sse 单元 ──

test('createSseStream：写头、send/done 事件与关闭保护', () => {
  const chunks: string[] = [];
  let ended = false;
  let closeCb: (() => void) | null = null;
  const reply = {
    raw: {
      writeHead: (code: number, headers: Record<string, string>) => {
        chunks.push(`${code}:${headers['Content-Type']}`);
      },
      on: (event: string, cb: () => void) => {
        if (event === 'close') closeCb = cb;
      },
      write: (chunk: string) => chunks.push(chunk),
      end: () => {
        ended = true;
      },
    },
  } as never;

  const sse = createSseStream(reply);
  assert.ok(chunks[0].startsWith('200:text/event-stream'));
  sse.send({ current: 1, total: 2, added: 1 });
  sse.done({ done: true, result: { added: 1 } });
  assert.ok(chunks.some((c) => c.includes('"current":1')));
  assert.ok(chunks.some((c) => c.includes('"done":true')));
  assert.equal(ended, true);
  assert.equal(sse.isClosed, false);

  closeCb!();
  const before = chunks.length;
  sse.send({ current: 2, total: 2 });
  assert.equal(chunks.length, before, '关闭后不再写入');
  assert.equal(sse.isClosed, true);
});

// ── 鉴权：JWT 单元 + 守卫链路（放最后：会改动全局 auth 配置） ──

test('JWT：签发/校验/篡改/过期/畸形 token', () => {
  const token = signJwt({ uid: 'tester' }, 'secret-1', 60);
  const payload = verifyJwt(token, 'secret-1');
  assert.equal(payload?.uid, 'tester');
  assert.equal(verifyJwt(token, 'secret-2'), null);

  const [h, p, s] = token.split('.');
  assert.equal(verifyJwt(`${h}.${p}.${s.slice(0, -2)}xx`, 'secret-1'), null);
  assert.equal(verifyJwt('not-a-token', 'secret-1'), null);
  assert.equal(verifyJwt(`${h}.${p}`, 'secret-1'), null);

  const expired = signJwt({ uid: 'tester' }, 'secret-1', -10);
  assert.equal(verifyJwt(expired, 'secret-1'), null);

  const req = {
    headers: { authorization: 'Bearer abc.def.ghi' },
    url: '/api/projects',
  } as never;
  assert.equal(extractToken(req), 'abc.def.ghi');
  const queryReq = { headers: {}, url: '/api/projects?token=q-token' } as never;
  assert.equal(extractToken(queryReq), 'q-token');
  const noneReq = { headers: {}, url: '/api/projects' } as never;
  assert.equal(extractToken(noneReq), null);
});

test('auth 守卫链路：未启用放行 → 设密码 → 401/登录/带 token 访问 → 清除密码', async () => {
  assert.equal(((await get('/api/auth/status')).json() as { enabled: boolean }).enabled, false);

  const early = await post('/api/auth/login', { password: 'x' });
  assert.equal(early.statusCode, 400);

  const tooShort = await post('/api/auth/password', { newPassword: '12' });
  assert.equal(tooShort.statusCode, 400);

  const set = await post('/api/auth/password', { newPassword: 'pass1234' });
  assert.equal((set.json() as { success: boolean }).success, true);
  assert.equal(((await get('/api/auth/status')).json() as { enabled: boolean }).enabled, true);

  const denied = await get('/api/projects');
  assert.equal(denied.statusCode, 401);
  assert.equal((denied.json() as { error: string }).error, 'unauthorized');

  const wrong = await post('/api/auth/login', { password: 'nope' });
  assert.equal(wrong.statusCode, 401);

  const login = await post('/api/auth/login', { password: 'pass1234', remember: true });
  const { token, expiresIn } = login.json() as { token: string; expiresIn: number };
  assert.ok(token);
  assert.equal(expiresIn, 30 * 24 * 60 * 60);

  const authorized = await get('/api/projects', { Authorization: `Bearer ${token}` });
  assert.equal(authorized.statusCode, 200);

  const queryToken = await get(`/api/projects?token=${encodeURIComponent(token)}`);
  assert.equal(queryToken.statusCode, 200);

  // 非 /api 路径不受守卫影响
  const spa = await get('/index.html');
  assert.notEqual(spa.statusCode, 401);

  const logout = await post('/api/auth/logout', undefined, { Authorization: `Bearer ${token}` });
  assert.equal((logout.json() as { success: boolean }).success, true);

  const clear = await post(
    '/api/auth/password',
    { newPassword: '' },
    { Authorization: `Bearer ${token}` },
  );
  assert.equal((clear.json() as { success: boolean }).success, true);
  assert.equal(((await get('/api/auth/status')).json() as { enabled: boolean }).enabled, false);

  const clearAgain = await post('/api/auth/password', { newPassword: '' });
  assert.equal(clearAgain.statusCode, 400);
});
