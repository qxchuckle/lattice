import test from 'node:test';
import assert from 'node:assert/strict';
import { installation } from '../install-content.mjs';
import { verifyInstallPublication } from '../verify-install-publication.mjs';
import distribution from '../cli-distribution/config.cjs';

test('publication gate accepts the current host package and rejects version/runtime drift', async () => {
  const config = structuredClone(installation);
  config.channels = config.channels.map((channel) => ({
    ...channel,
    available: channel.id === 'npm',
  }));
  config.npmRuntime = 'host';
  const request = (metadata) => async () => Response.json(metadata);
  await verifyInstallPublication(config, request({ version: config.publishedVersion }));
  await assert.rejects(
    verifyInstallPublication(config, request({ version: '0.0.0' })),
    /npm latest/,
  );
  const bundled = { ...config, npmRuntime: 'bundled' };
  await assert.rejects(
    verifyInstallPublication(bundled, request({ version: config.publishedVersion })),
    /runtime differs/,
  );
});

test('publication gate checks all platform packages, standalone assets and the current tap formula', async () => {
  const config = structuredClone(installation);
  config.npmRuntime = 'bundled';
  config.channels.find(({ id }) => id === 'curl').available = true;
  Object.assign(
    config.channels.find(({ id }) => id === 'brew'),
    { available: true, tap: 'qxchuckle/tap' },
  );
  const version = config.publishedVersion;
  const tag = 'v' + version;
  const archives = distribution.PLATFORMS.filter(({ os }) => os !== 'win32').map(
    ({ id }) => `lattice-${version}-${id}.tar.gz`,
  );
  const npm = {
    version,
    optionalDependencies: Object.fromEntries(
      distribution.PLATFORMS.map(({ packageName }) => [packageName, version]),
    ),
  };
  function request(missing = '') {
    return async (url) => {
      if (url.endsWith('/latest')) return Response.json(npm);
      if (url.startsWith('https://registry.npmjs.org/')) {
        if (missing === 'platform') return new Response(null, { status: 404 });
        return Response.json({ version, dist: { integrity: 'sha512-test' } });
      }
      if (url.includes('/releases/tags/')) {
        const files = [
          ...archives,
          'SHA256SUMS',
          ...(missing === 'installer' ? [] : ['install.sh']),
        ];
        return Response.json({
          tag_name: tag,
          draft: missing === 'draft',
          assets: files.map((name) => ({ name, state: 'uploaded', size: 1 })),
        });
      }
      assert.match(url, /qxchuckle\/homebrew-tap\/contents\/Formula\/lattice\.rb$/);
      return new Response(
        missing === 'formula'
          ? 'version "0.0.0"'
          : [
              'version "' + version + '"',
              ...archives.map(
                (archive) =>
                  `https://github.com/qxchuckle/lattice/releases/download/${tag}/${archive}`,
              ),
            ].join('\n'),
      );
    };
  }
  await assert.rejects(verifyInstallPublication(config, request('platform')), /HTTP 404/);
  await assert.rejects(
    verifyInstallPublication(config, request('installer')),
    /missing standalone/,
  );
  await assert.rejects(verifyInstallPublication(config, request('draft')), /missing standalone/);
  await assert.rejects(verifyInstallPublication(config, request('formula')), /tap formula/);
  await verifyInstallPublication(config, request());
});
