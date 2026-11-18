import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const version = '1.29.1';
const skip = process.platform === 'win32';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-release-flow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repository');
  const remote = path.join(root, 'remote.git');
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'commands');
  for (const directory of [
    repo,
    bin,
    path.join(repo, 'scripts/__tests__'),
    path.join(repo, 'packages/core'),
    path.join(repo, 'packages/cli'),
  ])
    fs.mkdirSync(directory, { recursive: true });
  for (const file of ['release.mjs', 'changelog.mjs'])
    fs.copyFileSync(new URL('../' + file, import.meta.url), path.join(repo, 'scripts', file));
  fs.writeFileSync(path.join(repo, 'scripts/__tests__/noop.test.mjs'), '');
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '## [Unreleased]\n\n- fixture\n');
  for (const name of ['core', 'cli'])
    fs.writeFileSync(
      path.join(repo, 'packages', name, 'package.json'),
      JSON.stringify({ name: '@qcqx/lattice-' + name, version }),
    );
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'master');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Release fixture');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '-m', 'chore: initialize release fixture');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  fs.writeFileSync(calls, '');
  function stub(command, body) {
    fs.writeFileSync(
      path.join(bin, command),
      '#!/bin/sh\nprintf "%s %s\\n" "' + command + '" "$*" >> "$RELEASE_TEST_CALLS"\n' + body,
      { mode: 0o700 },
    );
  }
  stub('pnpm', 'case "$*" in *publish*) exit "${RELEASE_TEST_PUBLISH_STATUS:-0}";; esac\n');
  stub(
    'npm',
    'echo "${RELEASE_TEST_REGISTRY_RESULT:-null}"\nexit "${RELEASE_TEST_REGISTRY_STATUS:-0}"\n',
  );
  stub('gh', 'echo ok\nexit "${RELEASE_TEST_CI_STATUS:-0}"\n');
  return {
    git,
    remoteRefs: () => git('--git-dir=' + remote, 'for-each-ref', '--format=%(refname)'),
    calls: () => fs.readFileSync(calls, 'utf8'),
    run: (args, extra) =>
      spawnSync(process.execPath, ['scripts/release.mjs', ...args], {
        cwd: repo,
        env: {
          ...process.env,
          PATH: bin + path.delimiter + process.env.PATH,
          RELEASE_TEST_CALLS: calls,
          ...extra,
        },
        encoding: 'utf8',
        timeout: 20000,
      }),
  };
}

test(
  'release --no-push prepares a local commit and tag without calling gh, npm or git push',
  { skip },
  (t) => {
    const f = fixture(t);
    const result = f.run(['patch', '--no-push']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(f.calls(), /pnpm run build:cli/);
    assert.doesNotMatch(f.calls(), /publish|npm view|gh run/);
    assert.equal(f.git('tag', '-l'), 'v1.29.2');
    assert.equal(f.remoteRefs(), '');
    assert.match(result.stdout, /pnpm release continue/);
  },
);

test(
  'release continue resumes a locally prepared tag and checks its source commit',
  { skip },
  (t) => {
    const f = fixture(t);
    const source = f.git('rev-parse', 'HEAD');
    const local = f.run(['patch', '--core', '--no-push']);
    assert.equal(local.status, 0, local.stderr);
    const result = f.run(['continue', '--core']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(f.calls(), new RegExp('gh run list --workflow=ci.yml --commit ' + source));
    assert.match(f.calls(), /lattice-core publish/);
    assert.match(f.remoteRefs(), /refs\/tags\/v1\.29\.2/);
  },
);

test(
  'release continue stops before tagging or pushing when the exact artifact is unconfirmed',
  { skip },
  (t) => {
    const f = fixture(t);
    for (const registry of [
      { RELEASE_TEST_REGISTRY_STATUS: '1' },
      { RELEASE_TEST_REGISTRY_RESULT: '"1.29.0"' },
    ]) {
      const result = f.run(['continue', '--core'], {
        RELEASE_TEST_PUBLISH_STATUS: '1',
        ...registry,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /发布 @qcqx\/lattice-core 失败/);
      assert.equal(f.git('tag', '-l'), '');
      assert.equal(f.remoteRefs(), '');
    }
    assert.match(f.calls(), /npm view @qcqx\/lattice-core@1\.29\.1 version --json --prefer-online/);
  },
);

test(
  'release continue proceeds when the registry confirms the exact published version',
  { skip },
  (t) => {
    const f = fixture(t);
    const result = f.run(['continue', '--core'], {
      RELEASE_TEST_PUBLISH_STATUS: '1',
      RELEASE_TEST_REGISTRY_RESULT: JSON.stringify(version),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /npm 已有 @qcqx\/lattice-core@1\.29\.1/);
    assert.match(f.remoteRefs(), /refs\/tags\/v1\.29\.1/);
  },
);

test('an unavailable CI status stops release before the npm or git writes', { skip }, (t) => {
  const f = fixture(t);
  const result = f.run(['continue', '--core'], { RELEASE_TEST_CI_STATUS: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /查不到 CI 状态/);
  assert.doesNotMatch(f.calls(), /publish/);
  assert.equal(f.git('tag', '-l'), '');
  assert.equal(f.remoteRefs(), '');
});

test('release blocks uncommitted source before preparing a tag', { skip }, (t) => {
  const f = fixture(t);
  const repo = f.git('rev-parse', '--show-toplevel');
  fs.writeFileSync(path.join(repo, 'uncommitted.txt'), 'source not in HEAD');
  const result = f.run(['patch', '--no-push']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /工作区有未提交的变更/);
  assert.equal(f.git('tag', '-l'), '');
  assert.equal(f.calls(), '');
});

test('release continue rejects a tag that points to an older commit', { skip }, (t) => {
  const f = fixture(t);
  f.git('tag', `v${version}`);
  f.git('commit', '--allow-empty', '-m', 'fix: change release source');
  const result = f.run(['continue', '--core']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tag v1\.29\.1 已存在/);
  assert.equal(f.calls(), '');
  assert.equal(f.remoteRefs(), '');
});
