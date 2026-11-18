import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const version = '0.4.8';
const openVsxToken = 'test-open-vsx-value';
const marketplaceToken = 'test-marketplace-value';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'lattice-vsix-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const extension = join(root, 'packages/vscode');
  const runner = join(extension, 'scripts/release-vsix.mjs');
  const pnpm = join(root, 'pnpm.mjs');
  const calls = join(root, 'calls.jsonl');
  mkdirSync(join(extension, 'dist-vsix'), { recursive: true });
  mkdirSync(join(extension, 'scripts'), { recursive: true });
  copyFileSync(new URL('../../packages/vscode/scripts/release-vsix.mjs', import.meta.url), runner);
  writeFileSync(
    join(extension, 'package.json'),
    JSON.stringify({ name: 'lattice-context', version }),
  );
  writeFileSync(join(extension, 'CHANGELOG.md'), `## [${version}]\n`);
  writeFileSync(join(extension, 'dist-vsix', 'lattice-context-9.9.9.vsix'), 'different version');
  writeFileSync(calls, '');
  writeFileSync(
    pnpm,
    `import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'run') {
  writeFileSync('dist-vsix/lattice-context-${version}.vsix', 'expected artifact');
} else if (args[0] === 'dlx') {
  if (process.env.OVSX_PAT !== ${JSON.stringify(openVsxToken)}) throw new Error('wrong OVSX_PAT');
  console.error('Open VSX failure for token ' + process.env.OVSX_PAT);
  process.exitCode = 1;
} else if (process.env.VSCE_PAT !== ${JSON.stringify(marketplaceToken)}) {
  throw new Error('wrong VSCE_PAT');
}
`,
  );
  return {
    run: (override = {}) =>
      spawnSync(process.execPath, [runner, '--publish'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          npm_execpath: pnpm,
          OVSX_PAT: openVsxToken,
          VSCE_PAT: marketplaceToken,
          TEST_CALLS: calls,
          ...override,
        },
        timeout: 10_000,
      }),
    calls: () => readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
  };
}

test('a failed marketplace attempt still tries the other market with the exact manifest VSIX', (t) => {
  const mock = fixture(t);
  const result = mock.run();
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(mock.calls(), [
    ['run', 'package'],
    ['dlx', 'ovsx@0.10.9', 'publish', join('dist-vsix', `lattice-context-${version}.vsix`)],
    [
      'exec',
      'vsce',
      'publish',
      '--packagePath',
      join('dist-vsix', `lattice-context-${version}.vsix`),
    ],
  ]);
  assert.match(result.stderr, /Open VSX failure for token \*\*\*\*/);
  assert.match(result.stdout, /VS Marketplace 已发布/);
  assert.ok(![result.stdout, result.stderr].some((out) => out.includes(marketplaceToken)));
});

test('dual-channel publication needs both credentials before packaging or network commands', (t) => {
  const mock = fixture(t);
  const result = mock.run({ VSCE_PAT: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少发布凭据 VSCE_PAT/);
  assert.deepEqual(mock.calls(), []);
});
