import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, test, vi } from 'vitest';
import { createFixtureHome } from '../../services/tests/fixture';
import '../src/server/schemas';

const ptyState = vi.hoisted(() => ({ failNext: false }));
vi.mock('@homebridge/node-pty-prebuilt-multiarch', () => ({
  spawn: () => {
    if (ptyState.failNext) {
      ptyState.failNext = false;
      throw new Error('pty unavailable');
    }
    let dataCb: ((data: string) => void) | null = null;
    return {
      pid: 999,
      write: (data: string) =>
        dataCb?.(data.includes('terminal-deep') ? 'terminal-deep\r\n' : data),
      resize: () => {},
      kill: () => {},
      onData: (cb: (data: string) => void) => {
        dataCb = cb;
      },
      onExit: () => {},
    };
  },
}));

const fixture = createFixtureHome();
process.env.LATTICE_HOME = fixture.home;
writeFileSync(
  join(fixture.home, 'config', 'config.json'),
  JSON.stringify({
    rag: { embedding: { allowRemoteModels: false } },
  }),
);

const core = await import('@qcqx/lattice-core');
const { createServer } = await import('../src/server/app');
const app = await createServer();

const get = (url: string, headers?: Record<string, string>) =>
  app.inject({ method: 'GET', url, headers });
const post = (url: string, payload?: unknown, headers?: Record<string, string>) =>
  app.inject({ method: 'POST', url, payload: payload as never, headers });

let origin: string;
let domainBare: string;
let domainHash: string;
let domainPrefix: string;

function git(args: string[], cwd: string) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
}

