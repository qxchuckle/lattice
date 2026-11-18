// Installation-only verification. No core import, user database, model load or network access.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');

function integrity(payload) {
  const manifest = JSON.parse(fs.readFileSync(path.join(payload, 'manifest.json')));
  if (manifest.format !== 2 || !Array.isArray(manifest.files) || !manifest.files.length)
    throw new Error('Invalid payload manifest');
  const seen = new Set();
  for (const record of manifest.files) {
    if (
      typeof record.path !== 'string' ||
      record.path.includes('\\') ||
      path.posix.isAbsolute(record.path) ||
      record.path.split('/').some((s) => s === '..' || s === '.' || s === '') ||
      seen.has(record.path)
    )
      throw new Error('Invalid or repeated manifest path');
    seen.add(record.path);
  }
  let count = 0;
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Nonportable payload link: ' + relative);
      if (entry.isDirectory()) visit(file, relative + '/');
      else {
        if (!entry.isFile()) throw new Error('Nonportable payload asset: ' + relative);
        if (relative === 'manifest.json') continue;
        if (!seen.has(relative)) throw new Error('Unlisted payload file: ' + relative);
        count++;
      }
    }
  }
  visit(payload);
  if (count !== seen.size) throw new Error('Missing payload file');
  for (const record of manifest.files) {
    const bytes = fs.readFileSync(path.join(payload, record.path));
    if (
      bytes.length !== record.bytes ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== record.sha256
    )
      throw new Error('Payload checksum mismatch: ' + record.path);
  }
  return manifest;
}
function probe(payload, expectedVersion, runtimePayload = payload) {
  const manifest = integrity(payload);
  const executable = path.join(
    runtimePayload,
    'runtime',
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  if (
    manifest.version !== expectedVersion ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    manifest.node.version !== process.version ||
    manifest.node.abi !== process.versions.modules ||
    fs.realpathSync(executable) !== fs.realpathSync(process.execPath)
  )
    throw new Error('Candidate runtime identity mismatch');
  const appRequire = createRequire(path.join(payload, 'app/package.json'));
  const webEntry = path.join(payload, 'app/node_modules/@qcqx/lattice-web/dist/server/index.js');
  const webClient = path.resolve(path.dirname(webEntry), '../client');
  if (!fs.statSync(webEntry).isFile() || !fs.statSync(path.join(webClient, 'index.html')).isFile())
    throw new Error('Bundled Web entry or client assets missing');
  const webRequire = createRequire(webEntry);
  const servicesRequire = createRequire(webRequire.resolve('@qcqx/lattice-services'));
  const core = appRequire.resolve('@qcqx/lattice-core');
  if (
    [webRequire, servicesRequire].some(
      (resolveFrom) => resolveFrom.resolve('@qcqx/lattice-core') !== core,
    )
  )
    throw new Error('Web and CLI must share the bundled core');
  const pty = path.join(
    payload,
    'app/node_modules/@qcqx/lattice-web/node_modules/@homebridge/node-pty-prebuilt-multiarch',
  );
  if (fs.existsSync(pty) && typeof webRequire(pty).spawn !== 'function')
    throw new Error('Bundled terminal PTY is invalid');
  const Database = appRequire('better-sqlite3');
  const db = new Database(':memory:');
  try {
    db.exec('CREATE VIRTUAL TABLE f USING fts5(text)');
    appRequire('sqlite-vec').load(db);
    db.prepare('SELECT vec_version()').get();
  } finally {
    db.close();
  }
  // The official Transformers Node entry loads ORT and sharp, but creates no inference session.
  const coreRequire = createRequire(
    path.join(payload, 'app/node_modules/@qcqx/lattice-core/package.json'),
  );
  const hf = coreRequire('@huggingface/transformers');
  if (typeof hf.pipeline !== 'function') throw new Error('Transformers Node entry is incomplete');
  return manifest;
}
if (require.main === module) {
  try {
    const runtimePayload = path.resolve(__dirname, '..');
    probe(
      process.argv[3] ? path.resolve(process.argv[3]) : runtimePayload,
      process.argv[2],
      runtimePayload,
    );
  } catch (error) {
    process.stderr.write('Lattice candidate verification failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
module.exports = { integrity, probe };
