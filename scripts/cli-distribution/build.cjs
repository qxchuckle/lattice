const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { NODE_VERSION, PLATFORMS, hostTarget } = require('./config.cjs');
const { materialize } = require('./dependencies.cjs');
const { pack } = require('./archive.cjs');
const { privateNodeEnv } = require('../../packages/cli/scripts/runtime.cjs');

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function run(executable, args, options) {
  const result = childProcess.spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: 120000,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      'Failed: ' +
        executable +
        ' ' +
        args.join(' ') +
        '\n' +
        (result.error ? result.error.message : result.stderr || result.stdout),
    );
  return result.stdout;
}
function info(executable) {
  return JSON.parse(
    run(
      executable,
      [
        '-e',
        'console.log(JSON.stringify({version:process.version,abi:process.versions.modules,napi:process.versions.napi,platform:process.platform,arch:process.arch,shared:Object.entries(process.config.variables).some(([k,v])=>/^node_shared($|_)/.test(k)&&(v===true||v===1||v==="true"))}))',
      ],
      { env: privateNodeEnv() },
    ),
  );
}
function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function inventory(directory) {
  const files = [];
  function visit(current, prefix = '') {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error('Distribution contains a nonportable link: ' + file);
      if (entry.isDirectory()) visit(file, relative + '/');
      else files.push({ path: relative, bytes: fs.statSync(file).size, sha256: sha(file) });
    }
  }
  visit(directory);
  return files;
}
function copyTree(source, destination, filter) {
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (file) => !filter || filter(file),
  });
}
function launchers(payload, cliRoot) {
  fs.mkdirSync(path.join(payload, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(cliRoot, 'bin/ltc.cjs'), path.join(payload, 'bin/ltc.cjs'));
  fs.copyFileSync(
    path.join(cliRoot, 'scripts/runtime.cjs'),
    path.join(payload, 'scripts/runtime.cjs'),
  );
  fs.copyFileSync(
    path.join(cliRoot, 'scripts/payload.cjs'),
    path.join(payload, 'scripts/payload.cjs'),
  );
  const unix = [
    '#!/bin/sh',
    'set -eu',
    'source_path=$0',
    'while [ -L "$source_path" ]; do',
    '  source_dir=$(CDPATH= cd -- "$(dirname -- "$source_path")" && pwd)',
    '  source_path=$(readlink "$source_path")',
    '  case $source_path in /*) ;; *) source_path=$source_dir/$source_path ;; esac',
    'done',
    'source_dir=$(CDPATH= cd -- "$(dirname -- "$source_path")" && pwd)',
    'unset NODE_OPTIONS NODE_PATH',
    'exec "$source_dir/../runtime/node" "$source_dir/ltc.cjs" "$@"',
    '',
  ].join('\n');
  for (const name of ['ltc', 'lattice']) {
    fs.writeFileSync(path.join(payload, 'bin', name), unix, { mode: 0o755 });
    fs.writeFileSync(
      path.join(payload, 'bin', name + '.cmd'),
      '@echo off\r\nsetlocal\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\n"%~dp0..\\runtime\\node.exe" "%~dp0ltc.cjs" %*\r\n',
    );
  }
  fs.chmodSync(path.join(payload, 'bin/ltc.cjs'), 0o755);
}

function bootstrap(repo, output, version) {
  const cliRoot = path.join(repo, 'packages/cli');
  const original = read(path.join(cliRoot, 'package.json'));
  const directory = path.join(output, 'bootstrap', 'package');
  fs.rmSync(path.dirname(directory), { recursive: true, force: true });
  fs.mkdirSync(path.join(directory, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true });
  for (const file of ['bin/ltc.cjs', 'scripts/runtime.cjs'])
    fs.copyFileSync(path.join(cliRoot, file), path.join(directory, file));
  const pkg = {};
  for (const key of ['name', 'description', 'homepage', 'repository', 'bugs', 'license'])
    pkg[key] = original[key];
  Object.assign(pkg, {
    version,
    bin: { ltc: 'bin/ltc.cjs', lattice: 'bin/ltc.cjs' },
    engines: { node: '>=14.14' },
    files: ['bin', 'scripts', 'platforms.json'],
    optionalDependencies: Object.fromEntries(PLATFORMS.map((p) => [p.packageName, version])),
    publishConfig: { access: 'public' },
  });
  write(path.join(directory, 'package.json'), pkg);
  write(
    path.join(directory, 'platforms.json'),
    PLATFORMS.map(({ id, os, arch, libc, packageName }) => ({ id, os, arch, libc, packageName })),
  );
  fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(directory, 'LICENSE'));
  const filename = 'qcqx-lattice-cli-' + version + '.tgz';
  pack(path.dirname(directory), 'package', path.join(output, filename));
  return { directory, filename, sha256: sha(path.join(output, filename)) };
}

