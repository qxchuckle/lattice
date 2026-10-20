import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { domainHashOf, initLatticeGit, readSyncDomains } from '@qcqx/lattice-core';
import { registerSyncCommand } from '../../src/commands/sync';
import { createCliEnv, runCli, putFile, U, type CliEnv, type CliRunResult } from './helpers';

let env: CliEnv;

beforeEach(async () => {
  env = await createCliEnv();
});

afterEach(async () => {
  await env.cleanup();
});

const run = (args: string[]): Promise<CliRunResult> => runCli(registerSyncCommand, args);

async function makeRemote(name: string): Promise<{ barePath: string; work: string }> {
  const barePath = join(env.tmpRoot, `${name}.git`);
  execFileSync('git', ['init', '--bare', '-q', barePath]);
  const work = join(env.tmpRoot, `${name}-work`);
  await mkdir(work, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
  await putFile(
    join(work, 'users', 'alice', 'spec', 'guide.md'),
    '---\nid: spec-alice01\ntitle: Alice Guide\n---\n\nbody',
  );
  await putFile(
    join(work, 'users', 'alice', 'projects', 'p1', 'project.json'),
    JSON.stringify({ id: 'legacy:alice0001', name: 'p1' }),
  );
  await putFile(
    join(work, 'spec', 'global.md'),
    '---\nid: spec-global01\ntitle: Global Title\n---\n\nbody',
  );
  execFileSync('git', ['add', '-A'], { cwd: work });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], {
    cwd: work,
  });
  execFileSync('git', ['push', '-q', barePath, 'main'], { cwd: work });
  return { barePath, work };
}

async function writeConfig(extra: Record<string, unknown> = {}) {
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, version: 1, ...extra }),
  );
}

test('sync domain：list 空态/join/重复/peek/list 人类/route 增删/错误/unlink', async () => {
  const emptyHuman = await run(['sync', 'domain', 'list']);
  assert.match(emptyHuman.stdout, /尚未关联任何域/);
  const emptyJson = await run(['sync', 'domain', 'list', '--json']);
  assert.equal(emptyJson.exitCode, 0);
  assert.deepEqual(JSON.parse(emptyJson.stdout), []);

  const remote = await makeRemote('domain-a');
  const peek = await run(['sync', 'domain', 'join', remote.barePath, '--peek', '--label', '预览']);
  assert.equal(peek.exitCode, 0, `${peek.stdout}\n${peek.stderr}`);
  assert.match(peek.stdout, /预览/);
  assert.match(peek.stdout, /内容：2 用户|内容：1 用户/);
  assert.match(peek.stdout, /全局 spec/);
  assert.match(peek.stdout, /该域含|同名的用户/);
  assert.match(peek.stdout, /--peek 仅预览/);
  assert.deepEqual(await readSyncDomains(), []);

  const joined = await run([
    'sync',
    'domain',
    'join',
    remote.barePath,
    '--label',
    'One',
    '--use',
    'reference',
    '--route',
    'project:*',
  ]);
  assert.equal(joined.exitCode, 0, `${joined.stdout}\n${joined.stderr}`);
  assert.match(joined.stdout, /已关联域/);
  assert.match(joined.stdout, /镜像：/);
  assert.match(joined.stdout, /内容：/);
  const domains = await readSyncDomains();
  assert.equal(domains.length, 1);
  assert.deepEqual(domains[0].routes, ['project:*']);
  const hash = domainHashOf(domains[0]);

  const duplicate = await run(['sync', 'domain', 'join', remote.barePath]);
  assert.equal(duplicate.exitCode, 1);
  assert.match(duplicate.stderr, /域已存在/);
  assert.match(duplicate.stderr, /已关联过该域/);
  const badUse = await run(['sync', 'domain', 'join', remote.barePath, '--use', 'wat']);
  assert.equal(badUse.exitCode, 1);

  const humanList = await run(['sync', 'domain', 'list']);
  assert.equal(humanList.exitCode, 0, humanList.stderr);
  assert.match(humanList.stdout, new RegExp(hash));
  assert.match(humanList.stdout, /One/);
  assert.match(humanList.stdout, /reference/);
  assert.match(humanList.stdout, /镜像就绪/);
  const jsonList = await run(['sync', 'domain', 'list', '--json']);
  assert.equal(JSON.parse(jsonList.stdout).length, 1);

  const invalidRoute = await run(['sync', 'domain', 'route', 'add', hash, 'bad-route']);
  assert.equal(invalidRoute.exitCode, 1);
  assert.match(invalidRoute.stderr, /非法 route/);
  const unknownHash = await run(['sync', 'domain', 'route', 'add', 'ffff', '*']);
  assert.equal(unknownHash.exitCode, 1);
  const routeAdd = await run([
    'sync',
    'domain',
    'route',
    'add',
    hash.slice(0, 6),
    'user-spec:*.md',
  ]);
  assert.equal(routeAdd.exitCode, 0, routeAdd.stderr);
  assert.match(routeAdd.stdout, /已添加规则/);
  assert.deepEqual((await readSyncDomains())[0].routes, ['project:*', 'user-spec:*.md']);
  const routeRemove = await run(['sync', 'domain', 'route', 'remove', hash, 'project:*']);
  assert.equal(routeRemove.exitCode, 0, routeRemove.stderr);
  assert.match(routeRemove.stdout, /已移除规则/);
  assert.deepEqual((await readSyncDomains())[0].routes, ['user-spec:*.md']);

  const unlinkMissing = await run(['sync', 'domain', 'unlink', 'ffff']);
  assert.equal(unlinkMissing.exitCode, 1);
  const unlinked = await run(['sync', 'domain', 'unlink', hash.slice(0, 8)]);
  assert.equal(unlinked.exitCode, 0, unlinked.stderr);
  assert.match(unlinked.stdout, /已解除域/);
  assert.deepEqual(await readSyncDomains(), []);
});

