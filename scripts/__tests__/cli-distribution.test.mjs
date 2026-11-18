import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const { pack } = require('../cli-distribution/archive.cjs');
const {
  sha,
  write,
  read,
  inventory,
  bootstrap,
  platformNpmManifest,
} = require('../cli-distribution/build.cjs');
const { integrity } = require('../cli-distribution/verify.cjs');
const { PLATFORMS, NODE_VERSION } = require('../cli-distribution/config.cjs');
const { assemble, waitForPublishedPackages } = require('../cli-distribution/release.cjs');
const { materialize, compatible, keepFile } = require('../cli-distribution/dependencies.cjs');
const { repairPlatformArchive } = require('../cli-distribution/repair-platform-metadata.cjs');
const repo = path.resolve(
  import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
  '../..',
);
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-dist-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function makePackage(dir, name, version, dependencies = {}, extra = {}) {
  write(path.join(dir, 'package.json'), { name, version, dependencies, ...extra });
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports=' + JSON.stringify(version));
}

test('deterministic archives ignore timestamps; no links escape the payload', (t) => {
  const root = temporary(t);
  makePackage(path.join(root, 'package'), 'fixture', '1.0.0');
  pack(root, 'package', path.join(root, 'a.tgz'));
  fs.utimesSync(path.join(root, 'package/index.js'), new Date(), new Date());
  pack(root, 'package', path.join(root, 'b.tgz'));
  assert.equal(sha(path.join(root, 'a.tgz')), sha(path.join(root, 'b.tgz')));
  fs.symlinkSync(path.join(root, 'a.tgz'), path.join(root, 'package/link'));
  assert.throws(() => pack(root, 'package', path.join(root, 'c.tgz')), /unsupported/);
});
test('npm recovery adds provenance information only to the platform archive metadata', (t) => {
  const root = temporary(t);
  const target = PLATFORMS[0];
  const version = '1.30.0';
  const cli = read(path.join(repo, 'packages/cli/package.json'));
  const expected = platformNpmManifest(target, version, cli);
  assert.equal(expected.repository.url, 'git+https://github.com/qxchuckle/lattice.git');
  assert.equal(expected.homepage, cli.homepage);
  assert.throws(() => platformNpmManifest(target, version, {}), /repository URL/);

  const legacy = {
    name: target.packageName,
    version,
    os: [target.os],
    cpu: [target.arch],
    license: 'MIT',
    files: ['payload'],
    publishConfig: { access: 'public' },
  };
  write(path.join(root, 'package/package.json'), legacy);
  fs.mkdirSync(path.join(root, 'package/payload'));
  fs.writeFileSync(path.join(root, 'package/payload/ltc'), 'original runtime', { mode: 0o755 });
  const archive = `lattice-${version}-${target.id}.tar.gz`;
  const npmFile = `qcqx-lattice-cli-${target.id}-${version}.tgz`;
  pack(root, 'package/payload', path.join(root, archive));
  pack(root, 'package', path.join(root, npmFile));
  const original = {
    ...target,
    version,
    archive,
    archiveSha256: sha(path.join(root, archive)),
    npmFile,
    npmSha256: sha(path.join(root, npmFile)),
  };
  const updated = repairPlatformArchive(root, original, cli);
  assert.equal(updated.archiveSha256, sha(path.join(root, archive)));
  assert.notEqual(updated.npmSha256, original.npmSha256);
  assert.equal(updated.npmSha256, sha(path.join(root, npmFile)));
  assert.equal(repairPlatformArchive(root, updated, cli), updated);
  assert.throws(() => repairPlatformArchive(root, original, cli), /original checksum/);
});
test('npm publication waits for metadata and downloadable platform archives', async () => {
  const platforms = [{ name: 'first' }, { name: 'second' }];
  const attempts = [];
  let poll = 0;
  await waitForPublishedPackages(
    platforms,
    (pkg) => (pkg.name === 'second' && poll === 0 ? null : { tarball: pkg.name }),
    {
      request: (url, options) => {
        assert.equal(options.method, 'HEAD');
        attempts.push([url, poll]);
        return { ok: url === 'first' || poll === 2 };
      },
      wait: () => {
        poll++;
      },
    },
  );
  assert.deepEqual(attempts, [
    ['first', 0],
    ['second', 1],
    ['second', 2],
  ]);
});
test('integrity rejects corruption, missing/unlisted files, traversal, duplicates and links', (t) => {
  const root = temporary(t);
  fs.writeFileSync(path.join(root, 'a'), 'verified');
  const manifest = { format: 2, files: inventory(root) };
  const restore = () => write(path.join(root, 'manifest.json'), manifest);
  restore();
  integrity(root);
  fs.writeFileSync(path.join(root, 'a'), 'corrupt');
  assert.throws(() => integrity(root), /checksum/);
  fs.writeFileSync(path.join(root, 'a'), 'verified');
  fs.writeFileSync(path.join(root, 'unlisted'), 'x');
  assert.throws(() => integrity(root), /Unlisted/);
  fs.rmSync(path.join(root, 'unlisted'));
  for (const files of [
    [{ ...manifest.files[0], path: '../escape' }],
    [{ ...manifest.files[0], path: './a' }],
    [manifest.files[0], manifest.files[0]],
  ]) {
    write(path.join(root, 'manifest.json'), { ...manifest, files });
    assert.throws(() => integrity(root), /manifest path/);
  }
  restore();
  fs.rmSync(path.join(root, 'a'));
  assert.throws(() => integrity(root));
  fs.symlinkSync(path.join(root, 'manifest.json'), path.join(root, 'a'));
  assert.throws(() => integrity(root), /Nonportable/);
});
test('physical closure preserves shared packages, version conflicts, cycles and optional platforms', (t) => {
  const root = temporary(t),
    cli = path.join(root, 'packages/cli'),
    app = path.join(root, 'app');
  makePackage(cli, 'fixture-cli', '1', { a: '*', b: '*' });
  const a = path.join(cli, 'node_modules/a'),
    b = path.join(cli, 'node_modules/b');
  makePackage(a, 'a', '1', { b: '*' });
  makePackage(b, 'b', '1', { a: '*' });
  const first = materialize(cli, app, { id: 'linux-x64', os: 'linux', arch: 'x64', libc: 'glibc' });
  assert.equal(first.length, 2);
  fs.rmSync(app, { recursive: true });
  makePackage(path.join(a, 'node_modules/b'), 'b', '2');
  write(path.join(b, 'package.json'), {
    name: 'b',
    version: '1',
    optionalDependencies: { missing: '*', foreign: '*' },
  });
  makePackage(path.join(b, 'node_modules/foreign'), 'foreign', '1', {}, { os: ['win32'] });
  const second = materialize(cli, app, {
    id: 'linux-x64',
    os: 'linux',
    arch: 'x64',
    libc: 'glibc',
  });
  assert.equal(second.length, 3);
  assert.equal(read(path.join(app, 'node_modules/a/node_modules/b/package.json')).version, '2');
  assert.equal(fs.existsSync(path.join(app, 'node_modules/b/node_modules/foreign')), false);
  write(path.join(a, 'package.json'), {
    name: '@huggingface/transformers',
    version: '99',
    dependencies: {},
  });
  assert.throws(
    () => materialize(cli, path.join(root, 'bad'), { os: 'linux', arch: 'x64' }),
    /Review.*pruning/,
  );
});
test('pruning keeps mandatory assets/licenses and rejects other platforms', () => {
  assert.equal(
    keepFile({ name: '@huggingface/transformers' }, 'dist/transformers.node.mjs', {}, false),
    true,
  );
  assert.equal(
    keepFile({ name: '@huggingface/transformers' }, 'dist/transformers.web.js', {}, false),
    false,
  );
  assert.equal(
    keepFile(
      { name: 'onnxruntime-node' },
      'bin/napi-v3/darwin/arm64/libonnxruntime.dylib',
      { os: 'darwin', arch: 'arm64' },
      false,
    ),
    true,
  );
  assert.equal(
    keepFile(
      { name: 'onnxruntime-node' },
      'bin/napi-v3/linux/x64/libonnxruntime.so',
      { os: 'darwin', arch: 'arm64' },
      false,
    ),
    false,
  );
  assert.equal(keepFile({ name: 'fixture' }, 'NOTICE', {}, true), true);
  assert.equal(
    keepFile({ name: '@huggingface/transformers' }, 'ThirdPartyNotices.txt', {}, false),
    true,
  );
  assert.equal(keepFile({ name: 'fixture' }, 'dist/templates/skill.md', {}, true), true);
  assert.equal(compatible({ os: ['!win32'], cpu: ['x64'] }, { os: 'linux', arch: 'x64' }), true);
  assert.equal(compatible({ libc: ['glibc'] }, { os: 'linux', arch: 'x64', libc: 'musl' }), false);
});
function releaseFixture(root) {
  for (const target of PLATFORMS) {
    const version = '1.29.0',
      archive = `lattice-${version}-${target.id}.tar.gz`,
      npmFile = `qcqx-lattice-cli-${target.id}-${version}.tgz`;
    fs.writeFileSync(path.join(root, archive), target.id);
    fs.writeFileSync(path.join(root, npmFile), target.id);
    write(path.join(root, target.id + '.json'), {
      ...target,
      version,
      archive,
      npmFile,
      archiveSha256: sha(path.join(root, archive)),
      npmSha256: sha(path.join(root, npmFile)),
      sourceCommit: 'a'.repeat(40),
      node: 'v' + NODE_VERSION,
      development: false,
    });
  }
}
test('release gate injects missing/mixed/development/runtime/catalog/hash errors and restores clean state', (t) => {
  const root = temporary(t);
  releaseFixture(root);
  const valid = assemble(root);
  assert.equal(valid.complete, true);
  const file = path.join(root, PLATFORMS[0].id + '.json'),
    original = read(file);
  for (const patch of [
    { version: '2.0.0' },
    { sourceCommit: 'b'.repeat(40) },
    { development: true },
    { node: 'v0.0.0' },
    { arch: 'wrong' },
    { archiveSha256: '0'.repeat(64) },
    { archive: '../escape' },
  ]) {
    write(file, { ...original, ...patch });
    assert.throws(() => assemble(root));
    write(file, original);
    assert.equal(assemble(root).complete, true);
  }
  fs.rmSync(file);
  assert.throws(() => assemble(root), /Missing release target/);
  assert.equal(assemble(root, { allowPartial: true }).complete, false);
  assert.equal(fs.existsSync(path.join(root, 'lattice.rb')), false);
  write(file, original);
  assemble(root);
  const formula = fs.readFileSync(path.join(root, 'lattice.rb'), 'utf8');
  const sums = fs.readFileSync(path.join(root, 'SHA256SUMS'), 'utf8').trim().split('\n');
  assert.equal(sums.length, PLATFORMS.length + 4);
  assert.equal(
    sums.some((line) => line.endsWith('.tgz')),
    false,
    'unattached npm files must not appear in standalone checksums',
  );
  assert.ok(sums.some((line) => line.endsWith('  lattice.rb')));
  for (const line of sums) {
    const [hash, file] = line.split('  ');
    assert.equal(sha(path.join(root, file)), hash);
  }

  for (const r of valid.platforms.filter((r) => r.os !== 'win32')) {
    assert.ok(formula.includes(r.archive));
    assert.ok(formula.includes(r.archiveSha256));
  }
});
test('thin npm manifest contains only exact platform deps, Node14 entry and no install scripts', (t) => {
  const root = temporary(t);
  const a = bootstrap(repo, root, '1.29.0');
  const pkg = read(path.join(a.directory, 'package.json'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts, undefined);
  assert.equal(pkg.engines.node, '>=14.14');
  assert.deepEqual(
    pkg.optionalDependencies,
    Object.fromEntries(PLATFORMS.map((p) => [p.packageName, '1.29.0'])),
  );
  const b = bootstrap(repo, root, '1.29.0');
  assert.equal(a.sha256, b.sha256);
});
test(
  'shell installer checks hash/candidate/foreign aliases and atomically keeps current on failure',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = temporary(t),
      release = path.join(root, 'release'),
      build = path.join(root, 'build');
    fs.mkdirSync(release);
    fs.mkdirSync(path.join(build, 'payload/bin'), { recursive: true });
    fs.mkdirSync(path.join(build, 'payload/runtime'), { recursive: true });
    fs.mkdirSync(path.join(build, 'payload/scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(build, 'payload/runtime/node'),
      '#!/bin/sh\nexec ' + "'" + process.execPath.replaceAll("'", "'\\''") + "'" + ' "$@"\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(build, 'payload/scripts/payload.cjs'),
      'const fs=require("fs"),p=require("path");const root=process.argv[3]||p.resolve(__dirname,"..");require(' +
        JSON.stringify(path.join(repo, 'packages/cli/scripts/payload.cjs')) +
        ').integrity(root);if(fs.readFileSync(p.join(root,"asset"),"utf8")!=="intact")process.exit(19)',
    );
    fs.writeFileSync(path.join(build, 'payload/manifest.json'), '{"version":"1.29.0"}');
    fs.writeFileSync(path.join(build, 'payload/asset'), 'intact');
    const entry = path.join(build, 'payload/bin/ltc');
    fs.writeFileSync(entry, '#!/bin/sh\necho 1.29.0\n', { mode: 0o755 });
    const target = PLATFORMS.find((p) => p.os === process.platform && p.arch === process.arch);
    const archive = `lattice-1.29.0-${target.id}.tar.gz`;
    function archiveFixture() {
      write(path.join(build, 'payload/manifest.json'), {
        format: 2,
        version: '1.29.0',
        files: inventory(path.join(build, 'payload')).filter((f) => f.path !== 'manifest.json'),
      });
      pack(build, 'payload', path.join(release, archive));
      fs.writeFileSync(
        path.join(release, 'SHA256SUMS'),
        sha(path.join(release, archive)) + '  ' + archive + '\n',
      );
    }
    archiveFixture();
    fs.writeFileSync(path.join(release, 'release-version.txt'), '1.29.0\n');
    const prefix = path.join(root, "installation's space"),
      bin = path.join(root, 'bin');
    const installArgs = (app = prefix, aliases = bin) => [
      path.join(repo, 'scripts/cli-distribution/install.sh'),
      '--from',
      release,
      '--prefix',
      app,
      '--bin',
      aliases,
    ];
    const env = { ...process.env, HOME: root, LATTICE_HOME: path.join(root, 'data') };
    const install = (app, aliases) =>
      spawnSync('/bin/sh', installArgs(app, aliases), {
        env,
        encoding: 'utf8',
        timeout: 10000,
      });
    assert.equal(install().status, 0);
    const original = fs.readlinkSync(path.join(prefix, 'current'));
    fs.writeFileSync(path.join(original, 'asset'), 'corrupt');
    assert.equal(install().status, 0, 'same-version reinstall must repair damaged non-entry files');
    let previous = fs.readlinkSync(path.join(prefix, 'current'));
    assert.notEqual(previous, original);
    assert.equal(fs.readFileSync(path.join(previous, 'asset'), 'utf8'), 'intact');
    assert.equal(install().status, 0);
    assert.equal(
      fs.readlinkSync(path.join(prefix, 'current')),
      previous,
      'intact repair is reused',
    );
    fs.writeFileSync(path.join(previous, 'scripts/payload.cjs'), 'process.exit(0)');
    assert.equal(
      install().status,
      0,
      'verification must use the fresh verifier rather than a modified installed script',
    );
    assert.notEqual(fs.readlinkSync(path.join(prefix, 'current')), previous);
    previous = fs.readlinkSync(path.join(prefix, 'current'));
    assert.notEqual(
      fs.readFileSync(path.join(previous, 'scripts/payload.cjs'), 'utf8'),
      'process.exit(0)',
    );
    fs.mkdirSync(path.join(bin, '.lattice-install-lock'));
    assert.notEqual(
      install().status,
      0,
      'concurrent installer must not interleave aliases/current',
    );
    assert.equal(fs.readlinkSync(path.join(prefix, 'current')), previous);
    fs.rmdirSync(path.join(bin, '.lattice-install-lock'));
    fs.writeFileSync(path.join(build, 'payload/asset'), 'invalid-native-candidate');
    archiveFixture();
    assert.notEqual(
      install().status,
      0,
      'version-only success must not activate failed dependency probe',
    );
    assert.equal(fs.readlinkSync(path.join(prefix, 'current')), previous);
    fs.writeFileSync(path.join(build, 'payload/asset'), 'intact');
    archiveFixture();
    fs.writeFileSync(path.join(release, 'SHA256SUMS'), '0'.repeat(64) + '  ' + archive + '\n');
    assert.notEqual(install().status, 0);
    assert.equal(fs.readlinkSync(path.join(prefix, 'current')), previous);
    fs.writeFileSync(entry, '#!/bin/sh\nexit 17\n');
    archiveFixture();
    assert.notEqual(install().status, 0);
    assert.equal(fs.readlinkSync(path.join(prefix, 'current')), previous);
    fs.writeFileSync(entry, '#!/bin/sh\necho 1.29.0\n');
    archiveFixture();
    fs.rmSync(path.join(bin, 'lattice'));
    fs.symlinkSync(path.join(root, 'missing'), path.join(bin, 'lattice'));
    assert.notEqual(install().status, 0);
    assert.equal(fs.readlinkSync(path.join(prefix, 'current')), previous);
    assert.equal(fs.readlinkSync(path.join(bin, 'lattice')), path.join(root, 'missing'));
    assert.equal(
      fs.readdirSync(path.join(prefix, 'versions')).some((n) => n.startsWith('.install-')),
      false,
    );

    fs.unlinkSync(path.join(bin, 'lattice'));
    const tools = path.join(root, 'fake-tools');
    fs.mkdirSync(tools);
    const paused = path.join(root, 'installer-paused');
    fs.writeFileSync(
      path.join(tools, 'cp'),
      '#!/bin/sh\nkill -STOP "$PPID"\n: > "$INSTALL_TEST_PAUSED"\nexit 1\n',
      { mode: 0o700 },
    );
    const installer = spawn('/bin/sh', installArgs(), {
      env: { ...env, PATH: tools + path.delimiter + env.PATH, INSTALL_TEST_PAUSED: paused },
      stdio: 'ignore',
    });
    const stopped = once(installer, 'close');
    try {
      for (let i = 0; i < 100 && !fs.existsSync(paused); i++) await delay(25);
      assert.ok(fs.existsSync(paused), 'installer holds both locks before the forced crash');
      assert.match(install(path.join(root, 'second-prefix'), bin).stderr, /another installation/);
      assert.match(install(prefix, path.join(root, 'second-bin')).stderr, /another installation/);
      assert.equal(fs.readlinkSync(path.join(prefix, 'current')), previous);
    } finally {
      installer.kill('SIGKILL');
      assert.deepEqual(await stopped, [null, 'SIGKILL']);
    }
    const retried = install();
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(fs.readlinkSync(path.join(prefix, 'current')), previous);
    assert.equal(
      fs.readlinkSync(path.join(bin, 'lattice')),
      path.join(fs.realpathSync(prefix), 'current/bin/lattice'),
    );
    assert.equal(
      fs.readdirSync(prefix).some((name) => name.startsWith('.install-lock')),
      false,
    );
    assert.equal(
      fs.readdirSync(bin).some((name) => name.startsWith('.lattice-install-lock')),
      false,
    );
  },
);
