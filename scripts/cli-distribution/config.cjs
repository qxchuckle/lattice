// One catalog drives build targets, npm platform packages, release verification and CI matrices.
const NODE_VERSION = '24.22.3';
const PLATFORMS = [
  { id: 'darwin-arm64', os: 'darwin', arch: 'arm64', runner: 'macos-15' },
  { id: 'darwin-x64', os: 'darwin', arch: 'x64', runner: 'macos-15-intel' },
  { id: 'linux-arm64', os: 'linux', arch: 'arm64', libc: 'glibc', runner: 'ubuntu-24.04-arm' },
  { id: 'linux-x64', os: 'linux', arch: 'x64', libc: 'glibc', runner: 'ubuntu-24.04' },
  { id: 'win32-x64', os: 'win32', arch: 'x64', runner: 'windows-2022' },
].map((target) => ({ ...target, packageName: '@qcqx/lattice-cli-' + target.id }));

function hostTarget() {
  const target = PLATFORMS.find((p) => p.os === process.platform && p.arch === process.arch);
  if (!target)
    throw new Error(
      'No supported CLI distribution target for ' + process.platform + '-' + process.arch,
    );
  if (target.libc && !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error(
      'This CLI distribution requires glibc; musl is not supported by the complete native dependency set',
    );
  }
  return target;
}

module.exports = { NODE_VERSION, PLATFORMS, hostTarget };
