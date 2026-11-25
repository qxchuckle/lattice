// Node14-safe runner: all build/test orchestration runs under the fixed build interpreter.
const childProcess = require('child_process');
const path = require('path');
const node = process.env.LATTICE_TEST_INSTALL_NODE;
if (!node) throw new Error('Set LATTICE_TEST_INSTALL_NODE to the fixed build Node');
const args = [
  path.join(__dirname, 'cli-distribution.cjs'),
  'smoke-legacy',
  '--caller-node',
  process.execPath,
];
if (process.env.LATTICE_TEST_NPM) args.push('--npm', process.env.LATTICE_TEST_NPM);
const result = childProcess.spawnSync(node, args, { env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