async function makeDomainRemote(): Promise<string> {
  const bare = join(fixture.workspace, 'domain-deep.git');
  execFileSync('git', ['init', '--bare', '-q', bare]);
  const work = join(fixture.workspace, 'domain-deep-work');
  await mkdir(work, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
  await mkdir(join(work, 'users', 'alice', 'tasks', 'dtask-1'), { recursive: true });
  await writeFile(
    join(work, 'users', 'alice', 'tasks', 'dtask-1', 'task.json'),
    JSON.stringify({
      id: 'dtask-1',
      title: '域任务',
      status: 'planning',
      created: '2026-01-01T00:00:00.000Z',
    }),
  );
  await writeFile(join(work, 'users', 'alice', 'tasks', 'dtask-1', 'prd.md'), '# 域任务 PRD\n');
  await mkdir(join(work, 'users', 'alice', 'spec'), { recursive: true });
  await writeFile(
    join(work, 'users', 'alice', 'spec', 'domain-spec.md'),
    '---\nid: spec-domain01\ntitle: 域规范\n---\n\n域 spec 正文\n',
  );
  await mkdir(join(work, 'users', 'alice', 'projects', 'dp1'), { recursive: true });
  await writeFile(
    join(work, 'users', 'alice', 'projects', 'dp1', 'project.json'),
    JSON.stringify({ id: 'dp1', name: '域项目', ids: ['dp1'] }),
  );
  git(['add', '-A'], work);
  git(['commit', '-q', '-m', 'domain'], work);
  git(['push', '-q', bare, 'main'], work);
  return bare;
}

beforeAll(async () => {
  await core.initDb();
  origin = join(fixture.workspace, 'origin.git');
  execFileSync('git', ['init', '--bare', '-q', origin]);
  domainBare = await makeDomainRemote();
});

afterAll(async () => {
  await app.close();
  core.closeDb();
  fixture.cleanup();
});

test('git：status/commit/push/pull/sync/remotes/enable/sync-logs', async () => {
  const before = await get('/api/git/status');
  assert.equal(before.statusCode, 200);
  assert.equal((before.json() as { initialized: boolean }).initialized, false);
  const enable = await post('/api/git/enable', { remote: origin });
  assert.equal(enable.statusCode, 200, enable.body);
  const status = await get('/api/git/status');
  assert.equal(status.statusCode, 200);
  assert.equal((status.json() as { initialized: boolean }).initialized, true);

  await writeFile(join(fixture.home, 'spec', 'git-change.md'), '# git change\n');
  const committed = await post('/api/git/commit', { message: 'web commit' });
  assert.equal(committed.statusCode, 200);
  assert.equal(typeof (committed.json() as { success: boolean }).success, 'boolean');

  const remotes = await get('/api/git/remotes');
  assert.ok((remotes.json() as { name: string }[]).some((r) => r.name === 'origin'));
  const backup = join(fixture.workspace, 'backup.git');
  execFileSync('git', ['init', '--bare', '-q', backup]);
  const added = await post('/api/git/remotes/add', { name: 'backup', url: backup });
  assert.equal(added.statusCode, 200);
  const changed = await post('/api/git/remotes/set-url', { name: 'backup', url: backup });
  assert.equal(changed.statusCode, 200);
  const removed = await post('/api/git/remotes/remove', { name: 'backup' });
  assert.equal(removed.statusCode, 200);

  const push = await post('/api/git/push');
  assert.equal(push.statusCode, 200);
  const pull = await post('/api/git/pull');
  assert.equal(pull.statusCode, 200);
  const sync = await post('/api/git/sync');
  assert.equal(sync.statusCode, 200);

  const logs = await get('/api/git/sync-logs?target=origin&limit=10');
  assert.equal(logs.statusCode, 200);
  const allLogs = await get('/api/git/sync-logs?target=all&limit=5');
  assert.equal(allLogs.statusCode, 200);
  assert.ok(Array.isArray((allLogs.json() as { entries: unknown[] }).entries));
});

test('domains：join/list/data/preview/update/reorder/sync-logs/unlink + 域任务/规范回退', async () => {
  const empty = await get('/api/git/domains');
  assert.deepEqual(empty.json(), []);
  const emptyData = await get('/api/domains/data');
  assert.deepEqual((emptyData.json() as { domains: unknown[] }).domains, []);

  const joined = await post('/api/git/domains/join', {
    remote: domainBare,
    branch: 'main',
    label: 'D',
    use: 'reference',
    routes: ['*'],
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const joinedBody = joined.json() as { domainHash: string };
  domainHash = joinedBody.domainHash;
  domainPrefix = domainHash.slice(0, 6);

  const domains = await get('/api/git/domains');
  assert.equal((domains.json() as unknown[]).length, 1);
  const data = await get('/api/domains/data');
  const dataBody = data.json() as {
    domains: { hash: string; users: string[] }[];
    specs: { title: string }[];
    tasks: { id: string }[];
    projects: { name: string }[];
  };
  assert.equal(dataBody.domains[0].hash, domainHash);
  assert.ok(dataBody.domains[0].users.includes('alice'));
  assert.ok(dataBody.specs.some((s) => s.title === '域规范'));
  assert.ok(dataBody.tasks.some((t) => t.id === 'dtask-1'));
  assert.ok(dataBody.projects.some((p) => p.name === '域项目'));

  const preview = await post('/api/git/domains/preview', { hash: domainPrefix, routes: ['*'] });
  assert.equal(preview.statusCode, 200);
  const previewBad = await post('/api/git/domains/preview', { hash: 'ffff' });
  assert.equal(previewBad.statusCode, 500);

  const updated = await post('/api/git/domains/update', {
    hash: domainPrefix,
    label: 'D2',
    use: 'reference',
    routes: ['user-spec:*.md'],
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal((updated.json() as { domain: { label: string } }).domain.label, 'D2');
  const updateBad = await post('/api/git/domains/update', { hash: 'ffff', label: 'x' });
  assert.equal(updateBad.statusCode, 500);

  const reordered = await post('/api/git/domains/reorder', { hashes: [domainHash] });
  assert.equal(reordered.statusCode, 200);

  const domainTask = await get('/api/tasks/dtask-1');
  assert.equal((domainTask.json() as { title: string }).title, '域任务');
  const domainPrd = await get('/api/content/prd/dtask-1');
  assert.match((domainPrd.json() as { content: string }).content, /域任务 PRD/);
  const specs = await get('/api/specs');
  assert.ok(JSON.stringify(parseJson(specs.body)).includes('域规范'));
  const search = await get('/api/search?q=域规范&limit=5');
  assert.equal(search.statusCode, 200);

  const logs = await get('/api/git/sync-logs?target=all&limit=20');
  assert.equal(logs.statusCode, 200);

  const unlinked = await post('/api/git/domains/unlink', { hash: domainHash });
  assert.equal(unlinked.statusCode, 200);
  assert.deepEqual((await get('/api/git/domains')).json(), []);
});

function parseJson(body: string): unknown {
  return JSON.parse(body);
}

test('projects/content/open：跨用户/未知/路径安全/域镜像/搜索/聚合列表', async () => {
  const detail = await get('/api/projects/alpha');
  assert.equal(detail.statusCode, 200);
  const missing = await get('/api/projects/no-such-project');
  assert.equal((missing.json() as { error: string }).error, 'not_found');
  const crossUser = await get('/api/projects/tester:alpha');
  assert.ok(crossUser.statusCode === 200);
  const crossDir = join(fixture.workspace, 'cross-project');
  await mkdir(crossDir, { recursive: true });
  await core.registerProjectWithIds('tester', ['legacy:feedfacecafebeef'], crossDir, {
    gitRemotes: [],
    packageNames: [],
    monorepoPackages: [],
  });
  const crossLegacy = await get('/api/projects/tester:legacy:feedfacecafebeef');
  assert.equal((crossLegacy.json() as { id: string }).id, 'legacy:feedfacecafebeef');

  const paths = await get('/api/projects/alpha/local-paths');
  assert.equal(paths.statusCode, 200);
  const missingPaths = await get('/api/projects/no-such-project/local-paths');
  assert.equal((missingPaths.json() as { error: string }).error, 'not_found');
  const gitStatus = await get('/api/projects/no-such-project/git-status');
  assert.equal((gitStatus.json() as { error: string }).error, 'not_found');
  const unknownTasks = await get('/api/projects/no-such-project/tasks');
  assert.ok(Array.isArray(unknownTasks.json()));

  await post('/api/projects/alpha/update', { addGroups: ['深度/分组'] });
  const withGroups = await get('/api/projects/alpha');
  assert.ok((withGroups.json() as { groupPaths: string[] }).groupPaths.length > 0);

  const forbidden = await post('/api/open-path', { path: '/etc', app: 'vscode' });
  assert.equal((forbidden.json() as { error: string }).error, 'forbidden');
  const safe = await post('/api/open-path', {
    path: join(fixture.home, 'spec'),
    app: 'definitely-no-editor',
  });
  assert.ok(['exec_failed', 'success'].includes((safe.json() as { error?: string }).error ?? ''));
  const openMissing = await post('/api/open', {
    type: 'spec',
    entityId: 'spec-missing',
    app: 'vscode',
  });
  assert.equal((openMissing.json() as { error: string }).error, 'not_found');

  const saveMissing = await post('/api/content/save', {
    type: 'unknown',
    entityId: 'x',
    content: 'x',
  });
  assert.equal((saveMissing.json() as { error: string }).error, 'not_found');
  const contentMissing = await get('/api/content/prd/no-such-task');
  assert.equal((contentMissing.json() as { error: string }).error, 'not_found');
  const specMissingId = await post('/api/spec/content', {});
  assert.equal((specMissingId.json() as { error: string }).error, 'bad_request');

  // 域镜像文件读取：仅 .sync-domains 内
  const domainDir = core.getSyncDomainsDir();
  const mirrorFile = join(domainDir, 'deadbeef', 'users', 'alice', 'spec', 'm.md');
  await mkdir(join(mirrorFile, '..'), { recursive: true });
  await writeFile(mirrorFile, '镜像 spec');
  const mirror = await post('/api/spec/content', { specId: mirrorFile });
  assert.equal((mirror.json() as { content: string }).content, '镜像 spec');
  const outside = await post('/api/spec/content', { specId: '/etc/lattice-no-such-file' });
  assert.equal((outside.json() as { error: string }).error, 'not_found');

  const taskAll = await get('/api/tasks?allUser=true');
  assert.equal(taskAll.statusCode, 200);
  const taskProject = await get('/api/tasks?allUser=true&projectId=alpha');
  assert.equal(taskProject.statusCode, 200);
  const relations = await get('/api/relations?username=tester');
  assert.equal(relations.statusCode, 200);

  const globalSpecs = await get('/api/specs?scope=global');
  assert.ok(Array.isArray(globalSpecs.json()));
  const userSpecs = await get('/api/specs?scope=user');
  assert.ok(Array.isArray(userSpecs.json()));
  const projectSpecs = await get('/api/specs?scope=project&projectId=alpha');
  assert.ok(Array.isArray(projectSpecs.json()));
});

test('rag 深水 + scan/users 边界 + schemas 执行', async () => {
  await app.ready();
  const rebuild = await post('/api/rag/rebuild');
  assert.equal(rebuild.statusCode, 200);
  assert.match(rebuild.body, /"done":true/);
  const download = await post('/api/rag/model/download');
  assert.equal(download.statusCode, 200);
  assert.match(download.body, /"done":true/);

  const [first, second] = await Promise.all([post('/api/rag/rebuild'), post('/api/rag/rebuild')]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);

  const scan = await post('/api/scan', { dirs: [fixture.workspace] });
  assert.equal(scan.statusCode, 200);
  assert.match(scan.body, /"done":true/);

  await core.writeLocalConfig({
    username: 'tester',
    scanDirs: [fixture.workspace],
  });
  const scanFromConfig = await post('/api/scan', {});
  assert.equal(scanFromConfig.statusCode, 200);
  assert.match(scanFromConfig.body, /"done":true/);

  const badRename = await post('/api/users/rename', { oldName: '../x', newName: 'ok' });
  assert.equal((badRename.json() as { error: string }).error, 'bad_request');
  const badRemove = await post('/api/users/remove', { name: '../x' });
  assert.equal((badRemove.json() as { error: string }).error, 'bad_request');

  const editor = await post('/api/open-with-editor', {
    type: 'spec',
    entityId: 'spec-aaaa0001',
    app: 'definitely-no-editor',
  });
  assert.ok(['exec_failed', 'success'].includes((editor.json() as { error?: string }).error ?? ''));
});

function waitForMessage(
  ws: { on: (event: string, cb: (data: unknown) => void) => void },
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('terminal message timeout')), timeoutMs);
    ws.on('message', (raw: unknown) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (predicate(msg)) {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch {
        // ignore
      }
    });
  });
}

test('terminal WebSocket：pty/spawn 降级/init/input/resize/非法路径/坏消息/关闭', async () => {
  await app.ready();
  const mode = await get('/api/terminal/mode');
  assert.equal((mode.json() as { mode: string }).mode, 'pty');

  const ws = await app.injectWS('/api/terminal/ws');
  await new Promise((r) => setTimeout(r, 50));
  const modePromise = waitForMessage(ws, (m) => m.type === 'mode');
  ws.send('not-json');
  ws.send(JSON.stringify({ type: 'input', data: 'ignored-before-init\n' }));
  ws.send(JSON.stringify({ type: 'init', cwd: fixture.home, cols: 80, rows: 24 }));
  const modeMsg = await modePromise;
  assert.equal(modeMsg.mode, 'pty');
  const outputPromise = waitForMessage(
    ws,
    (m) => m.type === 'output' && String(m.data).includes('terminal-deep'),
    10000,
  );
  ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 30 }));
  ws.send(JSON.stringify({ type: 'input', data: 'echo terminal-deep\n' }));
  const output = await outputPromise;
  assert.match(String(output.data), /terminal-deep/);
  ws.terminate();

  // pty.spawn 抛错 → spawn 降级
  // 降级路径会 spawn 真实 $SHELL -i：固定为 /bin/sh，消除本地 zsh+powerlevel10k
  // 交互式启动慢（首屏渲染吞输入）导致的环境性超时；CI ubuntu 同为 /bin/sh 秒就绪
  const prevShell = process.env.SHELL;
  process.env.SHELL = '/bin/sh';
  ptyState.failNext = true;
  const fallback = await app.injectWS('/api/terminal/ws');
  await new Promise((r) => setTimeout(r, 50));
  const fallbackMode = waitForMessage(fallback, (m) => m.type === 'mode');
  fallback.send(JSON.stringify({ type: 'init', cwd: fixture.home }));
  const fallbackMsg = await fallbackMode;
  assert.equal(fallbackMsg.mode, 'spawn');
  // 软等待 shell 首帧输出（pipe stdio 下 prompt 可能不落 stdout，不阻塞断言）
  await waitForMessage(fallback, (m) => m.type === 'output', 1500).catch(() => {});
  const spawnOutput = waitForMessage(
    fallback,
    (m) => m.type === 'output' && String(m.data).includes('spawn-deep'),
    10000,
  );
  fallback.send(JSON.stringify({ type: 'input', data: 'echo spawn-deep\n' }));
  assert.match(String((await spawnOutput).data), /spawn-deep/);
  fallback.terminate();
  if (prevShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = prevShell;

  const bad = await app.injectWS('/api/terminal/ws');
  await new Promise((r) => setTimeout(r, 50));
  const errorPromise = waitForMessage(bad, (m) => m.type === 'error');
  const exitPromise = waitForMessage(bad, (m) => m.type === 'exit');
  bad.send(JSON.stringify({ type: 'init', cwd: '/etc' }));
  const err = await errorPromise;
  assert.match(String(err.message), /路径不在允许范围内/);
  await exitPromise;
  bad.terminate();
}, 20000);
