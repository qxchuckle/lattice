import { pathToFileURL } from 'node:url';
import distribution from './cli-distribution/config.cjs';
import { installation, validateChannels } from './install-content.mjs';

const github = 'https://api.github.com/repos/';
const repo = 'qxchuckle/lattice';
const registry = 'https://registry.npmjs.org/';
const cli = '@qcqx/lattice-cli';

export async function verifyInstallPublication(config = installation, request = fetch) {
  validateChannels(config);
  const version = config.publishedVersion;
  const tag = 'v' + version;

  async function get(url, accept = 'application/json') {
    const response = await request(url, {
      headers: { accept },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Cannot verify ' + url + ': HTTP ' + response.status);
    return response;
  }

  const npm = await (await get(registry + encodeURIComponent(cli) + '/latest')).json();
  if (npm.version !== version)
    throw new Error('Installation catalog version differs from npm latest: ' + npm.version);
  const bundled = distribution.PLATFORMS.every(
    ({ packageName }) => npm.optionalDependencies?.[packageName] === version,
  );
  if (bundled !== (config.npmRuntime === 'bundled'))
    throw new Error('Installation catalog runtime differs from the published npm package');
  if (bundled) {
    await Promise.all(
      distribution.PLATFORMS.map(async ({ packageName }) => {
        const platform = await (
          await get(registry + encodeURIComponent(packageName) + '/' + version)
        ).json();
        if (platform.version !== version || !platform.dist?.integrity)
          throw new Error('Published platform package is incomplete: ' + packageName);
      }),
    );
  }

  const brew = config.channels.find(({ id }) => id === 'brew');
  const curl = config.channels.find(({ id }) => id === 'curl');
  if (!brew.available && !curl.available) return;

  const release = await (await get(github + repo + '/releases/tags/' + tag)).json();
  const assets = new Set(
    release.assets
      ?.filter(({ state, size }) => state === 'uploaded' && size > 0)
      .map(({ name }) => name),
  );
  const requiredAssets = distribution.PLATFORMS.filter(({ os }) => os !== 'win32').map(
    ({ id }) => `lattice-${version}-${id}.tar.gz`,
  );
  if (curl.available) requiredAssets.push('install.sh', 'SHA256SUMS');
  if (release.draft || release.tag_name !== tag || requiredAssets.some((name) => !assets.has(name)))
    throw new Error('GitHub Release is missing standalone installation assets: ' + tag);

  if (brew.available) {
    const [owner, tap] = brew.tap.split('/');
    const formula = await (
      await get(
        github + owner + '/homebrew-' + tap + '/contents/Formula/lattice.rb',
        'application/vnd.github.raw+json',
      )
    ).text();
    if (
      !formula.includes('version "' + version + '"') ||
      !requiredAssets
        .filter((name) => name.endsWith('.tar.gz'))
        .every((name) =>
          formula.includes(`https://github.com/${repo}/releases/download/${tag}/${name}`),
        )
    )
      throw new Error('Homebrew tap formula does not point to the published archives: ' + tag);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await verifyInstallPublication();
    console.log('Installation catalog matches public release channels');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
