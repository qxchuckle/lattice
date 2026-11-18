const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { pack } = require('./archive.cjs');
const { inventory, platformNpmManifest, read, run, sha, write } = require('./build.cjs');

function payloadSnapshot(directory) {
  return inventory(directory).map((file) => ({
    ...file,
    executable: !!(fs.statSync(path.join(directory, file.path)).mode & 0o111),
  }));
}

function extract(archive, directory) {
  // Reading from stdin also supports archive paths with a drive letter.
  const input = fs.openSync(archive, 'r');
  try {
    run('tar', ['-xzf', '-'], { cwd: directory, stdio: [input, 'pipe', 'pipe'] });
  } finally {
    fs.closeSync(input);
  }
}

function repairPlatformArchive(output, record, cliPackage) {
  const archive = path.join(output, record.npmFile);
  assert.equal(sha(archive), record.npmSha256, 'Platform npm archive failed its original checksum');
  const stage = fs.mkdtempSync(path.join(output, '.npm-metadata-'));
  try {
    extract(archive, stage);
    const manifestFile = path.join(stage, 'package/package.json');
    const original = read(manifestFile);
    const expected = platformNpmManifest(record, record.version, cliPackage);
    if (isDeepStrictEqual(original, expected)) return record;

    const previous = { ...expected };
    for (const property of ['description', 'homepage', 'repository', 'bugs'])
      delete previous[property];
    assert.deepEqual(original, previous, 'Unexpected differences in the original npm manifest');
    const before = payloadSnapshot(path.join(stage, 'package/payload'));
    write(manifestFile, expected);
    const replacement = path.join(stage, record.npmFile);
    pack(stage, 'package', replacement);

    const checked = path.join(stage, 'checked');
    fs.mkdirSync(checked);
    extract(replacement, checked);
    assert.deepEqual(read(path.join(checked, 'package/package.json')), expected);
    assert.deepEqual(
      payloadSnapshot(path.join(checked, 'package/payload')),
      before,
      'Npm metadata repair changed the runtime payload',
    );
    const updated = {
      ...record,
      npmSha256: sha(replacement),
      npmBytes: fs.statSync(replacement).size,
    };
    fs.renameSync(replacement, archive);
    return updated;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [directory, packageFile] = process.argv.slice(2);
  const output = path.resolve(directory);
  const cliPackage = read(packageFile);
  const release = read(path.join(output, 'release-manifest.json'));
  assert.equal(release.complete, true, 'Recovery requires a verified complete release manifest');
  for (const record of release.platforms) {
    const updated = repairPlatformArchive(output, record, cliPackage);
    if (updated !== record) write(path.join(output, record.id + '.json'), updated);
  }
}

module.exports = { repairPlatformArchive };
