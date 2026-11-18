const fs = require('fs');
const path = require('path');
const { NODE_VERSION, PLATFORMS } = require('./config.cjs');
const { read, write, sha, bootstrap, run } = require('./build.cjs');

function formula(records, version) {
  const stanza = (r) =>
    `      url "https://github.com/qxchuckle/lattice/releases/download/v${version}/${r.archive}"\n      sha256 "${r.archiveSha256}"`;
  const platform = (os) =>
    `  on_${os === 'darwin' ? 'macos' : 'linux'} do\n    on_arm do\n${stanza(records.find((r) => r.id === os + '-arm64'))}\n    end\n    on_intel do\n${stanza(records.find((r) => r.id === os + '-x64'))}\n    end\n  end`;
  return `# Generated for the Lattice-owned tap; not a homebrew/core formula.\nclass Lattice < Formula\n  desc "Local-first engineering memory and workflow"\n  homepage "https://lattice.qcqx.cn"\n  version "${version}"\n  license "MIT"\n${platform('darwin')}\n${platform('linux')}\n  def install\n    libexec.install Dir["*"]\n    bin.install_symlink libexec/"bin/ltc", libexec/"bin/lattice"\n  end\n  test do\n    assert_equal version.to_s, shell_output("#{bin}/ltc --version").strip\n    assert_match "--no-open", shell_output("#{bin}/ltc web --help")\n    ENV.delete("NODE_OPTIONS")\n    ENV.delete("NODE_PATH")\n    system libexec/"runtime/node", libexec/"scripts/payload.cjs", version.to_s\n  end\nend\n`;
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
function publish(output, options = {}) {
  // Always regenerate and validate the entire catalog. Partial/development builds never publish.
  const manifest = assemble(output);
  const npm = options.npm || 'npm';
  const packages = manifest.platforms
    .map((r) => ({ name: r.packageName, file: r.npmFile }))
    .concat([{ name: '@qcqx/lattice-cli', file: manifest.bootstrap.filename }]);
  for (const pkg of packages) {
    const file = path.resolve(output, pkg.file);
    // npm dist.integrity describes exact compressed bytes. A retry may skip only identical content.
    const integrity =
      'sha512-' +
      require('crypto').createHash('sha512').update(fs.readFileSync(file)).digest('base64');
    const view = require('child_process').spawnSync(
      npm,
      ['view', pkg.name + '@' + manifest.version, 'dist.integrity', '--json'],
      { encoding: 'utf8', shell: process.platform === 'win32' },
    );
    if (view.error) throw view.error;
    if (view.status === 0) {
      if (JSON.parse(view.stdout) !== integrity)
        throw new Error('Registry version already exists with different content: ' + pkg.name);
      continue;
    }
    if (!/E404/.test(view.stderr)) throw new Error('Cannot inspect registry: ' + view.stderr);
    run(npm, ['publish', file, '--access', 'public', '--provenance'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  return manifest;
}
module.exports = { assemble, formula, publish };
