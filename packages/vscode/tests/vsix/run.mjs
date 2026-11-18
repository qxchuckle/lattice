import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeDb,
  getEmbeddingByPath,
  getLatticeMeta,
  initDb,
  isVecStoreReady,
  searchVec,
  setLatticeRootOverride,
  upsertEmbedding,
  upsertVecEmbedding,
} from '@qcqx/lattice-core';
import { downloadAndUnzipVSCode, runTests, runVSCodeCommand } from '@vscode/test-electron';

const extensionRoot = fileURLToPath(new URL('../..', import.meta.url));
const manifest = JSON.parse(await readFile(join(extensionRoot, 'package.json'), 'utf8'));
const requestedVersion = process.argv[2] ?? 'stable';
const version =
  requestedVersion === 'minimum' ? manifest.engines.vscode.slice(1) : requestedVersion;
const vsix = join(extensionRoot, 'dist-vsix', `${manifest.name}-${manifest.version}.vsix`);
const testRoot = await mkdtemp(join(await realpath(tmpdir()), 'lattice-vsix-'));
const dataHome = join(testRoot, 'data-home');
const extensionsDir = join(testRoot, 'extensions');
const profileArgs = [
  '--user-data-dir',
  join(testRoot, 'profile'),
  '--extensions-dir',
  extensionsDir,
];
const workspace = join(testRoot, 'workspace');
const harness = join(testRoot, 'test-harness');
const testRunner = join(harness, 'host.cjs');
const specPath = join(dataHome, 'spec', 'vsix-fixture.md');
const embedding = new Float32Array(384);
embedding[0] = 1;

function readIndex() {
  assert.ok(isVecStoreReady(), 'fixture requires an operational sqlite-vec connection');
  return {
    entry: getEmbeddingByPath(specPath),
    vectors: searchVec(embedding, 1),
    modelId: getLatticeMeta('last_model_id'),
  };
}

try {
  await mkdir(workspace);
  await mkdir(harness);
  // Older editors enter test mode only when an extension development path is present.
  // Use a separate harness so the extension under test still loads from the installed VSIX.
  await writeFile(
    join(harness, 'package.json'),
    JSON.stringify({
      name: 'lattice-vsix-test-harness',
      publisher: 'lattice-test',
      version: '0.0.0',
      engines: { vscode: manifest.engines.vscode },
      main: './host.cjs',
    }),
  );
  await copyFile(join(extensionRoot, 'tests/vsix/host.cjs'), testRunner);
  await mkdir(join(dataHome, 'spec'), { recursive: true });
  await mkdir(join(dataHome, 'users', 'fixture'), { recursive: true });
  await mkdir(join(dataHome, 'config'), { recursive: true });
  await writeFile(
    join(dataHome, 'config', 'config-local.json'),
    JSON.stringify({ username: 'fixture' }),
  );
  await writeFile(
    specPath,
    '---\nid: spec-vsix-fixture\ntitle: Installed VSIX fixture\n---\n\n# Installed VSIX fixture\n\n' +
      'This document already has a model-backed index entry. '.repeat(4),
  );
  setLatticeRootOverride(dataHome);
  await initDb();
  upsertEmbedding({
    id: 'existing-vector',
    file_path: specPath,
    content_hash: 'prior-document-version',
    source_type: 'spec',
    title: 'Installed VSIX fixture',
    username: '',
    project_id: '',
    vector_indexed: 1,
  });
  upsertVecEmbedding('existing-vector', embedding);
  const before = readIndex();
  assert.equal(
    before.vectors[0]?.id,
    'existing-vector',
    'seed a real vector before launching VS Code',
  );
  closeDb();

  const download = { version, cachePath: resolve(extensionRoot, '.vscode-test') };
  const vscodeExecutablePath = await downloadAndUnzipVSCode(download);
  const installed = await runVSCodeCommand(['--install-extension', vsix, ...profileArgs], download);
  console.log(installed.stdout.trim());
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: harness,
    extensionTestsPath: testRunner,
    launchArgs: [workspace, ...profileArgs, '--locale=en'],
    extensionTestsEnv: {
      LATTICE_HOME: dataHome,
      LATTICE_VSIX_EXTENSIONS_DIR: extensionsDir,
      LATTICE_VSIX_VERSION: manifest.version,
    },
  });

  await initDb();
  assert.deepEqual(readIndex(), before, 'the installed extension must preserve the shared index');
} finally {
  closeDb();
  setLatticeRootOverride(null);
  await rm(testRoot, { recursive: true, force: true, maxRetries: 5 });
}
