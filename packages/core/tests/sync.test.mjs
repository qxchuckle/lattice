import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdir, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import {
  computeDomainHash,
  validateRoute,
  parseRoutes,
  deriveContractId,
  encodeContractDirName,
  decodeContractDirName,
  computeContribution,
  pushDomain,
  joinDomain,
  unlinkDomain,
  listDomains,
  readBaseline,
} from '../dist/index.mjs';
import {
  createTempLatticeHome,
  assertIsolatedLatticeHome,
  putFile,
  createBareRemote,
} from './helpers.mjs';

// S2：域同步核心（routes 语法 / 契约 ID / 贡献集白名单 / push 增量 /
// 互删护栏 / 退出传播 / 指纹保守 / join-unlink / 冲突逃生）
// 红线：全部 LATTICE_HOME 指向 mkdtemp 临时目录；远端一律本地 bare 仓。

let env;
let bare;

const USERNAME = 't';
const CONTRACT_A = 'git:aaa111bbb222ccc3'; // work-app
const CONTRACT_B = 'remote:ddd444eee555fff6'; // personal-site
const DIR_A = encodeContractDirName(CONTRACT_A);
const TASK_T1 = '2026-08-19-test-task-t1';

/** 搭主数据：两项目（一 git 衍生一 remote 衍生）+ 两任务 + 用户/全局 spec + 敏感物 */
async function seedMainData(home, username = USERNAME) {
  const users = join(home, 'users', username);
  await putFile(
    join(users, 'projects', encodeContractDirName(CONTRACT_A), 'project.json'),
    JSON.stringify({ ids: [CONTRACT_A], name: 'work-app' }, null, 2),
  );
  await putFile(
    join(users, 'projects', encodeContractDirName(CONTRACT_A), 'spec', 'api.md'),
    '---\ntitle: api\n---\n工作项目规范\n',
  );
  await putFile(
    join(users, 'projects', encodeContractDirName(CONTRACT_B), 'project.json'),
    JSON.stringify({ ids: ['legacy:xyz', CONTRACT_B], name: 'personal-site' }, null, 2),
  );
  await putFile(
    join(users, 'tasks', TASK_T1, 'task.json'),
    JSON.stringify(
      {
        id: TASK_T1,
        title: 'T1',
        status: 'in_progress',
        created: '2026-08-19T10:00:00.000Z',
        projects: [CONTRACT_A],
      },
      null,
      2,
    ),
  );
  await putFile(join(users, 'tasks', TASK_T1, 'prd.md'), '# T1 PRD\n');
  await putFile(
    join(users, 'tasks', '2026-08-19-private-task', 'task.json'),
    JSON.stringify(
      {
        id: '2026-08-19-private-task',
        title: 'P',
        status: 'in_progress',
        created: '2026-08-19T11:00:00.000Z',
      },
      null,
      2,
    ),
  );
  await putFile(join(users, 'spec', 'commit-style.md'), '---\ntitle: commit\n---\n提交规范\n');
  await putFile(join(home, 'spec', 'team-convention.md'), '---\ntitle: 团队约定\n---\n全局规范\n');
  // 白名单外敏感物：泄漏断言用
  await putFile(
    join(home, 'config', 'config-local.json'),
    JSON.stringify({ username, webAuth: { secret: 'TOP-SECRET' } }),
  );
}

