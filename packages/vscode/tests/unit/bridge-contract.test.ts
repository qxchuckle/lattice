/**
 * vscode bridge 契约测试：postMessage 绑定 ≡ services 直调（同一 fixture 数据根）。
 * bridge-requests 是 vscode-free 的，可直接在 Node 测试环境跑。
 *
 * 注：vscode 包为 CJS，测试用 beforeAll() 动态加载（避免顶层 await 的转换限制）。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { createFixtureHome } from '../../../services/tests/fixture';

const fixture = createFixtureHome();
process.env.LATTICE_HOME = fixture.home;

let data: InstanceType<typeof import('../../src/data/service').LatticeDataService>;
let snapshot: InstanceType<typeof import('../../src/state/snapshot').SnapshotStore>;
let handleBridgeRequest: typeof import('../../src/webview/bridge-requests').handleBridgeRequest;
let lattice: typeof import('@qcqx/lattice-services');

beforeAll(async () => {
  const { LatticeDataService } = await import('../../src/data/service');
  const { SnapshotStore } = await import('../../src/state/snapshot');
  const { handleBridgeRequest: handler } = await import('../../src/webview/bridge-requests');
  lattice = await import('@qcqx/lattice-services');

  data = new LatticeDataService();
  snapshot = new SnapshotStore({ data });
  handleBridgeRequest = handler;
});

afterAll(() => {
  data?.dispose();
  fixture.cleanup();
});

test('bridge getSnapshot ≡ services（id 集合一致 + spec 行契约完整）', async () => {
  const snap = (await handleBridgeRequest({ snapshot }, 'getSnapshot', {})) as {
    projects: Array<{ id?: string }>;
    tasks: Array<{ id: string }>;
    specs: Array<{ id?: string; fileName?: string; scope?: string; frontmatter?: unknown }>;
    relations: Array<{ id: string }>;
  };
  const [projects, tasks, specs, relations] = await Promise.all([
    lattice.listProjects('tester'),
    lattice.listTasks('tester'),
    lattice.listSpecs('tester'),
    lattice.listRelations('tester'),
  ]);
  assert.deepEqual(
    snap.projects.map((p) => p.id ?? '').sort(),
    projects.map((p) => p.id ?? '').sort(),
  );
  assert.deepEqual(snap.tasks.map((t) => t.id).sort(), tasks.map((t) => t.id).sort());
  assert.equal(snap.specs.length, specs.length);
  assert.deepEqual(snap.relations.map((r) => r.id).sort(), relations.map((r) => r.id).sort());
  // 回归守卫：spec 行必须带 frontmatter/fileName（历史崩溃点：桥自造精简形状）
  for (const spec of snap.specs) {
    assert.ok(spec.frontmatter, 'spec.frontmatter missing');
    assert.equal(typeof spec.fileName, 'string');
    assert.ok(spec.scope, 'spec.scope missing');
  }
});

test('bridge getTaskDetail ≡ services.getTaskDetail', async () => {
  const fromBridge = (await handleBridgeRequest({ snapshot }, 'getTaskDetail', {
    id: 'task-alpha-1',
  })) as { task: { title: string } | null; progress: Array<{ id: string }> };
  const expected = await lattice.getTaskDetail('tester', 'task-alpha-1');
  assert.equal(fromBridge.task?.title, expected.task?.title);
  assert.deepEqual(
    fromBridge.progress.map((p) => p.id),
    expected.progress.map((p) => p.id),
  );
});

test('bridge getProjectDetail ≡ services.getProjectDetail', async () => {
  const fromBridge = (await handleBridgeRequest({ snapshot }, 'getProjectDetail', {
    id: 'alpha',
  })) as {
    project: { name?: string } | null;
    tasks: Array<{ id: string }>;
    relations: Array<{ id: string }>;
    specs: unknown[];
  };
  const expected = await lattice.getProjectDetail('tester', 'alpha');
  assert.equal(fromBridge.project?.name, expected.project?.name);
  assert.deepEqual(
    fromBridge.tasks.map((t) => t.id).sort(),
    expected.tasks.map((t) => t.id).sort(),
  );
  assert.deepEqual(
    fromBridge.relations.map((r) => r.id).sort(),
    expected.relations.map((r) => r.id).sort(),
  );
  assert.equal(fromBridge.specs.length, expected.specs.length);
});
