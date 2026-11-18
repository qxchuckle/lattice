const fs = require('fs');
const path = require('path');
const { setTimeout: delay } = require('node:timers/promises');
const { NODE_VERSION, PLATFORMS } = require('./config.cjs');
const { read, write, sha, bootstrap, run } = require('./build.cjs');

function formula(records, version) {
  const stanza = (r) =>
    `      url "https://github.com/qxchuckle/lattice/releases/download/v${version}/${r.archive}", using: :nounzip\n      sha256 "${r.archiveSha256}"`;
  const platform = (os) =>
    `  on_${os === 'darwin' ? 'macos' : 'linux'} do\n    on_arm do\n${stanza(records.find((r) => r.id === os + '-arm64'))}\n    end\n    on_intel do\n${stanza(records.find((r) => r.id === os + '-x64'))}\n    end\n  end`;
  return `# Generated for the Lattice-owned tap.
require "tmpdir"

class Lattice < Formula
  desc "Local-first engineering memory and workflow"
  homepage "https://lattice.qcqx.cn"
  version "${version}"
  license "MIT"
${platform('darwin')}
${platform('linux')}

  def install
    libexec.install Dir["*.tar.gz"].fetch(0) => "payload.tar.gz"
    bin.write_exec_script libexec/"payload/bin/ltc", libexec/"payload/bin/lattice"
  end

  # Homebrew fixes Mach-O linkage before post_install. Keep native files inside
  # the archive until that step has finished so their checksums stay intact.
  def post_install
    archive = libexec/"payload.tar.gz"
    destination = libexec/"payload"
    if destination.directory?
      verify_payload(destination)
    else
      Dir.mktmpdir(".lattice-payload-", libexec.to_s) do |stage|
        system "tar", "-xzf", archive, "-C", stage
        payload = Pathname(stage)/"payload"
        verify_payload(payload)
        payload.rename(destination)
      end
    end
    archive.unlink if archive.file?
  end

  def verify_payload(payload)
    with_env(NODE_OPTIONS: nil, NODE_PATH: nil) do
      system payload/"runtime/node", payload/"scripts/payload.cjs", version.to_s
    end
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/ltc --version").strip
    assert_match "--no-open", shell_output("#{bin}/ltc web --help")
    verify_payload(libexec/"payload")
  end
end
`;
}
function assemble(output, options = {}) {
  output = path.resolve(output);
  const records = [];
  for (const target of PLATFORMS) {
    const file = path.join(output, target.id + '.json');
    if (!fs.existsSync(file)) {
      if (options.allowPartial) continue;
      throw new Error('Missing release target ' + target.id);
    }
    const r = read(file);
    if (
      r.id !== target.id ||
      r.packageName !== target.packageName ||
      r.os !== target.os ||
      r.arch !== target.arch ||
      r.libc !== target.libc
    )
      throw new Error('Invalid platform catalog ' + target.id);
    if ((!options.allowDevelopment && r.development) || r.node !== 'v' + NODE_VERSION)
      throw new Error('Unpublishable development/runtime artifact');
    if (
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(r.version) ||
      !/^[a-f0-9]{40}$/.test(r.sourceCommit || '')
    )
      throw new Error('Invalid version/source commit');
    if (
      r.archive !== `lattice-${r.version}-${target.id}.tar.gz` ||
      r.npmFile !== `qcqx-lattice-cli-${target.id}-${r.version}.tgz`
    )
      throw new Error('Invalid archive filename');
    for (const [key, hash] of [
      ['archive', 'archiveSha256'],
      ['npmFile', 'npmSha256'],
    ]) {
      if (sha(path.join(output, r[key])) !== r[hash])
        throw new Error('Release checksum mismatch: ' + r[key]);
    }
    if (
      records.length &&
      (r.version !== records[0].version || r.sourceCommit !== records[0].sourceCommit)
    )
      throw new Error('Mixed release versions or source commits');
    records.push(r);
  }
  if (!records.length) throw new Error('No release targets');
  const version = records[0].version;
  const entry = bootstrap(path.resolve(__dirname, '../..'), output, version);
  const manifest = {
    format: 1,
    version,
    sourceCommit: records[0].sourceCommit,
    node: NODE_VERSION,
    complete: records.length === PLATFORMS.length,
    bootstrap: { filename: entry.filename, sha256: entry.sha256 },
    platforms: records,
  };
  write(path.join(output, 'release-manifest.json'), manifest);
  fs.writeFileSync(path.join(output, 'release-version.txt'), version + '\n');
  fs.copyFileSync(path.join(__dirname, 'install.sh'), path.join(output, 'install.sh'));
  if (manifest.complete)
    fs.writeFileSync(path.join(output, 'lattice.rb'), formula(records, version));
  else fs.rmSync(path.join(output, 'lattice.rb'), { force: true });
  // SHA256SUMS describes the attached standalone assets. npm tarball hashes remain in the
  // release manifest and are independently checked before registry publication.
  const files = [
    ...records.map((r) => r.archive),
    'release-manifest.json',
    'release-version.txt',
    'install.sh',
    ...(manifest.complete ? ['lattice.rb'] : []),
  ];
  fs.writeFileSync(
    path.join(output, 'SHA256SUMS'),
    files.map((file) => sha(path.join(output, file)) + '  ' + file).join('\n') + '\n',
  );
  return manifest;
}
async function waitForPublishedPackages(packages, inspect, { request = fetch, wait = delay } = {}) {
  const deadline = Date.now() + 18 * 60 * 1000;
  let pending = packages;
  do {
    const available = await Promise.all(
      pending.map(async (pkg) => {
        const dist = inspect(pkg);
        if (!dist) return false;
        return (await request(dist.tarball, { method: 'HEAD', signal: AbortSignal.timeout(15000) }))
          .ok;
      }),
    );
    pending = pending.filter((_, index) => !available[index]);
    if (!pending.length) return;
    console.log('Waiting for npm registry downloads: ' + pending.map((pkg) => pkg.name).join(', '));
    await wait(20000);
  } while (Date.now() < deadline);
  throw new Error(
    'Published npm archives are still unavailable: ' + pending.map((pkg) => pkg.name).join(', '),
  );
}

