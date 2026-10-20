import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addRemote,
  commitAll,
  getGitStatus,
  initLatticeGit,
  isGitInitialized,
  listRemotes,
  pullRebase,
  push,
  removeRemote,
  setRemoteUrl,
  syncAll,
} from '../src/maintenance/git-ops';
import { createBareRemote, createTempLatticeHome } from './helpers';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
});

afterEach(async () => {
  await env.cleanup();
});

const gitEnv = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

test('git-ops：未初始化时全部安全降级', async () => {
  assert.equal(await isGitInitialized(), false);
  assert.deepEqual(await getGitStatus(), {
    initialized: false,
    remote: null,
    hasChanges: false,
    changedFiles: [],
    branch: null,
    aheadCount: 0,
    behindCount: 0,
  });
  assert.equal((await commitAll()).success, false);
  assert.equal((await pullRebase()).success, false);
  assert.equal((await push()).success, false);
  const sync = await syncAll();
  assert.equal(sync.commit.success, false);
  assert.equal(sync.pull.success, false);
  assert.equal(sync.push.success, false);
  assert.deepEqual(await listRemotes(), []);
  assert.equal((await addRemote('origin', 'x')).success, false);
  assert.equal((await setRemoteUrl('origin', 'x')).success, false);
  assert.equal((await removeRemote('origin')).success, false);
});

test('initLatticeGit / status / commitAll：初始化、变更与空提交', async () => {
  const prev = { ...process.env };
  Object.assign(process.env, gitEnv);
  try {
    assert.equal((await initLatticeGit(env.latticeHome)).success, true);
    assert.equal(await isGitInitialized(), true);

    const status = await getGitStatus();
    assert.equal(status.initialized, true);
    assert.equal(status.branch, 'main');
    assert.equal(status.hasChanges, false);
    assert.equal(status.remote, null);

    const clean = await commitAll();
    assert.equal(clean.success, true);
    assert.match(clean.message, /无变更/);

    await writeFile(join(env.latticeHome, 'note.md'), 'hello', 'utf-8');
    const changed = await getGitStatus();
    assert.equal(changed.hasChanges, true);
    assert.ok(changed.changedFiles.includes('note.md'));

    const committed = await commitAll('chore: test');
    assert.equal(committed.success, true);
    assert.match(committed.message, /已提交: chore: test/);
    assert.equal((await getGitStatus()).hasChanges, false);
  } finally {
    process.env = prev;
  }
});

test('remote 管理：添加/重复/空值/切换/删除', async () => {
  const prev = { ...process.env };
  Object.assign(process.env, gitEnv);
  try {
    await initLatticeGit(env.latticeHome);
    const remote = await createBareRemote('gitops-remote');
    try {
      assert.equal((await addRemote('', remote.barePath)).success, false);
      assert.equal((await addRemote('origin', '')).success, false);

      const added = await addRemote('origin', remote.barePath);
      assert.equal(added.success, true);
      assert.equal((await addRemote('origin', remote.barePath)).success, false, '重复拒绝');

      const remotes = await listRemotes();
      assert.equal(remotes.length, 1);
      assert.equal(remotes[0].name, 'origin');
      assert.equal(remotes[0].url, remote.barePath);

      const switched = await setRemoteUrl('origin', remote.barePath + '-2');
      assert.equal(switched.success, true);
      assert.equal((await listRemotes())[0].url, remote.barePath + '-2');

      assert.equal((await setRemoteUrl('missing', remote.barePath)).success, false);
      assert.equal((await removeRemote('missing')).success, false);
      assert.equal((await removeRemote('')).success, false);
      assert.equal((await removeRemote('origin')).success, true);
      assert.deepEqual(await listRemotes(), []);
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(remote.tmpRoot, { recursive: true, force: true });
    }
  } finally {
    process.env = prev;
  }
});

test('pull/push/syncAll：本地 bare 远端全链路', async () => {
  const prev = { ...process.env };
  Object.assign(process.env, gitEnv);
  try {
    const remote = await createBareRemote('gitops-sync');
    try {
      await initLatticeGit(env.latticeHome, remote.barePath);
      // 首次推送建立 upstream（product 的 sync 默认先 pull，空远端首次 pull 必然失败）
      const { execFileSync } = await import('node:child_process');
      execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], {
        cwd: env.latticeHome,
        env: { ...process.env },
      });

      const noChangeSync = await syncAll();
      assert.equal(noChangeSync.commit.success, true);
      assert.equal(noChangeSync.pull.success, true);
      assert.equal(noChangeSync.push.success, true);

      await writeFile(join(env.latticeHome, 'sync.md'), 'sync', 'utf-8');
      const pushed = await push();
      assert.equal(pushed.success, true);
      assert.match(pushed.message, /推送完成/);

      const pulled = await pullRebase();
      assert.equal(pulled.success, true);
      assert.match(pulled.message, /拉取完成/);

      const status = await getGitStatus();
      assert.equal(status.initialized, true);
      assert.equal(status.remote, remote.barePath);

      const full = await syncAll();
      assert.equal(full.commit.success, true);
      assert.equal(full.pull.success, true);
      assert.equal(full.push.success, true);
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(remote.tmpRoot, { recursive: true, force: true });
    }
  } finally {
    process.env = prev;
  }
});

test('pull/push/syncAll：无 remote 时给出明确错误', async () => {
  const prev = { ...process.env };
  Object.assign(process.env, gitEnv);
  try {
    await initLatticeGit(env.latticeHome);
    assert.match((await pullRebase()).message, /未关联远程仓库/);
    assert.match((await push()).message, /未关联远程仓库/);
    const sync = await syncAll();
    assert.match(sync.pull.message, /已跳过拉取/);
    assert.match(sync.push.message, /已跳过推送/);
  } finally {
    process.env = prev;
  }
});
