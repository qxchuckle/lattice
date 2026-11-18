// Only built-ins. The npm bootstrap must also parse and run under Node 14.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const childProcess = require('child_process');

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function privateNodeEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^NODE_(OPTIONS|PATH)$/i.test(key)),
  );
}

function manifestAt(payload, expectedVersion) {
  const manifest = json(path.join(payload, 'manifest.json'));
  if (
    manifest.format !== 2 ||
    manifest.version !== expectedVersion ||
    manifest.platform !== process.platform ||
    typeof manifest.arch !== 'string' ||
    !/^v\d+\.\d+\.\d+$/.test(manifest.node.version) ||
    typeof manifest.node.abi !== 'string'
  ) {
    throw new Error('Lattice 平台运行包的版本或平台信息无效，请重新安装');
  }
  if (
    manifest.libc === 'glibc' &&
    process.platform === 'linux' &&
    process.report &&
    !process.report.getReport().header.glibcVersionRuntime
  ) {
    throw new Error('此 Lattice 平台运行包需要 glibc，尚不支持 musl');
  }
  for (const file of [
    'runtime/' + (manifest.platform === 'win32' ? 'node.exe' : 'node'),
    'app/dist/index.js',
    'bin/ltc.cjs',
  ]) {
    if (!fs.statSync(path.join(payload, file)).isFile())
      throw new Error('Lattice 平台运行包不完整：' + file);
  }
  return manifest;
}

function resolvePayload(packageRoot) {
  const pkg = json(path.join(packageRoot, 'package.json'));
  if (fs.existsSync(path.join(packageRoot, 'manifest.json'))) {
    return { payload: packageRoot, manifest: manifestAt(packageRoot, pkg.version) };
  }
  const targets = json(path.join(packageRoot, 'platforms.json'));
  const candidates = targets
    .filter((target) => target.os === process.platform)
    .sort((a, b) => Number(b.arch === process.arch) - Number(a.arch === process.arch));
  for (const target of candidates) {
    let file;
    try {
      file = require.resolve(target.packageName + '/package.json', { paths: [packageRoot] });
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    const installed = json(file);
    if (installed.version !== pkg.version)
      throw new Error('Lattice 入口与平台包版本不一致，请重新安装');
    const payload = path.join(path.dirname(file), 'payload');
    return { payload, manifest: manifestAt(payload, pkg.version) };
  }
  throw new Error(
    '未安装此平台的 Lattice 运行包，请启用 npm optionalDependencies 后重新安装，或使用独立安装渠道',
  );
}

function launch(packageRoot, args) {
  const { payload, manifest } = resolvePayload(packageRoot);
  const executable = path.join(
    payload,
    'runtime',
    manifest.platform === 'win32' ? 'node.exe' : 'node',
  );
  if (fs.realpathSync(process.execPath) === fs.realpathSync(executable)) {
    if (
      process.version !== manifest.node.version ||
      process.versions.modules !== manifest.node.abi ||
      process.platform !== manifest.platform ||
      process.arch !== manifest.arch
    ) {
      throw new Error('Lattice 运行时版本/ABI 与平台记录不一致；数据库未被打开');
    }
    const entry = path.join(payload, 'app', 'dist', 'index.js');
    process.argv = [process.execPath, entry].concat(args);
    return import(pathToFileURL(entry).href);
  }
  // Hand over once. The managed process checks its own identity and imports the application directly.
  const child = childProcess.spawn(
    executable,
    [path.join(payload, 'bin', 'ltc.cjs')].concat(args),
    {
      cwd: process.cwd(),
      env: privateNodeEnv(),
      stdio: 'inherit',
      windowsHide: false,
    },
  );
  const handlers = {};
  for (const signal of ['SIGINT', 'SIGTERM']) {
    handlers[signal] = function () {
      child.kill(signal);
    };
    process.on(signal, handlers[signal]);
  }
  function cleanup() {
    for (const signal of Object.keys(handlers)) process.removeListener(signal, handlers[signal]);
  }
  child.on('error', function (error) {
    cleanup();
    process.stderr.write('Lattice 启动失败：' + error.message + '\n');
    process.exitCode = 1;
  });
  child.on('exit', function (code, signal) {
    cleanup();
    if (signal && process.platform !== 'win32') process.kill(process.pid, signal);
    else process.exitCode = code === null ? 1 : code;
  });
  return child;
}

module.exports = { launch, resolvePayload, manifestAt, privateNodeEnv };
