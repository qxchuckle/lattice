/**
 * web 契约测试：HTTP 绑定 ≡ services 直调（同一 fixture 数据根）。
 * 用 fastify 的 inject 在进程内请求，不需要真实端口。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { createFixtureHome } from '../../services/tests/fixture';

const fixture = createFixtureHome();
process.env.LATTICE_HOME = fixture.home;

const lattice = await import('@qcqx/lattice-services');
const core = await import('@qcqx/lattice-core');
const { createServer } = await import('../src/server/app');

const app = await createServer();

afterAll(async () => {
  await app.close();
  core.closeDb();
  fixture.cleanup();
});

test('GET /api/projects ≡ services.listProjects', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Array<{ id?: string }>;
  const expected = await lattice.listProjects('tester');
  assert.deepEqual(body.map((p) => p.id ?? '').sort(), expected.map((p) => p.id ?? '').sort());
});

test('GET /api/tasks ≡ services.listTasks', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tasks' });
  const body = res.json() as Array<{ id: string }>;
  const expected = await lattice.listTasks('tester');
  assert.deepEqual(body.map((t) => t.id).sort(), expected.map((t) => t.id).sort());
});

test('GET /api/specs ≡ services.listSpecs（分层数量一致）', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/specs' });
  const body = res.json() as { global: unknown[]; user: unknown[]; project: unknown[] };
  const entries = await lattice.listSpecs('tester');
  assert.equal(body.global.length, entries.filter((e) => e.scope === 'global').length);
  assert.equal(body.user.length, entries.filter((e) => e.scope === 'user').length);
  assert.equal(body.project.length, entries.filter((e) => e.scope === 'project').length);
});

test('GET /api/stats ≡ services.getStats', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/stats' });
  assert.deepEqual(res.json(), await lattice.getStats('tester'));
});

test('GET /api/tasks/:id ≡ services.getTask', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tasks/task-alpha-1' });
  const body = res.json() as { id: string; title: string };
  const expected = await lattice.getTask('tester', 'task-alpha-1');
  assert.equal(body.id, expected?.id);
  assert.equal(body.title, expected?.title);
});

test('GET /api/tasks/:id/progress ≡ services.listCheckpoints', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tasks/task-alpha-1/progress' });
  const body = res.json() as Array<{ id: string }>;
  const expected = await lattice.listCheckpoints('tester', 'task-alpha-1');
  assert.deepEqual(
    body.map((c) => c.id),
    expected.map((c) => c.id),
  );
});

test('GET /api/projects/:id ≡ services.getProject', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects/alpha' });
  const body = res.json() as { name?: string };
  const expected = await lattice.getProject('tester', 'alpha');
  assert.equal(body.name, expected?.name);
});

/** JSON 往返归一：HTTP 序列化会抹掉 undefined 字段，对比前先同构化 */
function jsonRoundTrip<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

test('GET /api/project-groups ≡ services.getProjectGroupTree（分组树同构）', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/project-groups' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), jsonRoundTrip(await lattice.getProjectGroupTree('tester')));
});

test('GET /api/relations ≡ services.listRelations', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/relations' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), jsonRoundTrip(await lattice.listRelations('tester')));
});

test('GET /api/checkpoints/active ≡ services.listActiveCheckpoints', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/checkpoints/active' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), jsonRoundTrip(await lattice.listActiveCheckpoints('tester')));
});

test('GET /api/users ≡ services.listUsers + currentUsername', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/users' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { users: string[]; currentUser: string };
  assert.deepEqual(body.users, await lattice.listUsers());
  assert.equal(body.currentUser, await lattice.currentUsername());
});

test('GET /api/global-status ≡ services.getGlobalStatus', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/global-status' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), jsonRoundTrip(await lattice.getGlobalStatus()));
});

// 注：/api/search 依赖 RAG 索引与 embedding 模型（首次调用可能触发模型加载），
// 不适合在离线契约测试中做断言；其数据面（services.search）由类型与集成测试覆盖。
