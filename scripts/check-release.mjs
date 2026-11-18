import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const tests = resolve(import.meta.dirname, '__tests__');
const files = readdirSync(tests)
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => resolve(tests, name));
if (!files.length) throw new Error('No release tests found');

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