async function publish(output, options = {}) {
  // Always regenerate and validate the entire catalog. Partial/development builds never publish.
  const manifest = assemble(output);
  const npm = options.npm || 'npm';
  const packageFromFile = (name, filename) => {
    const file = path.resolve(output, filename);
    // npm dist.integrity describes exact compressed bytes. A retry may skip only identical content.
    const integrity =
      'sha512-' +
      require('crypto').createHash('sha512').update(fs.readFileSync(file)).digest('base64');
    return { name, file, integrity };
  };
  const platforms = manifest.platforms.map((record) =>
    packageFromFile(record.packageName, record.npmFile),
  );
  const entry = packageFromFile('@qcqx/lattice-cli', manifest.bootstrap.filename);
  function inspect(pkg) {
    const view = require('child_process').spawnSync(
      npm,
      [
        'view',
        pkg.name + '@' + manifest.version,
        'dist',
        '--json',
        '--prefer-online',
        '--fetch-retries=0',
      ],
      { encoding: 'utf8', shell: process.platform === 'win32', timeout: 20000 },
    );
    if (view.error) throw view.error;
    if (view.status !== 0) {
      if (/E404/.test(view.stderr)) return null;
      throw new Error('Cannot inspect registry: ' + view.stderr);
    }
    if (!view.stdout.trim()) return null;
    const dist = JSON.parse(view.stdout);
    if (dist.integrity !== pkg.integrity || !dist.tarball)
      throw new Error('Registry version already exists with different content: ' + pkg.name);
    return dist;
  }
  function publishPackage(pkg) {
    if (inspect(pkg)) return;
    run(npm, ['publish', pkg.file, '--access', 'public', '--provenance'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  platforms.forEach(publishPackage);
  // Registry publish-time scans can expose metadata before the tarball is downloadable.
  await waitForPublishedPackages(platforms, inspect);
  publishPackage(entry);
  await waitForPublishedPackages([entry], inspect);
  return manifest;
}
module.exports = { assemble, formula, publish, waitForPublishedPackages };
