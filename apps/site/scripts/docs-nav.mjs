/**
 * Documentation navigation — the single source of truth for:
 * - which repo docs become site pages (and their URL slugs),
 * - sidebar grouping, order and bilingual labels.
 *
 * Keep `docs/**` free of frontmatter and navigation metadata: GitHub renders YAML as a table,
 * so structure lives here and `sync-docs.mjs` injects it into the generated site copy.
 */

export const repositoryUrl = 'https://github.com/qxchuckle/lattice';
export const defaultBranch = 'master';

export const navGroups = [
  {
    label: 'Getting started',
    translations: { 'zh-CN': '开始使用' },
    items: [
      {
        source: 'docs/README.md',
        slug: 'docs',
        label: 'Overview',
        translations: { 'zh-CN': '概览' },
      },
      {
        source: 'docs/quick-start.md',
        slug: 'docs/quick-start',
        label: 'Quick start',
        translations: { 'zh-CN': '快速开始' },
      },
      {
        source: 'docs/concepts.md',
        slug: 'docs/concepts',
        label: 'Core concepts',
        translations: { 'zh-CN': '核心概念' },
      },
      {
        source: 'docs/web-workbench.md',
        slug: 'docs/web-workbench',
        label: 'Web workbench',
        translations: { 'zh-CN': 'Web 工作台' },
      },
    ],
  },
  {
    label: 'Reference',
    translations: { 'zh-CN': '参考' },
    items: [
      {
        source: 'docs/architecture.md',
        slug: 'docs/architecture',
        label: 'Architecture',
        translations: { 'zh-CN': '架构' },
      },
      {
        source: 'docs/directory-and-config.md',
        slug: 'docs/directory-and-config',
        label: 'Directory & config',
        translations: { 'zh-CN': '目录与配置' },
      },
      {
        source: 'docs/spec-template-registry.md',
        slug: 'docs/spec-template-registry',
        label: 'Spec template registry',
        translations: { 'zh-CN': '规范模板仓库' },
      },
    ],
  },
  {
    label: 'Source',
    translations: { 'zh-CN': '源码' },
    links: [{ label: 'GitHub', link: repositoryUrl }],
  },
];

/** Flat list of doc pages, in sidebar order. */
export const docItems = navGroups.flatMap((group) => group.items ?? []);

/** `docs/foo.md` → `docs/foo.zh-CN.md` (the repo translation convention). */
export function translationSource(source) {
  return source.replace(/\.md$/, '.zh-CN.md');
}

/** Locale key used by Starlight: root locale has no directory prefix. */
export function contentDir(locale) {
  return locale === 'root' ? 'docs' : `${locale}/docs`;
}

/** Site route segments (below the base path) for a doc page in a locale. */
export function routeSegments(item, locale) {
  const suffix = item.slug === 'docs' ? [] : [item.slug.slice('docs/'.length)];
  return locale === 'root' ? ['docs', ...suffix] : [locale, 'docs', ...suffix];
}

/** Relative generated file path (from `src/content/docs`). */
export function outputPath(item, locale) {
  const dir = contentDir(locale);
  if (item.slug === 'docs') return `${dir}/index.md`;
  return `${dir}/${item.slug.slice('docs/'.length)}.md`;
}

export function findItemBySource(source) {
  return docItems.find((item) => item.source === source);
}