function build(options = {}) {
  const repo = path.resolve(options.repo || path.join(__dirname, '../..'));
  const output = path.resolve(options.output || path.join(repo, 'dist-cli'));
  if (output === repo || output.startsWith(path.join(repo, 'packages') + path.sep))
    throw new Error('Unsafe distribution output directory');
  const target = hostTarget();
  if (options.target && options.target !== target.id)
    throw new Error('Native dependencies must be built on the requested target ' + options.target);
  const executable = fs.realpathSync(options.node || process.execPath);
  const node = info(executable);
  if (node.platform !== target.os || node.arch !== target.arch || node.shared)
    throw new Error('Runtime is not a relocatable Node for ' + target.id);
  if (!options.developmentRuntime && node.version !== 'v' + NODE_VERSION)
    throw new Error('Release runtime must be Node ' + NODE_VERSION);
  const cliRoot = path.join(repo, 'packages/cli');
  const cliPkg = read(path.join(cliRoot, 'package.json'));
  const version = options.version || cliPkg.version;
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid CLI release version');
  const packageDir = path.join(output, 'work', target.id, 'package');
  const payload = path.join(packageDir, 'payload');
  fs.mkdirSync(output, { recursive: true });
  fs.rmSync(path.dirname(packageDir), { recursive: true, force: true });
  fs.mkdirSync(path.join(payload, 'runtime'), { recursive: true });
  const app = path.join(payload, 'app');
  fs.mkdirSync(app);
  copyTree(
    path.join(cliRoot, 'dist'),
    path.join(app, 'dist'),
    (file) => !/\.(map|d\.[cm]?ts)$/.test(file),
  );
  write(path.join(app, 'package.json'), { ...cliPkg, version, scripts: {}, devDependencies: {} });
  const components = materialize(cliRoot, app, { ...target, abi: node.abi }, executable);
  if (options.sqliteBinding) {
    fs.copyFileSync(
      options.sqliteBinding,
      path.join(app, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    );
    const component = components.find((c) => c.path === 'node_modules/better-sqlite3');
    const actual = inventory(path.join(app, component.path));
    component.bytes = actual.reduce((sum, f) => sum + f.bytes, 0);
    component.files = actual.length;
  }
  fs.copyFileSync(
    executable,
    path.join(payload, 'runtime', target.os === 'win32' ? 'node.exe' : 'node'),
  );
  fs.chmodSync(path.join(payload, 'runtime', target.os === 'win32' ? 'node.exe' : 'node'), 0o755);
  fs.mkdirSync(path.join(payload, 'licenses'));
  fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(payload, 'licenses/Lattice-LICENSE'));
  copyTree(
    path.join(__dirname, 'licenses/onnxruntime-1.21.0'),
    path.join(payload, 'licenses/onnxruntime-1.21.0'),
  );
  const nodeLicense =
    options.nodeLicense ||
    path.resolve(executable, target.os === 'win32' ? '../LICENSE' : '../../LICENSE');
  if (!fs.existsSync(nodeLicense))
    throw new Error('Official Node LICENSE is required; specify --node-license');
  fs.copyFileSync(nodeLicense, path.join(payload, 'licenses/Node-LICENSE'));
  write(path.join(payload, 'package.json'), { name: target.packageName, version, private: true });
  launchers(payload, cliRoot);
  let sourceCommit;
  let sourceDirty = true;
  try {
    sourceCommit = run('git', ['rev-parse', 'HEAD'], { cwd: repo }).trim();
    sourceDirty = !!run('git', ['status', '--porcelain'], { cwd: repo }).trim();
  } catch {
    sourceCommit = null;
  }
  const files = inventory(payload);
  const manifest = {
    format: 2,
    version,
    target: target.id,
    platform: target.os,
    arch: target.arch,
    libc: target.libc,
    node,
    sourceCommit,
    sourceDirty,
    development: !!options.developmentRuntime || sourceDirty,
    components,
    files,
  };
  write(path.join(payload, 'manifest.json'), manifest);
  write(path.join(packageDir, 'package.json'), {
    name: target.packageName,
    version,
    os: [target.os],
    cpu: [target.arch],
    ...(target.libc ? { libc: [target.libc] } : {}),
    license: 'MIT',
    files: ['payload'],
    publishConfig: { access: 'public' },
  });
  const { verify } = require('./verify.cjs');
  verify(payload);
  const npmFile = 'qcqx-lattice-cli-' + target.id + '-' + version + '.tgz';
  const archive = 'lattice-' + version + '-' + target.id + '.tar.gz';
  pack(path.dirname(packageDir), 'package', path.join(output, npmFile));
  pack(packageDir, 'payload', path.join(output, archive));
  const record = {
    ...target,
    version,
    node: node.version,
    sourceCommit,
    sourceDirty,
    development: manifest.development,
    archive,
    archiveSha256: sha(path.join(output, archive)),
    npmFile,
    npmSha256: sha(path.join(output, npmFile)),
    unpackedBytes:
      files.reduce((sum, f) => sum + f.bytes, 0) +
      fs.statSync(path.join(payload, 'manifest.json')).size,
    archiveBytes: fs.statSync(path.join(output, archive)).size,
    npmBytes: fs.statSync(path.join(output, npmFile)).size,
  };
  write(path.join(output, target.id + '.json'), record);
  bootstrap(repo, output, version);
  return { payload, record };
}

module.exports = { build, bootstrap, run, info, sha, inventory, read, write };
