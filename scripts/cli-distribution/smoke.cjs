const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawn } = require('child_process');
const { createServer } = require('net');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('timers/promises');
const { pathToFileURL } = require('url');
const { hostTarget } = require('./config.cjs');
const { read, write, run, inventory } = require('./build.cjs');
const { pack } = require('./archive.cjs');
const { verify } = require('./verify.cjs');

function extract(archive, destination) {
  // GNU tar interprets a Windows drive letter in -f as a remote host.
  const input = fs.openSync(archive, 'r');
  try {
    run('tar', ['-xzf', '-'], { cwd: destination, stdio: [input, 'pipe', 'pipe'] });
  } finally {
    fs.closeSync(input);
  }
}

function fixture(temporary) {
  const home = path.join(temporary, 'data');
  const env = {
    ...process.env,
    HOME: temporary,
    USERPROFILE: temporary,
    LATTICE_HOME: home,
    LATTICE_DISABLE_SEMANTIC: '1',
    CI: '1',
  };
  fs.mkdirSync(path.join(home, 'config'), { recursive: true });
  fs.mkdirSync(path.join(home, 'spec'), { recursive: true });
  write(path.join(home, 'config/config-local.json'), { username: 'runtime-test' });
  write(path.join(home, 'config/config.json'), {
    rag: { embedding: { allowRemoteModels: false } },
  });
  fs.writeFileSync(
    path.join(home, 'spec/runtime.md'),
    '---\nid: spec-runtime\ntitle: Runtime compatibility\n---\n\n# Runtime compatibility\n\nA stable runtime preserves the search index.\n',
  );
  return { home, env };
}
async function smokeWeb(executable, args, temporary) {
  const { home, env } = fixture(temporary);
  const listener = createServer();
  const port = await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const port = listener.address().port;
      listener.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
  const child = spawn(executable, [...args, 'web', '--no-open', '--port', String(port)], {
    cwd: temporary,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => (output += data));
  const done = new Promise((resolve) => {
    child.on('error', (error) => {
      output += error.message;
      resolve();
    });
    child.once('exit', resolve);
  });
  const url = 'http://127.0.0.1:' + port;
  async function get(route) {
    const response = await fetch(url + route, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200, route);
    return response;
  }
  const pidFile = path.join(home, '.cache', 'web-server.json');
  try {
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      await Promise.race([done, delay(100)]);
    }
    assert.ok(fs.existsSync(pidFile), 'Bundled Web did not start: ' + output);
    const index = await (await get('/')).text();
    const asset = index.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    assert.ok(asset, 'Bundled Web must serve its generated client HTML');
    assert.match((await get(asset)).headers.get('content-type') || '', /javascript/);
    const stats = await (await get('/api/stats')).json();
    assert.equal(typeof stats.projectCount, 'number');
    assert.equal(typeof stats.taskCount, 'number');
    const terminal = await (await get('/api/terminal/mode')).json();
    assert.match(terminal.mode, /^(pty|spawn)$/);
    return true;
  } finally {
    if (process.platform === 'win32' && fs.existsSync(pidFile)) {
      const { pid } = read(pidFile);
      if (pid !== child.pid) {
        try {
          process.kill(pid);
        } catch (error) {
          if (error.code !== 'ESRCH') console.warn('Could not stop temporary Web server:', error);
        }
      }
    }
    child.kill('SIGTERM');
    await Promise.race([done, delay(3000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await done;
    }
  }
}
function sourceCore(repo) {
  return pathToFileURL(path.join(repo, 'packages/core/dist/index.mjs')).href;
}
function payloadCore(payload) {
  return pathToFileURL(path.join(payload, 'app/node_modules/@qcqx/lattice-core/dist/index.mjs'))
    .href;
}
function seed(node, core, env, cwd) {
  run(
    node,
    [
      '--input-type=module',
      '-e',
      'import * as c from ' +
        JSON.stringify(core) +
        ';await c.initDb();await c.updateRagIndex();for(const r of c.getDb().prepare("SELECT id FROM embeddings").all())c.upsertVecEmbedding(r.id,new Float32Array(512).fill(0.01));c.getDb().exec("UPDATE embeddings SET vector_indexed=1;CREATE TABLE runtime_marker(value TEXT);INSERT INTO runtime_marker VALUES (42)");c.closeDb();',
    ],
    { env, cwd },
  );
}
function lifecycle(caller, entry, temporary) {
  fs.mkdirSync(temporary);
  const { home, env } = fixture(temporary);
  function cli(args, cwd = temporary) {
    return run(caller, [entry, ...args], { env, cwd });
  }
  cli(['init', '-f', '--username', 'runtime-test', '--git', 'false', '--no-download-model']);
  assert.ok(
    fs.readdirSync(path.join(home, 'templates/spec')).length > 0,
    'bundled templates must survive pruning',
  );
  JSON.parse(cli(['status', '--global', '--json']));
  const workspace = path.join(temporary, 'project');
  fs.mkdirSync(workspace);
  write(path.join(workspace, 'lattice.json'), { id: 'abcd1234abcd1234' });
  write(path.join(workspace, 'package.json'), { name: 'platform-lifecycle', version: '1.0.0' });
  cli(['project', 'register', workspace, '--json']);
  const task = cli(
    ['task', 'create', 'Platform lifecycle task', '--current', '-q'],
    workspace,
  ).trim();
  assert.match(task, /^\d{4}-\d{2}-\d{2}-/);
  cli(['task', 'start', task, '--json']);
  cli([
    'task',
    'checkpoint',
    task,
    '--type',
    'note',
    '--title',
    'Installed application',
    '-m',
    'Native distribution workflow',
    '--json',
  ]);
  cli([
    'spec',
    'init',
    'lifecycle.md',
    '--scope',
    'global',
    '--title',
    'Platform lifecycle',
    '--json',
  ]);
  assert.match(
    cli(['spec', 'show', 'lifecycle', '--scope', 'global', '--json']),
    /Platform lifecycle/,
  );
  cli(['rag', 'update', '--json']);
  const search = JSON.parse(cli(['search', 'Platform lifecycle', '--json']));
  assert.ok(search.rows.length > 0, 'installed workflow must be searchable');
  cli(['task', 'complete', task, '--json']);
  cli(['task', 'delete', task, '--json']);
  JSON.parse(cli(['trash', 'list', '--json']));
  cli(['doctor', '--json']);
  return true;
}

function modelFlow(caller, entry, baselineNode, repo, temporary, modelPath) {
  fs.mkdirSync(temporary);
  const { home, env } = fixture(temporary);
  fs.rmSync(path.join(home, 'spec/runtime.md'));
  const texts = [
    '数据库版本和原生模块ABI必须保持一致。',
    '项目切换Node版本时使用独立运行时。',
    'The model computes semantic embeddings for document search.',
  ];
  texts.forEach((text, i) =>
    fs.writeFileSync(
      path.join(home, 'spec', 'doc-' + i + '.md'),
      '---\nid: spec-model-flow-' +
        i +
        '\ntitle: Runtime document ' +
        i +
        '\n---\n\n# Runtime document ' +
        i +
        '\n\n' +
        text +
        '\n',
    ),
  );
  write(path.join(home, 'config/config.json'), {
    rag: {
      embedding: {
        allowRemoteModels: false,
        allowLocalModels: true,
        localModelPath: modelPath,
        cacheDir: path.join(temporary, 'models'),
        modelId: 'Xenova/bge-small-zh-v1.5',
        dimension: 512,
        dtype: 'q8',
        pooling: 'mean',
      },
    },
  });
  const modelEnv = { ...env, LATTICE_DISABLE_SEMANTIC: '0' };
  function cli(node, executable, args) {
    return run(node, [executable, ...args], { env: modelEnv, cwd: temporary });
  }
  cli(caller, entry, ['rag', 'update', '--json']);
  assert.match(cli(caller, entry, ['rag', 'update', '--json']), /跳过 3/);
  const queries = ['数据库版本', 'independent runtime', 'semantic embeddings'];
  const results = queries.map((query) => {
    const args = ['search', query, '--json'];
    const actual = JSON.parse(cli(caller, entry, args));
    const original = JSON.parse(
      cli(baselineNode, path.join(repo, 'packages/cli/dist/index.js'), args),
    );
    assert.deepStrictEqual(actual, original, 'real semantic search output changed');
    return { query, results: actual.rows.length };
  });
  const status = JSON.parse(cli(caller, entry, ['rag', 'status', '--json']));
  const payload = path.dirname(path.dirname(entry));
  const vectorCounts = JSON.parse(
    run(
      path.join(payload, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
      [
        '--input-type=module',
        '-e',
        'import * as c from ' +
          JSON.stringify(payloadCore(payload)) +
          ';await c.initDb();console.log(JSON.stringify({indexed:c.getDb().prepare("SELECT COUNT(*) AS n FROM embeddings WHERE vector_indexed=1").get().n,vectors:c.getDb().prepare("SELECT COUNT(*) AS n FROM vec_embeddings").get().n}));c.closeDb();',
      ],
      { env: modelEnv, cwd: temporary },
    ),
  );
  assert.strictEqual(Number(vectorCounts.indexed), 3);
  assert.strictEqual(Number(vectorCounts.vectors), 3);
  assert.strictEqual(status.totalEmbeddings, 3);
  assert.strictEqual(status.vectorStoreReady, true);
  assert.strictEqual(status.modelChanged, false);
  assert.ok(results.some((r) => r.results > 0));
  return {
    realEmbeddingCount: Number(vectorCounts.vectors),
    vectorDimension: status.vectorDimension,
    modelChanged: status.modelChanged,
    unchangedUpdateSkipped: true,
    sourceSemanticSearchEqual: true,
    normalProcessExit: true,
    parentTerminationUsed: false,
    results,
  };
}

function installNpmFixture({ output, target, record, temporary, caller, npm, env }) {
  // Use actual tarballs (npm6 treats directory deps as links). No unpublished registry access.
  const fixtureDir = path.join(temporary, 'bootstrap');
  fs.mkdirSync(fixtureDir);
  extract(path.join(output, 'qcqx-lattice-cli-' + record.version + '.tgz'), fixtureDir);
  const pkgPath = path.join(fixtureDir, 'package/package.json');
  const pkg = read(pkgPath);
  assert.strictEqual(pkg.scripts, undefined);
  assert.strictEqual(pkg.dependencies, undefined);
  pkg.optionalDependencies = {
    [target.packageName]: 'file:' + path.join(output, record.npmFile),
  };
  write(pkgPath, pkg);
  const localTar = path.join(temporary, 'bootstrap.tgz');
  pack(fixtureDir, 'package', localTar);
  const prefix = path.join(temporary, 'npm-global');
  const installArgs = [
    npm,
    'install',
    '--global',
    '--prefix',
    prefix,
    '--cache',
    path.join(temporary, 'npm-cache'),
    '--offline',
    '--ignore-scripts',
    '--engine-strict',
    '--no-audit',
    '--no-fund',
    localTar,
  ];
  run(caller, installArgs, { env, cwd: temporary });
  const installed = path.join(
    prefix,
    target.os === 'win32' ? 'node_modules' : 'lib/node_modules',
    '@qcqx/lattice-cli/bin/ltc.cjs',
  );
  const shimEnv = { ...env, PATH: path.dirname(caller) + path.delimiter + env.PATH };
  const shimVersion =
    target.os === 'win32'
      ? run('cmd.exe', ['/d', '/c', path.join(prefix, 'ltc.cmd'), '--version'], {
          env: shimEnv,
          cwd: temporary,
        })
      : run(path.join(prefix, 'bin/ltc'), ['--version'], { env: shimEnv, cwd: temporary });
  assert.strictEqual(shimVersion.trim(), record.version);
  assert.strictEqual(
    run(caller, [installed, '--version'], { env, cwd: temporary }).trim(),
    record.version,
  );
  return { installed, installArgs, prefix, pkg };
}

function legacySmoke(options = {}) {
  const target = hostTarget();
  const output = path.resolve(options.output || 'dist-cli');
  const record = read(path.join(output, target.id + '.json'));
  const caller = options.callerNode || process.execPath;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-legacy-smoke-'));
  try {
    const { env } = fixture(temporary);
    if (options.npm) {
      installNpmFixture({ output, target, record, temporary, caller, npm: options.npm, env });
    } else {
      extract(path.join(output, record.archive), temporary);
      const entry = path.join(temporary, 'payload/bin/ltc.cjs');
      assert.strictEqual(
        run(caller, [entry, '--version'], { env, cwd: temporary }).trim(),
        record.version,
      );
    }
    return {
      target: target.id,
      caller: run(caller, ['--version']).trim(),
      npmInstalled: !!options.npm,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function smoke(options = {}) {
  const repo = path.resolve(__dirname, '../..');
  const output = path.resolve(options.output || 'dist-cli');
  const target = hostTarget();
  const record = read(path.join(output, target.id + '.json'));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-distribution-smoke-'));
  const caller = options.callerNode || process.execPath;
  const baselineNode = options.node || process.env.LATTICE_TEST_INSTALL_NODE || process.execPath;
  const timingsMs = {};
  let last = performance.now();
  function recordTiming(phase) {
    const now = performance.now();
    const milliseconds = Math.round(now - last);
    timingsMs[phase] = milliseconds;
    process.stderr.write(`[smoke] ${phase}: ${milliseconds} ms\n`);
    last = now;
  }
  try {
    const { home, env } = fixture(temporary);
    // Extract and MOVE the physical payload, with no reference to the build directory/store.
    extract(path.join(output, record.archive), temporary);
    const payload = path.join(temporary, "moved payload's path");
    fs.renameSync(path.join(temporary, 'payload'), payload);
    const manifest = verify(payload);
    assert.strictEqual(
      inventory(payload).some((f) =>
        /onnxruntime-web|transformers\.web|runtime\/.*npm/.test(f.path),
      ),
      false,
    );
    const node = path.join(payload, 'runtime', target.os === 'win32' ? 'node.exe' : 'node');
    const entry = path.join(payload, 'bin/ltc.cjs');
    // The private interpreter must never resolve through the caller's PATH.
    let noNodePath;
    if (target.os !== 'win32') {
      noNodePath = path.join(temporary, 'utilities');
      fs.mkdirSync(noNodePath);
      for (const utility of ['dirname', 'readlink']) {
        const executable = run('/bin/sh', ['-c', 'command -v ' + utility]).trim();
        fs.symlinkSync(executable, path.join(noNodePath, utility));
      }
      assert.strictEqual(
        run(path.join(payload, 'bin/ltc'), ['--version'], {
          env: { ...env, PATH: noNodePath, NODE_OPTIONS: '--invalid-lattice-test-option' },
          cwd: temporary,
        }).trim(),
        record.version,
      );
    }
    recordTiming('relocationAndIntegrity');
    const lifecycleVerified = lifecycle(
      caller,
      entry,
      path.join(temporary, 'standalone-lifecycle'),
    );
    recordTiming('standaloneLifecycle');
    seed(baselineNode, sourceCore(repo), env, temporary);
    const baseline = JSON.parse(
      run(
        baselineNode,
        [path.join(repo, 'packages/cli/dist/index.js'), 'search', 'compatibility', '--json'],
        { env, cwd: temporary },
      ),
    );
    const search = JSON.parse(
      run(caller, [entry, 'search', 'compatibility', '--json'], { env, cwd: temporary }),
    );
    assert.deepStrictEqual(search, baseline);
    const update = run(caller, [entry, 'rag', 'update', '--json'], { env, cwd: temporary });
    assert.match(update, /跳过 1/);
    assert.doesNotMatch(update, /已自动全量重建/);
    const marker = run(
      node,
      [
        '--input-type=module',
        '-e',
        'import * as c from ' +
          JSON.stringify(payloadCore(payload)) +
          ';await c.initDb();console.log(JSON.stringify(c.getDb().prepare("SELECT value FROM runtime_marker").get()));c.closeDb();',
      ],
      { env, cwd: temporary },
    );
    assert.deepStrictEqual(JSON.parse(marker), { value: '42' });
    // Reject ABI mismatch before importing the application or touching DB bytes.
    const db = path.join(home, '.cache/lattice.db');
    const before = fs.readFileSync(db);
    write(path.join(payload, 'manifest.json'), {
      ...manifest,
      node: { ...manifest.node, abi: 'wrong' },
    });
    const rejected = require('child_process').spawnSync(
      caller,
      [entry, 'rag', 'status', '--json'],
      { env, cwd: temporary, encoding: 'utf8' },
    );
    assert.strictEqual(rejected.status, 1);
    assert.strictEqual(rejected.stdout, '');
    assert.deepStrictEqual(fs.readFileSync(db), before);
    write(path.join(payload, 'manifest.json'), manifest);
    recordTiming('searchAndIncrementalRag');
    let standalone = null;
    if (target.os !== 'win32') {
      const release = path.join(temporary, 'release');
      fs.mkdirSync(release);
      fs.copyFileSync(path.join(output, record.archive), path.join(release, record.archive));
      fs.writeFileSync(path.join(release, 'release-version.txt'), record.version + '\n');
      fs.writeFileSync(
        path.join(release, 'SHA256SUMS'),
        `${record.archiveSha256}  ${record.archive}\n`,
      );
      const aliases = path.join(temporary, 'standalone-bin');
      run(
        '/bin/sh',
        [
          path.join(__dirname, 'install.sh'),
          '--from',
          release,
          '--prefix',
          path.join(temporary, 'standalone-app'),
          '--bin',
          aliases,
        ],
        { env, cwd: temporary },
      );
      standalone = path.join(aliases, 'ltc');
      assert.strictEqual(
        run(standalone, ['--version'], { env, cwd: temporary }).trim(),
        record.version,
      );
      recordTiming('standaloneInstall');
    }
    const webVerified = await smokeWeb(
      standalone || node,
      target.os === 'win32' ? [entry] : [],
      path.join(temporary, 'standalone-web'),
    );
    recordTiming('standaloneWeb');
    let npmWebVerified = false;
    let npmVerified = false;
    let npmRepairVerified = false;
    if (options.npm) {
      const { installed, installArgs, prefix, pkg } = installNpmFixture({
        output,
        target,
        record,
        temporary,
        caller,
        npm: options.npm,
        env,
      });
      recordTiming('npmInstall');
      assert.deepStrictEqual(
        JSON.parse(
          run(caller, [installed, 'search', 'compatibility', '--json'], { env, cwd: temporary }),
        ),
        baseline,
      );
      lifecycle(caller, installed, path.join(temporary, 'npm-lifecycle'));
      recordTiming('npmLifecycle');
      const npmRoot = path.dirname(path.dirname(installed));
      const npmPayload = require(path.join(npmRoot, 'scripts/runtime.cjs')).resolvePayload(
        npmRoot,
      ).payload;
      assert.ok(
        npmPayload.startsWith(fs.realpathSync(prefix) + path.sep),
        'repair fixture must stay inside its temporary prefix',
      );
      fs.writeFileSync(
        path.join(npmPayload, 'app/node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
        'damaged npm native binding',
      );
      run(
        caller,
        [
          options.npm,
          'uninstall',
          '--global',
          '--prefix',
          prefix,
          '--cache',
          path.join(temporary, 'npm-cache'),
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          pkg.name,
        ],
        { env, cwd: temporary },
      );
      run(caller, installArgs, { env, cwd: temporary });
      const repaired = require(path.join(npmRoot, 'scripts/runtime.cjs')).resolvePayload(
        npmRoot,
      ).payload;
      run(
        path.join(repaired, 'runtime', target.os === 'win32' ? 'node.exe' : 'node'),
        [path.join(repaired, 'scripts/payload.cjs'), record.version],
        { env, cwd: temporary },
      );
      assert.deepStrictEqual(
        JSON.parse(
          run(caller, [installed, 'search', 'compatibility', '--json'], { env, cwd: temporary }),
        ),
        baseline,
      );
      npmRepairVerified = true;
      recordTiming('npmRepair');

      npmWebVerified = await smokeWeb(caller, [installed], path.join(temporary, 'npm-web'));
      recordTiming('npmWeb');
      npmVerified = true;
    }
    let embedding;
    let realModelCli;
    if (options.modelPath) {
      const modelPath = path.resolve(options.modelPath);
      // Keep the real model cache read-only; config/cache/database always live in the fixture.
      const customRoot = path.join(temporary, 'custom-models');
      fs.mkdirSync(customRoot);
      fs.symlinkSync(
        path.join(modelPath, 'Xenova/bge-small-zh-v1.5'),
        path.join(customRoot, 'custom-bge'),
        target.os === 'win32' ? 'junction' : 'dir',
      );
      const texts = [
        '固定 Node 运行时与平台分发',
        'Cross-version CLI compatibility',
        '中文与 emoji 🧪 keep semantics',
      ];
      async function vectors(executable, core, modelId, localModelPath) {
        write(path.join(home, 'config/config.json'), {
          rag: {
            embedding: {
              allowRemoteModels: false,
              allowLocalModels: true,
              modelId,
              localModelPath,
              cacheDir: path.join(temporary, 'model-cache'),
              dimension: 512,
              dtype: 'q8',
              pooling: 'mean',
            },
          },
        });
        // Core does not expose pipeline disposal. End the probe from its parent after a complete
        // vector result, avoiding the documented ORT macOS teardown crash (not a numerical test).
        return new Promise((resolve, reject) => {
          const child = require('child_process').spawn(
            executable,
            [
              '--input-type=module',
              '-e',
              'import * as c from ' +
                JSON.stringify(core) +
                ';const values=await Promise.all(' +
                JSON.stringify(texts) +
                '.map(t=>c.generateEmbedding(t)));if(values.some(v=>!v))throw Error("Embedding failed");console.log(JSON.stringify(values.map(v=>Array.from(v))));setInterval(()=>{},1000);',
            ],
            {
              env: { ...env, LATTICE_DISABLE_SEMANTIC: '0' },
              cwd: temporary,
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          let stdout = '',
            stderr = '',
            values;
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('Embedding probe timed out'));
          }, 120000);
          child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (stdout.includes('\n') && !values) {
              try {
                values = JSON.parse(stdout.trim());
                child.kill('SIGKILL');
              } catch (error) {
                child.kill('SIGKILL');
                reject(error);
              }
            }
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('error', reject);
          child.on('close', () => {
            clearTimeout(timer);
            if (values) resolve(values);
            else reject(new Error('Embedding failed: ' + stderr));
          });
        });
      }
      const original = await vectors(
        baselineNode,
        sourceCore(repo),
        'Xenova/bge-small-zh-v1.5',
        modelPath,
      );
      const trimmed = await vectors(
        node,
        payloadCore(payload),
        'Xenova/bge-small-zh-v1.5',
        modelPath,
      );
      const custom = await vectors(node, payloadCore(payload), 'custom-bge', customRoot);
      let maxDifference = 0;
      for (const result of [trimmed, custom]) {
        assert.strictEqual(result.length, original.length);
        original.forEach((row, i) => {
          assert.strictEqual(result[i].length, row.length);
          row.forEach((v, j) => {
            maxDifference = Math.max(maxDifference, Math.abs(v - result[i][j]));
          });
        });
      }
      assert.ok(maxDifference < 1e-6, 'Embeddings changed: ' + maxDifference);
      realModelCli = modelFlow(
        caller,
        entry,
        baselineNode,
        repo,
        path.join(temporary, 'model-cli-flow'),
        modelPath,
      );
      embedding = {
        model: 'Xenova/bge-small-zh-v1.5',
        customAlias: true,
        dimension: original[0].length,
        maxDifference,
      };
    }
    if (options.modelPath) recordTiming('localModel');
    return {
      target: target.id,
      caller: run(caller, ['--version']).trim(),
      runtime: manifest.node.version,
      relocated: true,
      nodeAbsentFromPath: !!noNodePath,
      searchUnchanged: true,
      ragSkippedUnchanged: true,
      abiFailurePreservedDb: true,
      standaloneInstallerVerified: !!standalone,
      webVerified,
      npmWebVerified,
      npmVerified,
      npmRepairVerified,
      lifecycleVerified,
      embedding,
      realModelCli,
      timingsMs,
    };
  } finally {
    last = performance.now();
    fs.rmSync(temporary, { recursive: true, force: true });
    recordTiming('cleanup');
  }
}
module.exports = { smoke, legacySmoke, fixture, seed, sourceCore, payloadCore };
