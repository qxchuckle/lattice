import { afterAll, afterEach, beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let temporary: string;
let payload: string;
let entry: string;
let executable: string;
let manifest: Record<string, unknown>;
let env: NodeJS.ProcessEnv;
const version = '1.29.0';
function writeManifest(value = manifest) {
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify(value));
}
function run(args: string[], options: object = {}) {
  return spawnSync(process.execPath, [entry, ...args], {
    env,
    cwd: temporary,
    encoding: 'utf8',
    input: '',
    timeout: 10000,
    ...options,
  });
}
beforeAll(() => {
  temporary = realpathSync(mkdtempSync(join(tmpdir(), 'lattice-launcher-')));
  payload = join(temporary, "moved app's directory");
  for (const directory of ['bin', 'scripts', 'runtime', 'app/dist'])
    mkdirSync(join(payload, directory), { recursive: true });
  for (const file of ['bin/ltc.cjs', 'scripts/runtime.cjs'])
    copyFileSync(join(cliRoot, file), join(payload, file));
  executable = join(payload, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  copyFileSync(process.execPath, executable);
  writeFileSync(join(payload, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(payload, 'app/package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(
    join(payload, 'app/dist/index.js'),
    `
    import fs from 'node:fs';
    if(process.env.BUSINESS_STARTED) fs.writeFileSync(process.env.BUSINESS_STARTED,'started');
    if(process.argv.includes('--version')) console.log('${version}');
    else if(process.argv.includes('--hold')) { process.on('SIGTERM',()=>process.exit(23)); console.log('ready'); setInterval(()=>{},1000); }
    else { console.log(JSON.stringify({node:process.version,pid:process.pid,ppid:process.ppid,cwd:process.cwd(),args:process.argv.slice(2),stdin:fs.readFileSync(0,'utf8')})); process.exitCode=Number(process.env.CHILD_EXIT||0); }
  `,
  );
  manifest = {
    format: 2,
    version,
    platform: process.platform,
    arch: process.arch,
    node: { version: process.version, abi: process.versions.modules },
  };
  writeManifest();
  entry = join(payload, 'bin/ltc.cjs');
  env = {
    ...process.env,
    HOME: temporary,
    USERPROFILE: temporary,
    LATTICE_HOME: join(temporary, 'data'),
  };
});
afterEach(() => writeManifest());
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

test('可搬迁私有运行时保留参数、cwd、stdin和退出码', () => {
  const result = run(['a space', '--json', "apostrophe'", '--literal=$value'], {
    input: 'stdin payload',
    env: { ...env, CHILD_EXIT: '7' },
  });
  assert.equal(result.status, 7, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.deepEqual(
    { ...actual, pid: undefined, ppid: undefined },
    {
      node: process.version,
      cwd: temporary,
      args: ['a space', '--json', "apostrophe'", '--literal=$value'],
      stdin: 'stdin payload',
      pid: undefined,
      ppid: undefined,
    },
  );
});
test('私有Node直接加载业务，不派生第二个Node', () => {
  const result = spawnSync(executable, [entry], {
    env,
    cwd: temporary,
    input: '',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ppid, process.pid);
});
test('项目 Node 启动参数和模块搜索目录不会传给私有运行时', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      'process.env.NODE_OPTIONS="--invalid-lattice-test-option";process.env.Node_Path=process.cwd();require(process.argv[1]).launch(process.argv[2],["--version"])',
      join(payload, 'scripts/runtime.cjs'),
      payload,
    ],
    { env, cwd: temporary, encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), version);
});
test('缺失、格式、版本、ABI和架构错误均在业务导入前失败', () => {
  const marker = join(temporary, 'business-started');
  for (const record of [
    null,
    { ...manifest, format: 99 },
    { ...manifest, version: '0.0.0' },
    { ...manifest, arch: 'wrong' },
    { ...manifest, node: { version: process.version, abi: 'wrong' } },
    { ...manifest, node: null },
  ]) {
    if (record === null) rmSync(join(payload, 'manifest.json'));
    else writeManifest(record);
    const result = run(['status', '--json'], { env: { ...env, BUSINESS_STARTED: marker } });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Lattice 启动失败/);
    assert.equal(existsSync(marker), false);
  }
});
test('缺失运行时明确失败，不回退宿主业务依赖', () => {
  const parked = executable + '.parked';
  require('fs').renameSync(executable, parked);
  try {
    const result = run(['--version']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  } finally {
    require('fs').renameSync(parked, executable);
  }
});
test('调用者架构不同时，按实际私有运行时验证', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      'Object.defineProperty(process,"arch",{value:"different-caller-arch"});require(process.argv[1]).launch(process.argv[2],["--version"])',
      join(payload, 'scripts/runtime.cjs'),
      payload,
    ],
    { env, cwd: temporary, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), version);
});
test('npm入口平台缺失与入口/平台版本混用会拒绝启动', () => {
  const bootstrap = join(temporary, 'bootstrap');
  mkdirSync(bootstrap, { recursive: true });
  const pkg = { name: '@qcqx/lattice-cli', version };
  writeFileSync(join(bootstrap, 'package.json'), JSON.stringify(pkg));
  writeFileSync(
    join(bootstrap, 'platforms.json'),
    JSON.stringify([
      { os: process.platform, arch: process.arch, packageName: '@fixture/platform' },
    ]),
  );
  const runtime = require(join(payload, 'scripts/runtime.cjs'));
  assert.throws(() => runtime.resolvePayload(bootstrap), /optionalDependencies/);
  const platform = join(bootstrap, 'node_modules/@fixture/platform');
  mkdirSync(platform, { recursive: true });
  writeFileSync(join(platform, 'package.json'), JSON.stringify({ version: '0.0.0' }));
  assert.throws(() => runtime.resolvePayload(bootstrap), /版本不一致/);
});
test.skipIf(process.platform === 'win32')('转发SIGTERM并保留业务退出码', async () => {
  const child = spawn(process.execPath, [entry, '--hold'], {
    env,
    cwd: temporary,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const code = await new Promise<number | null>((resolveCode, reject) => {
      const timer = setTimeout(() => reject(new Error('signal forwarding timeout')), 5000);
      child.on('error', reject);
      child.stdout.once('data', () => child.kill('SIGTERM'));
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolveCode(exitCode);
      });
    });
    assert.equal(code, 23);
  } finally {
    child.kill('SIGKILL');
  }
});
