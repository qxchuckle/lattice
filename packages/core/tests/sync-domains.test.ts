import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  addSyncDomain,
  computeDomainHash,
  domainHashOf,
  mirrorDirOf,
  normalizeDomainConfig,
  parseRoutes,
  readSyncDomains,
  removeSyncDomain,
  resolveDomainRef,
  validateDomainConfig,
  validateRoute,
  writeSyncDomains,
} from '../src/sync/domain-config';
import {
  joinDomain,
  listDomains,
  peekDomain,
  summarizeMirror,
  syncDomains,
  unlinkDomain,
  updateDomain,
} from '../src/sync/sync';
import { createBareRemote, createTempLatticeHome, putFile } from './helpers';

const U = 't';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, version: 1 }),
  );
});

afterEach(async () => {
  await env.cleanup();
});

async function makeRemote(name: string, users: string[] = ['alice']) {
  const remote = await createBareRemote(name);
  const work = join(env.tmpRoot, `${name}-work`);
  await mkdir(work, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
  for (const user of users) {
    await putFile(
      join(work, 'users', user, 'spec', 'guide.md'),
      `---\nid: spec-${user}123\ntitle: ${user} guide\n---\n\nbody`,
    );
    await putFile(
      join(work, 'users', user, 'projects', 'p1', 'project.json'),
      JSON.stringify({ id: `legacy:${user}0000`, name: 'p1' }),
    );
  }
  await putFile(
    join(work, 'spec', 'global.md'),
    '---\nid: spec-global9\ntitle: Global Title\n---\n\nbody',
  );
  execFileSync('git', ['add', '-A'], { cwd: work });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], {
    cwd: work,
  });
  execFileSync('git', ['push', '-q', remote.barePath, 'main'], { cwd: work });
  return remote;
}

test('domain-config：校验/解析/hash/读写/重复', async () => {
  assert.deepEqual(normalizeDomainConfig({ remote: 'r' }), { remote: 'r', branch: 'main' });
  assert.equal(computeDomainHash('r', 'main'), computeDomainHash('r', 'main'));
  assert.match(computeDomainHash('r', 'main'), /^[0-9a-f]{16}$/);
  const d = { remote: 'r', branch: 'dev' };
  assert.equal(domainHashOf(d), computeDomainHash('r', 'dev'));
  assert.match(mirrorDirOf(d), /\.sync-domains/);

  assert.doesNotThrow(() => validateRoute('*'));
  assert.doesNotThrow(() => validateRoute('project:foo/*'));
  assert.doesNotThrow(() => validateRoute('!user-spec:secret-*.md'));
  assert.throws(() => validateRoute('foo/*'), /非法 route/);
  assert.throws(() => validateRoute('user-spec:'), /glob 不能为空/);

  const parsed = parseRoutes([
    '*',
    'project:app/*',
    '!project:app/secret',
    'user-spec:*.md',
    'global-spec:guide.md',
  ]);
  assert.equal(parsed.matchAll, true);
  assert.deepEqual(parsed.projectGlobs, ['app/*', '!app/secret']);
  assert.deepEqual(parsed.userSpecGlobs, ['*.md']);
  assert.deepEqual(parsed.globalSpecGlobs, ['guide.md']);
  assert.deepEqual(parseRoutes(undefined), {
    matchAll: false,
    projectGlobs: [],
    userSpecGlobs: [],
    globalSpecGlobs: [],
  });

  assert.throws(() => validateDomainConfig({ remote: ' ' }), /remote 不能为空/);
  assert.throws(() => validateDomainConfig({ remote: 'r', branch: 'bad branch' }), /含非法字符/);
  assert.throws(() => validateDomainConfig({ remote: 'r', use: 'wat' as never }), /use 须为/);
  assert.throws(() => validateDomainConfig({ remote: 'r', routes: ['bad'] }), /非法 route/);

  assert.deepEqual(await readSyncDomains(), []);
  const domain = { remote: 'https://example.com/r.git', label: 'R' };
  assert.deepEqual(await addSyncDomain(domain), [domain]);
  assert.equal((await readSyncDomains()).length, 1);
  await assert.rejects(() => addSyncDomain(domain), /域已存在/);
  await assert.rejects(() => writeSyncDomains([domain, domain]), /域重复/);
  await assert.rejects(() => removeSyncDomain('deadbeefdeadbeef'), /未找到域/);
  assert.deepEqual(await removeSyncDomain(domainHashOf(domain)), []);

  // resolveDomainRef：命中 / 未命中（空、非空清单）
  const d1 = { remote: 'https://a/1.git', label: 'One' };
  const d2 = { remote: 'https://a/2.git' };
  await writeSyncDomains([d1, d2]);
  const hash1 = domainHashOf(d1);
  assert.equal((await resolveDomainRef(hash1)).domain?.remote, d1.remote);
  assert.equal((await resolveDomainRef(hash1.slice(0, 6))).domain?.remote, d1.remote);
  assert.match((await resolveDomainRef('ffff')).error ?? '', /已关联的域/);
  await writeSyncDomains([]);
  assert.match((await resolveDomainRef('ffff')).error ?? '', /尚未关联任何域/);

  // writeSyncDomains 需要已初始化 config
  const configPath = join(env.latticeHome, 'config', 'config-local.json');
  const { rm } = await import('node:fs/promises');
  await rm(configPath);
  await assert.rejects(() => writeSyncDomains([d1]), /config-local\.json 不存在/);
});

