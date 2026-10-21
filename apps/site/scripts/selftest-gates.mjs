#!/usr/bin/env node
/**
 * Gate self-test: inject one violation per error code, assert the exact failure, restore, and
 * re-run the gate green. A gate that has never failed is not evidence.
 *
 * Usage: node apps/site/scripts/selftest-gates.mjs
 * Requires a built `apps/site/dist` for the two anchor cases (run `pnpm build:site` first).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docItems } from './docs-nav.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const siteRoot = resolve(scriptDir, '..');
const syncScript = resolve(scriptDir, 'sync-docs.mjs');
const buildScript = resolve(scriptDir, 'check-build.mjs');
const generated = resolve(siteRoot, 'src/content/docs/docs');
const dist = resolve(siteRoot, 'dist');

const results = [];
let failures = 0;

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function ok(name, detail = '') {
  results.push(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  failures += 1;
  results.push(`✖ ${name} — ${detail}`);
}

/** Run a gate with an injected violation, assert the code, then restore and assert green. */
function expectGate(name, script, args, expectedCode, inject) {
  let restore;
  try {
    restore = inject();
  } catch (error) {
    fail(name, `injection failed: ${error.message}`);
    return;
  }
  try {
    const failing = run(script, args);
    if (failing.status === 0) {
      fail(name, 'gate stayed green after injection');
      return;
    }
    if (!failing.output.includes(expectedCode)) {
      const tail = failing.output.trim().split('\n').slice(-2).join(' | ');
      fail(name, `expected ${expectedCode}, got: ${tail}`);
      return;
    }
  } finally {
    restore();
  }
  const healthy = run(script, args);
  if (healthy.status !== 0) {
    const tail = healthy.output.trim().split('\n').slice(-2).join(' | ');
    fail(name, `gate did not recover after restore: ${tail}`);
    return;
  }
  ok(name, expectedCode);
}

/** Overwrite a file and return a restore callback. */
function temporaryWrite(path, transform) {
  const original = readFileSync(path, 'utf8');
  writeFileSync(path, transform(original));
  return () => writeFileSync(path, original);
}

/** Rename a file away and return a restore callback. */
function temporaryRename(path) {
  const backup = `${path}.selftest-bak`;
  renameSync(path, backup);
  return () => {
    if (existsSync(backup)) renameSync(backup, path);
  };
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (/\.(?:md|html)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function findMarker(paths) {
  const hits = [];
  for (const root of paths) {
    for (const file of walkFiles(root)) {
      if (readFileSync(file, 'utf8').includes('selftest')) hits.push(file);
    }
  }
  return hits;
}

console.log('Gate self-test: docs sync + anchor links\n');

// Baseline: the gate is green before any injection.
{
  const baseline = run(syncScript, ['--check']);
  if (baseline.status !== 0) {
    console.error(baseline.output);
    process.exit(1);
  }
  ok('baseline', 'docs sync is green');
}

// Parser self-check: nav entries must equal the number of English docs, and output paths unique.
{
  const englishDocs = readdirSync(resolve(repoRoot, 'docs')).filter(
    (name) => name.endsWith('.md') && !name.endsWith('.zh-CN.md'),
  );
  const outputs = new Set(docItems.flatMap((item) => [`root:${item.slug}`, `zh:${item.slug}`]));
  if (docItems.length !== englishDocs.length || outputs.size !== docItems.length * 2) {
    fail(
      'parser counts',
      `${docItems.length} nav / ${englishDocs.length} docs / ${outputs.size} outputs`,
    );
  } else {
    ok(
      'parser counts',
      `${docItems.length} nav = ${englishDocs.length} docs, ${outputs.size} outputs`,
    );
  }
}

expectGate('E1 missing nav source', syncScript, ['--check'], 'docs-sync:E1', () =>
  temporaryRename(resolve(repoRoot, 'docs/spec-template-registry.md')),
);

const unregistered = resolve(repoRoot, 'docs/selftest-unregistered.md');
expectGate('E2 unregistered doc', syncScript, ['--check'], 'docs-sync:E2', () => {
  writeFileSync(unregistered, '# Selftest\n\nTemporary page.\n');
  return () => rmSync(unregistered, { force: true });
});

expectGate('E3 missing translation', syncScript, ['--check'], 'docs-sync:E3', () =>
  temporaryRename(resolve(repoRoot, 'docs/concepts.zh-CN.md')),
);

const orphan = resolve(generated, 'selftest-orphan.md');
expectGate('E4 orphan generated page', syncScript, ['--check'], 'docs-sync:E4', () => {
  writeFileSync(orphan, '# Orphan\n');
  return () => rmSync(orphan, { force: true });
});

expectGate('E5 stale generated page', syncScript, ['--check'], 'docs-sync:E5', () =>
  temporaryWrite(resolve(generated, 'quick-start.md'), (text) => `${text}\n<!-- selftest -->\n`),
);

expectGate('E6 missing H1', syncScript, ['--check'], 'docs-sync:E6', () =>
  temporaryWrite(resolve(repoRoot, 'docs/quick-start.md'), (text) =>
    text.replace(/^# Quick Start\n/, ''),
  ),
);

if (!existsSync(dist)) {
  fail('anchor gates', 'apps/site/dist is missing; run pnpm build:site first');
} else {
  expectGate('anchor: same page', buildScript, [], 'broken anchor', () =>
    temporaryWrite(resolve(dist, 'docs/quick-start/index.html'), (html) =>
      html.replace('href="#1-install"', 'href="#selftest-missing"'),
    ),
  );

  expectGate('anchor: cross page', buildScript, [], 'broken anchor', () =>
    temporaryWrite(resolve(dist, 'docs/quick-start/index.html'), (html) =>
      html.replace('href="../architecture/"', 'href="../architecture/#selftest-missing"'),
    ),
  );
}

// Injection markers must not survive anywhere they were written.
{
  const hits = findMarker([resolve(repoRoot, 'docs'), generated, dist]);
  if (hits.length) fail('marker residue', hits.join(', '));
  else ok('marker residue', '0');
}

console.log(results.join('\n'));
console.log(
  `\n${failures === 0 ? '✔' : '✖'} gate self-test ${failures === 0 ? 'passed' : `failed (${failures})`}`,
);
process.exitCode = failures === 0 ? 0 : 1;
