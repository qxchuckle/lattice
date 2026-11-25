import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function platformScope(paths) {
  const siteOnly = (file) => /^(?:apps\/site\/|docs\/|README(?:\.[\w-]+)?\.md$)/.test(file);
  if (paths.length && paths.every(siteOnly)) return 'none';
  const applicationCode = (file) =>
    /^packages\/(?:cli|core|protocol|services|web|web-ui|vscode)\/(?:src|tests)\//.test(file) &&
    /\.(?:[cm]?[jt]sx?|astro|css|json|md)$/.test(file);
  return paths.length && paths.every((file) => siteOnly(file) || applicationCode(file))
    ? 'linux-x64'
    : 'full';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2);
  let scope = 'full';
  if (/^[a-f0-9]{40}$/.test(base) && /^[a-f0-9]{40}$/.test(head)) {
    try {
      const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      scope = platformScope(files.split('\0').filter(Boolean));
    } catch {
      // An unavailable base must keep full platform coverage.
    }
  }
  console.log(scope);
}
