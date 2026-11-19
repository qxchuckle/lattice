import test from 'node:test';
import assert from 'node:assert/strict';
import { installation } from '../install-content.mjs';
import { verifyInstallPublication } from '../verify-install-publication.mjs';
import distribution from '../cli-distribution/config.cjs';

const npmVersion = '2.3.6';
const githubVersion = '2.3.5';
const brewVersion = '2.3.4';
const npmRegistry = 'https://registry.npmjs.org/';
const releaseApi = 'https://api.github.com/repos/qxchuckle/lattice/releases';
const releases = 'https://github.com/qxchuckle/lattice/releases';
const archives = (version) =>
  distribution.PLATFORMS.filter(({ os }) => os !== 'win32').map(
    ({ id }) => `lattice-${version}-${id}.tar.gz`,
  );
const npm = {
  version: npmVersion,
  optionalDependencies: Object.fromEntries(
    distribution.PLATFORMS.map(({ packageName }) => [packageName, npmVersion]),
  ),
};

function release(version, files, draft = false) {
  return Response.json({
    tag_name: 'v' + version,
    draft,
    assets: files.map((name) => ({ name, state: 'uploaded', size: 1 })),
  });
}

function request(failure = '') {
  return async (url) => {
    if (url === npmRegistry + encodeURIComponent('@qcqx/lattice-cli') + '/latest') {
      if (failure === 'npm-version') return Response.json({ ...npm, version: 'invalid' });
      if (failure === 'optional-dependencies') return Response.json({ version: npmVersion });
      return Response.json(npm);
    }
    if (url.startsWith(npmRegistry)) {
      assert.ok(
        distribution.PLATFORMS.some(
          ({ packageName }) =>
            url === npmRegistry + encodeURIComponent(packageName) + '/' + npmVersion,
        ),
        url,
      );
      if (failure === 'platform') return new Response(null, { status: 404 });
      return Response.json({ version: npmVersion, dist: { integrity: 'sha512-test' } });
    }
    if (url === releaseApi + '/latest') {
      const files = [...archives(githubVersion), 'release-version.txt', 'install.sh', 'SHA256SUMS'];
      return release(
        githubVersion,
        files.filter((name) => name !== failure),
        failure === 'draft',
      );
    }
    if (url === releaseApi + '/tags/v' + brewVersion) {
      return release(brewVersion, failure === 'brew-archive' ? [] : archives(brewVersion));
    }
    assert.equal(
      url,
      'https://api.github.com/repos/qxchuckle/homebrew-lattice/contents/Formula/lattice.rb',
    );
    return new Response(
      [
        `  version "${brewVersion}"`,
        ...archives(brewVersion).map(
          (archive) =>
            `      url "${releases}/download/v${brewVersion}/${archive}", using: :nounzip`,
        ),
      ]
        .slice(0, failure === 'formula' ? 1 : undefined)
        .join('\n'),
    );
  };
}

test('publication gate accepts independently published channel versions', async () => {
  await verifyInstallPublication(installation, request());
});

test('publication gate rejects missing npm packages and standalone assets', async () => {
  for (const [failure, error] of [
    ['npm-version', /npm latest has an invalid version/],
    ['optional-dependencies', /npm latest does not reference its platform package/],
    ['platform', /HTTP 404/],
    ['install.sh', /missing standalone.*v2\.3\.5/],
    ['release-version.txt', /missing standalone.*v2\.3\.5/],
    ['draft', /missing standalone.*v2\.3\.5/],
    ['formula', /tap formula does not point to the published archives/],
    ['brew-archive', /missing standalone.*v2\.3\.4/],
  ]) {
    await assert.rejects(verifyInstallPublication(installation, request(failure)), error);
  }
});
