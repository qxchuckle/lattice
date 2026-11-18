const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');
const { read, write, run } = require('./build.cjs');
const { hostTarget } = require('./config.cjs');
const { fixture, seed, payloadCore } = require('./smoke.cjs');

function percentile(values, p) {
  return values.slice().sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
  ];
}
function benchmark(options = {}) {
  const output = path.resolve(options.output || 'dist-cli');
  const target = hostTarget();
  const payload = path.join(output, 'work', target.id, 'package/payload');
  const node = path.join(payload, 'runtime', target.os === 'win32' ? 'node.exe' : 'node');
  const entry = path.join(payload, 'bin/ltc.cjs');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-runtime-benchmark-'));
  const runs = Number(options.runs || 20);
  if (!Number.isInteger(runs) || runs < 3 || runs > 100)
    throw new Error('Use 3..100 benchmark runs');
  try {
    const { home, env } = fixture(temporary);
    seed(node, payloadCore(payload), env, temporary);
    const observer = path.join(temporary, 'resource.cjs');
    const resources = path.join(temporary, 'resources.jsonl');
    fs.writeFileSync(
      observer,
      'process.on("exit",()=>require("fs").appendFileSync(process.env.LTC_BENCH_RESOURCES,JSON.stringify({pid:process.pid,executable:process.execPath,rssKiB:process.resourceUsage().maxRSS})+"\\n"));',
    );
    const measuredEnv = {
      ...env,
      NODE_OPTIONS: '--require=' + observer,
      LTC_BENCH_RESOURCES: resources,
    };
    const legacy = path.join(temporary, 'legacy-three-process.cjs');
    fs.writeFileSync(
      legacy,
      'const c=require("child_process");const probe=c.spawnSync(process.execPath,["-e","process.stdout.write(process.version)"],{encoding:"utf8"});if(probe.status!==0)process.exit(1);const r=c.spawnSync(process.execPath,' +
        JSON.stringify([entry]) +
        '.concat(process.argv.slice(2)),{stdio:"inherit",env:process.env});process.exitCode=r.status;',
    );
    const measurements = [];
    function measure(name, executable, args, extraEnv = {}) {
      // One warm-up, then separate process launches. Disk/OS cache is intentionally warm.
      run(executable, args, { env: { ...measuredEnv, ...extraEnv }, cwd: temporary });
      const ms = [],
        rss = [];
      for (let i = 0; i < runs; i++) {
        fs.writeFileSync(resources, '');
        const start = performance.now();
        run(executable, args, { env: { ...measuredEnv, ...extraEnv }, cwd: temporary });
        ms.push(performance.now() - start);
        rss.push(
          Math.max(
            ...fs
              .readFileSync(resources, 'utf8')
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line))
              .filter((record) => fs.realpathSync(record.executable) === fs.realpathSync(node))
              .map((record) => record.rssKiB),
          ),
        );
      }
      measurements.push({
        name,
        runs,
        p50Ms: percentile(ms, 0.5),
        p95Ms: percentile(ms, 0.95),
        maxProcessRssKiB: Math.max(...rss),
        samplesMs: ms,
      });
    }
    measure('previous-style-three-process-version', node, [legacy, '--version']);
    measure('managed-one-process-version', node, [entry, '--version']);
    measure('npm-caller-single-handoff-version', options.callerNode || process.execPath, [
      entry,
      '--version',
    ]);
    measure('managed-search-offline-fixture', node, [entry, 'search', 'compatibility', '--json']);
    measure('managed-rag-update-unchanged', node, [entry, 'rag', 'update', '--json']);
    if (options.modelPath) {
      write(path.join(home, 'config/config.json'), {
        rag: {
          embedding: {
            allowRemoteModels: false,
            localModelPath: path.resolve(options.modelPath),
            cacheDir: path.join(temporary, 'models'),
          },
        },
      });
      measure(
        'managed-search-cold-model-process',
        node,
        [entry, 'search', 'compatibility', '--json'],
        { LATTICE_DISABLE_SEMANTIC: '0' },
      );
    }
    const profiles = path.join(output, 'profiles');
    fs.mkdirSync(profiles, { recursive: true });
    run(
      node,
      [
        '--cpu-prof',
        '--cpu-prof-dir=' + profiles,
        '--cpu-prof-name=search.cpuprofile',
        entry,
        'search',
        'compatibility',
        '--json',
      ],
      { env, cwd: temporary },
    );
    const profile = read(path.join(profiles, 'search.cpuprofile'));
    const counts = new Map();
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    for (const id of profile.samples || []) {
      const f = nodes.get(id).callFrame;
      const name = f.functionName || f.url || '(anonymous)';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const total = (profile.samples || []).length;
    const topSamples = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, samples]) => ({ name, samples, share: samples / total }));
    const result = {
      target: target.id,
      runtime: read(path.join(payload, 'manifest.json')).node.version,
      fixture: 'one spec; unchanged 512-dimensional vectors; isolated offline HOME',
      methodology:
        'Warm filesystem cache; separate CLI processes; previous-style adds one Node version probe and one wrapper on the same runtime/app. RSS is the maximum private-Node process peak, not aggregate process-tree memory; caller RSS is excluded (older Node14 on macOS reports resourceUsage in different units).',
      measurements,
      profile: { filename: 'profiles/search.cpuprofile', totalSamples: total, topSamples },
      rust: {
        introduced: false,
        reason:
          'No measured independent JS kernel plus Rust boundary prototype meeting the 30% / 3x / 20% p95 gate. Native SQLite/ORT remain native.',
      },
    };
    write(path.join(output, 'benchmark.json'), result);
    return result;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
module.exports = { benchmark, percentile };