function bareFiles() {
  assertIsolatedLatticeHome();
  // bare 仓无工作树，用 ls-tree 列 HEAD 树内容
  return execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
    cwd: join(bare.barePath),
    encoding: 'utf-8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

beforeEach(async () => {
  env = await createTempLatticeHome();
  bare = await createBareRemote('domain');
  await seedMainData(env.latticeHome);
});

afterEach(async () => {
  await env.cleanup();
  await rm(bare.tmpRoot, { recursive: true, force: true });
});

// ─── 纯逻辑 ───

test('routes 语法："*" 与三类前缀合法，无前缀非法', () => {
  assert.doesNotThrow(() => validateRoute('*'));
  assert.doesNotThrow(() => validateRoute('project:work-*'));
  assert.doesNotThrow(() => validateRoute('user-spec:commit-*.md'));
  assert.doesNotThrow(() => validateRoute('global-spec:**'));
  assert.throws(() => validateRoute('anything'), /非法 route/);
  assert.throws(() => validateRoute('project:'), /不能为空/);
});

test('routes 解析：分类收集 + matchAll', () => {
  const p = parseRoutes(['*', 'project:a-*']);
  assert.equal(p.matchAll, true);
  const q = parseRoutes(['project:work-*', 'user-spec:c*.md', 'global-spec:team*']);
  assert.deepEqual(q, {
    matchAll: false,
    projectGlobs: ['work-*'],
    userSpecGlobs: ['c*.md'],
    globalSpecGlobs: ['team*'],
  });
});

test('域 hash：确定、区分 branch', () => {
  assert.equal(computeDomainHash('r1', 'main'), computeDomainHash('r1', 'main'));
  assert.notEqual(computeDomainHash('r1', 'main'), computeDomainHash('r1', 'dev'));
});

test('契约 ID：git 优先、remote 兜底、无衍生 null；目录名编码对称', () => {
  assert.equal(deriveContractId(['legacy:x', 'remote:bbb', 'git:aaa']), 'git:aaa');
  assert.equal(deriveContractId(['legacy:x', 'remote:bbb']), 'remote:bbb');
  assert.equal(deriveContractId(['legacy:x']), null);
  assert.equal(decodeContractDirName(encodeContractDirName('git:abc123')), 'git:abc123');
});

// ─── 贡献集（白名单 F2） ───

test('贡献集 matchAll：四类全进 + 白名单外绝不进（泄漏断言）', async () => {
  const plan = await computeContribution(USERNAME, ['*']);
  const dests = plan.files.map((f) => f.destRel);
  assert.ok(
    dests.some((d) => d.startsWith(`users/${USERNAME}/projects/${DIR_A}/`)),
    '项目 A 进贡献集',
  );
  assert.ok(
    dests.some((d) => d.startsWith(`users/${USERNAME}/tasks/${TASK_T1}/`)),
    '关联任务进贡献集',
  );
  assert.ok(
    dests.some((d) => d === `users/${USERNAME}/spec/commit-style.md`),
    '用户 spec 进贡献集',
  );
  assert.ok(
    dests.some((d) => d === 'spec/team-convention.md'),
    '全局 spec 进贡献集',
  );
  // 白名单红线：config/缓存绝不在贡献集
  assert.ok(!dests.some((d) => d.includes('config')), 'config 不得进贡献集');
  assert.ok(!dests.some((d) => d.includes('.cache')), 'cache 不得进贡献集');
  // matchAll 下 tasks 目录全量属白名单：无关联任务也随行
  assert.ok(
    dests.some((d) => d.includes('private-task')),
    'matchAll 下无关联任务随行（tasks 全量）',
  );
});

test('贡献集 selective：project 规则命中 name glob，未命中项不进', async () => {
  const plan = await computeContribution(USERNAME, ['project:work-*']);
  const dests = plan.files.map((f) => f.destRel);
  assert.ok(
    dests.some((d) => d.startsWith(`users/${USERNAME}/projects/${DIR_A}/`)),
    '命中项目 A',
  );
  assert.ok(
    dests.some((d) => d.startsWith(`users/${USERNAME}/tasks/${TASK_T1}/`)),
    'A 的关联任务随行',
  );
  assert.ok(
    !dests.some(
      (d) => d.includes('personal-site') || d.includes(encodeContractDirName(CONTRACT_B)),
    ),
    '未命中项目 B 不进',
  );
  assert.ok(!dests.some((d) => d.includes('private-task')), '无关联任务不进');
  assert.ok(
    !dests.some((d) => d.startsWith(`users/${USERNAME}/spec/`)),
    '未声明 user-spec 规则时用户级 spec 不进',
  );
  assert.ok(!dests.some((d) => d.startsWith('spec/')), '未声明 global-spec 规则时全局 spec 不进');
});

// ─── push 增量 + 互删护栏 + 退出传播 ───

test('首次 push：bare 内容 = 贡献集，目录名为契约 ID 编码', async () => {
  const r = await pushDomain(USERNAME, { remote: bare.barePath, routes: ['*'] });
  assert.equal(r.status, 'pushed', r.message);
  const files = bareFiles();
  assert.ok(
    files.some((f) => f.startsWith(`users/${USERNAME}/projects/${DIR_A}/spec/api.md`)),
    '项目 spec 在 bare',
  );
  assert.ok(files.some((f) => f === `users/${USERNAME}/spec/commit-style.md`));
  assert.ok(!files.some((f) => f.includes('config-local')), '泄漏断言：config 不入 bare');
  const bl = await readBaseline(computeDomainHash(bare.barePath, 'main'));
  assert.ok(bl && bl.paths.length > 0, '指纹已写');
});

test('互删护栏（红线）：机器 B push 不同贡献，A 的内容不被删', async () => {
  // 机器 A push
  const rA = await pushDomain(USERNAME, { remote: bare.barePath, routes: ['*'] });
  assert.equal(rA.status, 'pushed');

  // 模拟机器 B：切换 LATTICE_HOME，造 B 的主数据（不同用户名、不同项目），join 同一 bare 并 push
  const homeB = await createTempLatticeHome();
  try {
    await putFile(
      join(homeB.latticeHome, 'config', 'config-local.json'),
      JSON.stringify({ username: 'b' }),
    );
    await putFile(
      join(
        homeB.latticeHome,
        'users',
        'b',
        'projects',
        encodeContractDirName('git:bbb999'),
        'project.json',
      ),
      JSON.stringify({ ids: ['git:bbb999'], name: 'b-app' }),
    );
    await putFile(
      join(homeB.latticeHome, 'users', 'b', 'spec', 'b-style.md'),
      '---\ntitle: b\n---\nB 规范\n',
    );
    const rB = await pushDomain('b', { remote: bare.barePath, routes: ['*'] });
    assert.equal(rB.status, 'pushed', rB.message);

    const files = bareFiles();
    assert.ok(
      files.some((f) => f.startsWith(`users/${USERNAME}/`)),
      'A 的内容仍在（未被 B 删除）',
    );
    assert.ok(
      files.some((f) => f.startsWith('users/b/')),
      'B 的内容已上',
    );
  } finally {
    await homeB.cleanup();
    // 恢复 A 的环境变量（cleanup 会删除 LATTICE_HOME）
    process.env.LATTICE_HOME = env.latticeHome;
  }
});

test('退出传播：本地删任务后 push，bare 中对应路径消失且仅消失我的', async () => {
  await pushDomain(USERNAME, { remote: bare.barePath, routes: ['*'] });
  // 本地删除 T1（主数据）
  await rm(join(env.latticeHome, 'users', USERNAME, 'tasks', TASK_T1), {
    recursive: true,
    force: true,
  });
  const r2 = await pushDomain(USERNAME, { remote: bare.barePath, routes: ['*'] });
  assert.equal(r2.status, 'pushed');
  assert.ok(r2.removed >= 2, `应退出 T1 的文件（task.json+prd.md），实际 ${r2.removed}`);
  const files = bareFiles();
  assert.ok(
    !files.some((f) => f.startsWith(`users/${USERNAME}/tasks/${TASK_T1}/`)),
    'T1 已从域退出',
  );
  assert.ok(
    files.some((f) => f.startsWith(`users/${USERNAME}/spec/`)),
    '我的 spec 仍在',
  );
});

test('指纹保守：指纹缺失 → 不删任何东西（no-changes）', async () => {
  await pushDomain(USERNAME, { remote: bare.barePath, routes: ['*'] });
  const before = bareFiles();
  // 删除指纹 + 本地删任务（模拟指纹丢失后的退出传播风险）
  const { getSyncBaselinePath } = await import('../dist/index.mjs');
  await rm(getSyncBaselinePath(computeDomainHash(bare.barePath, 'main')), { force: true });
  await rm(join(env.latticeHome, 'users', USERNAME, 'tasks', TASK_T1), {
    recursive: true,
    force: true,
  });
  const r2 = await pushDomain(USERNAME, { remote: bare.barePath, routes: ['*'] });
  assert.ok(['no-changes', 'pushed'].includes(r2.status), `实际 ${r2.status}:${r2.message}`);
  assert.equal(r2.removed, 0, '指纹缺失时不得执行删除');
  const after = bareFiles();
  assert.ok(
    after.includes(`users/${USERNAME}/tasks/${TASK_T1}/prd.md`),
    '无指纹时远端旧内容保留（保守）',
  );
  assert.ok(
    before.every((f) => after.includes(f)),
    '远端文件只增不减',
  );
});

test('pull 冲突逃生：镜像有未推送 commit 且远端分叉 → abort + 冲突清单 + 无 rebase 残留', async () => {
  const { mirrorDirOf, isRebaseInProgress } = await import('../dist/index.mjs');
  const domain = { remote: bare.barePath, routes: ['*'] };
  await pushDomain(USERNAME, domain);
  const mirrorDir = mirrorDirOf(domain);

  // 镜像侧制造未推送 commit（模拟上次 push 网络失败残留的中间态）。
  // 注意：git 命令必须显式 cwd，否则会在当前仓（lattice）误触发钩子。
  await putFile(
    join(mirrorDir, `users/${USERNAME}/spec/commit-style.md`),
    '---\ntitle: commit\n---\n镜像未推送版本\n',
  );
  execFileSync('git', ['add', '.'], { cwd: mirrorDir });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=local',
      '-c',
      'user.email=l@l',
      'commit',
      '-q',
      '--no-verify',
      '-m',
      'unpushed local change',
    ],
    { cwd: mirrorDir },
  );

  // 同事在远端推同文件的另一版本（真分叉）
  const stage = join(env.tmpRoot, 'foreign');
  execFileSync('git', ['clone', '-q', bare.barePath, stage]);
  await putFile(
    join(stage, `users/${USERNAME}/spec/commit-style.md`),
    '---\ntitle: commit\n---\n同事的版本\n',
  );
  execFileSync('git', ['add', '.'], { cwd: stage });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=x',
      '-c',
      'user.email=x@x',
      'commit',
      '-q',
      '--no-verify',
      '-m',
      'foreign change',
    ],
    { cwd: stage },
  );
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: stage });

  // 本地主数据也改同文件 → pushDomain 内 pull --rebase 必遇分叉冲突
  await putFile(
    join(env.latticeHome, 'users', USERNAME, 'spec', 'commit-style.md'),
    '---\ntitle: commit\n---\n本地的新版本\n',
  );
  const r2 = await pushDomain(USERNAME, domain);
  assert.equal(r2.status, 'pull-conflict', `期望 pull 冲突，实际 ${r2.status}:${r2.message}`);
  assert.ok(Array.isArray(r2.conflicts), '返回冲突清单');
  assert.equal(await isRebaseInProgress(mirrorDir), false, 'rebase 中间态已逃生');
  // 本地主数据未被污染
  const local = await readFile(
    join(env.latticeHome, 'users', USERNAME, 'spec/commit-style.md'),
    'utf-8',
  );
  assert.ok(local.includes('本地的新版本'));
});