test('summarizeMirror / peekDomain：用户/项目/spec/全局标题/同名警告', async () => {
  const remote = await makeRemote('peek', [U, 'alice']);
  try {
    const { execFileSync: run } = await import('node:child_process');
    const tmp = join(env.tmpRoot, 'peek-mirror');
    run('git', ['clone', '-q', remote.barePath, tmp]);
    const summary = await summarizeMirror(tmp, U);
    assert.equal(summary.users, 2);
    assert.equal(summary.projects, 2);
    assert.equal(summary.specs, 2, '仅统计用户级 spec；全局 spec 单列标题');
    assert.deepEqual(summary.globalSpecTitles, ['Global Title']);
    assert.equal(summary.sameNameUserPresent, true);

    const peek = await peekDomain(remote.barePath, 'main', U);
    assert.equal(peek.domainHash, computeDomainHash(remote.barePath, 'main'));
    assert.equal(peek.mirrorDir, '');
    assert.equal(peek.summary?.users, 2);
    const sameNameWarning = peek.warnings.some((w) => w.includes('同名的用户'));
    const globalWarning = peek.warnings.some((w) => w.includes('全局 spec'));
    assert.equal(sameNameWarning, true, JSON.stringify(peek.warnings));
    assert.equal(globalWarning, true, JSON.stringify(peek.warnings));

    const empty = await summarizeMirror(join(env.tmpRoot, 'empty'), U);
    assert.deepEqual(empty, {
      users: 0,
      projects: 0,
      specs: 0,
      globalSpecTitles: [],
      sameNameUserPresent: false,
    });
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(remote.tmpRoot, { recursive: true, force: true });
  }
});

test('join/list/update/sync/unlink：本地 bare 远端全链路', async () => {
  const remote = await makeRemote('domain-one');
  const remote2 = await makeRemote('domain-two');
  try {
    const joined = await joinDomain({ remote: remote.barePath, label: 'One', use: 'reference' }, U);
    assert.equal(joined.domainHash, computeDomainHash(remote.barePath, 'main'));
    assert.equal(joined.summary?.users, 1);
    assert.ok(joined.warnings.some((w) => w.includes('全局 spec')));

    const domains = await readSyncDomains();
    assert.equal(domains.length, 1);
    assert.equal(domains[0].use, 'reference');

    const list = await listDomains();
    assert.equal(list.length, 1);
    assert.equal(list[0].mirrorExists, true);
    assert.equal(list[0].priority, 1);
    assert.equal(list[0].lastPushAt, null);
    assert.ok(list[0].stats && list[0].stats.users === 1);
    assert.equal(list[0].lastSync, null);
    assert.equal(list[0].pushState, '只读消费');

    // 同步：无 routes/基线 → 只拉取
    const sync = await syncDomains(U);
    assert.equal(sync.length, 1);
    assert.equal(sync[0].pulled, true);
    assert.equal(sync[0].push, undefined);
    const afterSync = await listDomains();
    assert.equal(afterSync[0].lastSync?.status, 'ok');

    // 身份不变：就地更新
    const same = await updateDomain(joined.domainHash, { label: 'Renamed', use: 'trusted' });
    assert.equal(same.migrated, false);
    assert.equal(same.domain.label, 'Renamed');
    assert.equal((await readSyncDomains())[0].use, 'trusted');

    // 身份迁移：换 remote
    const migrated = await updateDomain(same.hash, { remote: remote2.barePath });
    assert.equal(migrated.migrated, true);
    assert.notEqual(migrated.hash, same.hash);
    assert.equal(migrated.pullWarning, undefined);
    assert.equal((await listDomains())[0].hash, migrated.hash);

    const removed = await unlinkDomain(migrated.hash);
    assert.equal(removed.remote, remote2.barePath);
    assert.deepEqual(await readSyncDomains(), []);
    await assert.rejects(() => unlinkDomain(migrated.hash), /未找到域/);
    await assert.rejects(() => updateDomain('deadbeefdeadbeef', {}), /未找到域/);
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(remote.tmpRoot, { recursive: true, force: true });
    await rm(remote2.tmpRoot, { recursive: true, force: true });
  }
});
