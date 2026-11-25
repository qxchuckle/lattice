import test from 'node:test';
import assert from 'node:assert/strict';
import { platformScope } from '../ci-cli-scope.mjs';

test('site-only changes skip CLI platforms and application changes run the representative platform', () => {
  assert.equal(
    platformScope(['README.zh-CN.md', 'docs/quick-start.md', 'apps/site/src/Hero.astro']),
    'none',
  );
  assert.equal(
    platformScope(['packages/cli/src/commands/search.ts', 'docs/quick-start.md']),
    'linux-x64',
  );
});

test('release and native packaging inputs keep the complete platform matrix', () => {
  for (const paths of [
    [],
    ['packages/cli/package.json', 'CHANGELOG.md'],
    ['pnpm-lock.yaml'],
    ['scripts/cli-distribution/dependencies.cjs'],
    ['.github/workflows/cli-platform.yml'],
    ['packages/core/src/addon.node'],
    ['packages/core/tsup.config.ts'],
  ]) {
    assert.equal(platformScope(paths), 'full', paths.join(', '));
  }
});
