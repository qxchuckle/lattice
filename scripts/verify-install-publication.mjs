import { pathToFileURL } from 'node:url';
import distribution from './cli-distribution/config.cjs';
import { installation, validateChannels } from './install-content.mjs';

const github = 'https://api.github.com/repos/';
const repo = 'qxchuckle/lattice';
const registry = 'https://registry.npmjs.org/';
const cli = '@qcqx/lattice-cli';
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const archiveNames = (version) =>
  distribution.PLATFORMS.filter(({ os }) => os !== 'win32').map(
    ({ id }) => `lattice-${version}-${id}.tar.gz`,
  );

function verifyReleaseAssets(release, tag, requiredAssets) {
  const assets = new Set(
    release.assets
      ?.filter(({ state, size }) => state === 'uploaded' && size > 0)
      .map(({ name }) => name),
  );
  if (release.draft || release.tag_name !== tag || requiredAssets.some((name) => !assets.has(name)))
    throw new Error('GitHub Release is missing standalone installation assets: ' + tag);
}

export async function verifyInstallPublication(config = installation, request = fetch) {
  validateChannels(config);
  async function get(url, accept = 'application/json') {
    const response = await request(url, {
      headers: { accept },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Cannot verify ' + url + ': HTTP ' + response.status);
    return response;
  }

  const npm = await (await get(registry + encodeURIComponent(cli) + '/latest')).json();
  const npmVersion = npm.version;
  if (!versionPattern.test(npmVersion))
    throw new Error('npm latest has an invalid version: ' + npmVersion);
  await Promise.all(
    distribution.PLATFORMS.map(async ({ packageName }) => {
      if (npm.optionalDependencies?.[packageName] !== npmVersion)
        throw new Error('npm latest does not reference its platform package: ' + packageName);
      const platform = await (
        await get(registry + encodeURIComponent(packageName) + '/' + npmVersion)
      ).json();
      if (platform.version !== npmVersion || !platform.dist?.integrity)
        throw new Error('Published platform package is incomplete: ' + packageName);
    }),
  );

  const brew = config.channels.find(({ id }) => id === 'brew');
  const curl = config.channels.find(({ id }) => id === 'curl');
  const releases = github + repo + '/releases';
  const latest = curl.available ? await (await get(releases + '/latest')).json() : null;
  if (latest) {
    const tag = latest.tag_name;
    if (!tag?.startsWith('v') || !versionPattern.test(tag.slice(1)))
      throw new Error('GitHub latest has an invalid CLI tag: ' + tag);
    verifyReleaseAssets(latest, tag, [
      ...archiveNames(tag.slice(1)),
      'install.sh',
      'release-version.txt',
      'SHA256SUMS',
    ]);
  }

  if (brew.available) {
    const [owner, tap] = brew.tap.split('/');
    const formula = await (
      await get(
        github + owner + '/homebrew-' + tap + '/contents/Formula/lattice.rb',
        'application/vnd.github.raw+json',
      )
    ).text();
    const version = /^\s*version "([^"]+)"\s*$/m.exec(formula)?.[1];
    if (!versionPattern.test(version)) throw new Error('Homebrew tap formula has no valid version');
    const tag = 'v' + version;
    const archives = archiveNames(version);
    if (
      !archives.every((name) =>
        formula.includes(`https://github.com/${repo}/releases/download/${tag}/${name}"`),
      )
    )
      throw new Error('Homebrew tap formula does not point to the published archives: ' + tag);
    if (latest?.tag_name !== tag) {
      const release = await (await get(releases + '/tags/' + tag)).json();
      verifyReleaseAssets(release, tag, archives);
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await verifyInstallPublication();
    console.log('Verified public installation channels');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