// ─── join / unlink / list ───

test('join：配置登记 + 镜像就绪 + 摘要与安全提示；unlink 全清理', async () => {
  const jr = await joinDomain({ remote: bare.barePath, label: '测试域' }, USERNAME);
  assert.ok(jr.domainHash.length === 16);
  assert.ok(jr.mirrorDir.includes('.sync-domains'));
  assert.equal(jr.summary?.users, 0, '空 bare 域无用户');

  const domains = await listDomains();
  assert.equal(domains.length, 1);
  assert.equal(domains[0].label, '测试域');
  assert.equal(domains[0].pushState, '只读消费');
  assert.equal(domains[0].mirrorExists, true);

  const ur = await unlinkDomain(jr.domainHash);
  assert.equal(ur.label, '测试域');
  const after = await listDomains();
  assert.equal(after.length, 0);
  const mirrorEntries = await readdir(join(env.latticeHome, '.sync-domains')).catch(() => []);
  assert.equal(mirrorEntries.length, 0, '镜像目录已清');
});

test('join 摘要提示：同名用户 + 全局 spec 生效警告', async () => {
  // 先以 A 身份推送内容，再用同 username join → sameNameUserPresent
  await pushDomain(USERNAME, { remote: bare.barePath, routes: ['*'] });
  // 模拟新机器视角：清空本机域配置与镜像（bare 已有数据）
  const { readSyncDomains, ensureMirror } = await import('../dist/index.mjs');
  void readSyncDomains;
  void ensureMirror;
  const jr = await joinDomain({ remote: bare.barePath }, USERNAME);
  assert.equal(jr.summary?.sameNameUserPresent, true, '域里有同名用户');
  assert.ok(
    jr.warnings.some((w) => w.includes('同名')),
    '输出同名警告',
  );
  assert.ok(
    jr.warnings.some((w) => w.includes('全局 spec')),
    '输出全局 spec 生效提示',
  );
});
