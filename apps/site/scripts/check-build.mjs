import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { docItems, routeSegments } from './docs-nav.mjs';
import { verifySync } from './sync-docs.mjs';

const dist = resolve(import.meta.dirname, '../dist');
const failures = [];
const siteUrl = process.env.SITE_URL ?? 'https://qxchuckle.github.io';
const base = process.env.SITE_BASE ?? '/lattice';
const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
const siteRoot = new URL(baseWithSlash, siteUrl).href;
const sitemapUrl = new URL('sitemap-index.xml', siteRoot).href;
const ogUrl = new URL('og.png', siteRoot).href;
const origin = new URL(siteRoot).origin;

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (entry.name.endsWith('.html')) output.push(path);
  }
  return output;
}

function pageUrl(file) {
  const path = relative(dist, file).replaceAll('\\', '/');
  if (path === 'index.html') return baseWithSlash;
  if (path.endsWith('/index.html')) return `${baseWithSlash}${path.slice(0, -'index.html'.length)}`;
  return `${baseWithSlash}${path}`;
}

function targetPath(url, source) {
  const parsed = new URL(url, `${origin}${source}`);
  if (parsed.origin !== origin) return null;
  if (!parsed.pathname.startsWith(baseWithSlash)) return null;

  const pathname = decodeURIComponent(parsed.pathname.slice(baseWithSlash.length));
  const candidates =
    pathname === '' || pathname.endsWith('/')
      ? [resolve(dist, pathname, 'index.html')]
      : [
          resolve(dist, pathname),
          resolve(dist, `${pathname}.html`),
          resolve(dist, pathname, 'index.html'),
        ];
  return candidates;
}

async function exists(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

const htmlFiles = await walk(dist);
const pages = new Map();
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const ids = new Set();
  for (const match of html.matchAll(/\sid=(?:"([^"]*)"|'([^']*)')/g)) {
    const id = match[1] ?? match[2];
    if (id) ids.add(id.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'"));
  }
  pages.set(file, { html, ids });
}

for (const [file, page] of pages) {
  if (relative(dist, file) === '404.html') continue;
  const source = pageUrl(file);
  for (const match of page.html.matchAll(/href=(?:"([^"]+)"|'([^']+)')/g)) {
    const href = match[1] ?? match[2];
    if (!href || /^(?:mailto:|tel:|javascript:)/.test(href)) continue;
    const parsed = new URL(href, `${origin}${source}`);
    if (parsed.origin !== origin) continue;
    if (!parsed.pathname.startsWith(baseWithSlash)) continue;
    const candidates = targetPath(href, source);
    if (!candidates) continue;
    const target = (
      await Promise.all(
        candidates.map(async (candidate) => ((await exists(candidate)) ? candidate : null)),
      )
    ).find(Boolean);
    if (!target) {
      failures.push(`broken link ${href} in ${relative(dist, file)}`);
      continue;
    }
    const fragment = parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : '';
    if (!fragment) continue;
    const targetPage = pages.get(target);
    if (targetPage && !targetPage.ids.has(fragment)) {
      failures.push(`broken anchor ${href} in ${relative(dist, file)}`);
    }
  }
}

const sync = verifySync();
for (const error of sync.errors) failures.push(error);

for (const item of docItems) {
  for (const locale of ['root', 'zh-cn']) {
    const segments = routeSegments(item, locale);
    const file = join(dist, ...segments, 'index.html');
    if (!(await exists(file))) {
      failures.push(`missing docs page /${segments.join('/')}/`);
    }
  }
}

async function text(path) {
  try {
    return await readFile(resolve(dist, path), 'utf8');
  } catch {
    failures.push(`missing ${path}`);
    return '';
  }
}

const home = await text('index.html');
const zhHome = await text('zh-cn/index.html');
const demo = await text('demo/index.html');
const robots = await text('robots.txt');
const sitemap = await text('sitemap-index.xml');

if (!home.includes('ll-workflow')) failures.push('home is missing the workflow demo');
if (!zhHome.includes('ll-workflow')) failures.push('zh home is missing the workflow demo');
if (!home.includes(ogUrl)) {
  failures.push('home is missing the OG image');
}
if (!demo.includes('demo-root')) failures.push('demo page is missing its React mount');
if (!demo.includes('demo-boot.js')) failures.push('demo page is missing its boot script');
if (demo.includes('<iframe')) failures.push('demo page still embeds an iframe');
if (home.includes('Content-Security-Policy')) {
  failures.push('CSP must be scoped to the demo page');
}
if (!demo.includes("connect-src 'none'")) failures.push('demo CSP is missing connect-src none');
if (!demo.includes("script-src 'self' 'unsafe-inline'")) {
  failures.push('demo CSP is missing inline script support');
}
if (!demo.includes("style-src 'self' 'unsafe-inline'")) {
  failures.push('demo CSP is missing runtime style support');
}
if (!demo.includes("frame-src 'none'")) failures.push('demo CSP is missing frame-src none');
if (!robots.includes(`Sitemap: ${sitemapUrl}`)) {
  failures.push('robots.txt has the wrong sitemap URL');
}
if (!sitemap) failures.push('sitemap was not generated');
if (/https?:\/\/(?:localhost|127\.0\.0\.1)/.test(home + zhHome + demo)) {
  failures.push('a local development URL leaked into the production build');
}

if (failures.length) {
  console.error(`Site build check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Site build check passed.');