test('sync 全轨：--only 校验/未配 git/未关联域/域同步/--pull/--push', async () => {
  const invalidOnly = await run(['sync', '--only', 'wat']);
  assert.equal(invalidOnly.exitCode, 1);
  assert.match(invalidOnly.stdout, /--only 须为 origin 或 domains/);

  const noGit = await run(['sync']);
  assert.equal(noGit.exitCode, 0, noGit.stderr);
  assert.match(noGit.stdout, /origin 单仓未启用/);
  assert.match(noGit.stdout, /未关联域，跳过域同步/);

  const onlyOrigin = await run(['sync', '--only', 'origin']);
  assert.equal(onlyOrigin.exitCode, 0, onlyOrigin.stderr);
  assert.equal(onlyOrigin.stdout.includes('origin 单仓未启用'), false);

  const onlyDomainsNone = await run(['sync', '--only', 'domains']);
  assert.equal(onlyDomainsNone.exitCode, 0);

  const pulled = await run(['sync', '--pull']);
  assert.equal(pulled.exitCode, 0, pulled.stderr);
  assert.match(pulled.stdout, /正在拉取远程变更/);
  const pushed = await run(['sync', '--push']);
  assert.equal(pushed.exitCode, 0, pushed.stderr);
  assert.match(pushed.stdout, /正在推送本地变更/);

  const remote = await makeRemote('domain-b');
  const joined = await run(['sync', 'domain', 'join', remote.barePath, '--route', '*']);
  assert.equal(joined.exitCode, 0, joined.stderr);
  const domainSync = await run(['sync', '--only', 'domains']);
  assert.equal(domainSync.exitCode, 0, `${domainSync.stdout}\n${domainSync.stderr}`);
  assert.match(domainSync.stdout, /正在同步 1 个域/);
  assert.match(domainSync.stdout, /域同步完成|域同步部分失败/);
  assert.match(domainSync.stdout, /✓ 拉取|⚠ 拉取/);

  // origin 成功路径：本地 bare remote + initLatticeGit
  const origin = join(env.tmpRoot, 'origin.git');
  execFileSync('git', ['init', '--bare', '-q', origin]);
  await writeConfig({ gitEnabled: true, gitRemote: origin });
  await initLatticeGit(env.latticeHome, origin);
  await putFile(join(env.latticeHome, 'spec', 'origin-change.md'), '# change\n');
  const originPush = await run(['sync', '--push']);
  assert.equal(originPush.exitCode, 0, originPush.stderr);
  assert.match(originPush.stdout, /✓|git|推送|无变更/i);
  const originPull = await run(['sync', '--pull']);
  assert.equal(originPull.exitCode, 0, originPull.stderr);
  const full = await run(['sync']);
  assert.equal(full.exitCode, 0, `${full.stdout}\n${full.stderr}`);
  assert.match(full.stdout, /正在同步 origin 单仓/);
  assert.match(full.stdout, /域同步完成|域同步部分失败|未关联域/);
});
