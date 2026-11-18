import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDocuments, replaceInstallBlock } from './install-content.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
export function syncInstallDocs({ check = false, repo = root } = {}) {
  const stale = [];
  for (const file of installDocuments) {
    const path = resolve(repo, file);
    const text = readFileSync(path, 'utf8');
    const expected = replaceInstallBlock(text, file.includes('zh-CN') ? 'zh' : 'en');
    if (text === expected) continue;
    if (check) stale.push(file);
    else writeFileSync(path, expected);
  }
  if (stale.length)
    throw new Error(
      '[install:I8] Stale installation blocks: ' + stale.join(', ') + '; run pnpm sync:install',
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    syncInstallDocs({ check: process.argv.includes('--check') });
    console.log('Installation documentation is synchronized');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
