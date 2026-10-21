import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { navGroups } from './scripts/docs-nav.mjs';

const site = process.env.SITE_URL ?? 'https://qxchuckle.github.io';
const base = process.env.SITE_BASE ?? '/lattice';
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const basePath = base.endsWith('/') ? base.slice(0, -1) : base;

/** Sidebar structure is derived from docs-nav.mjs so new docs cannot silently miss the site. */
const sidebar = navGroups.map((group) => ({
  label: group.label,
  translations: group.translations,
  items: group.items
    ? group.items.map((item) => ({
        label: item.label,
        translations: item.translations,
        slug: item.slug,
      }))
    : group.links.map((link) => ({ label: link.label, link: link.link })),
}));

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [
    react(),
    starlight({
      title: 'Lattice',
      description:
        'A local-first engineering memory and workflow layer for AI-assisted development.',
      logo: {
        src: './src/assets/lattice-logo.png',
        alt: 'Lattice',
      },
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      sidebar,
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/qxchuckle/lattice',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'script',
          attrs: { src: `${basePath}/lang-detect.js` },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: `${site}${basePath}/og.png` },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:width', content: '1280' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:height', content: '640' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: `${site}${basePath}/og.png` },
        },
      ],
      // We ship our own src/pages/404.astro (branded, bilingual, no Starlight chrome).
      disable404Route: true,
      components: {
        Head: './src/components/overrides/Head.astro',
        Hero: './src/components/overrides/Hero.astro',
        Footer: './src/components/overrides/Footer.astro',
        TableOfContents: './src/components/overrides/TableOfContents.astro',
        ThemeSelect: './src/components/overrides/ThemeSelect.astro',
        LanguageSelect: './src/components/overrides/LanguageSelect.astro',
      },
      pagefind: true,
      credits: false,
    }),
  ],
  vite: {
    resolve: {
      alias: {
        '@qcqx/lattice-core': fileURLToPath(
          new URL('../../packages/core/src/browser.ts', import.meta.url),
        ),
        '@qcqx/lattice-web-ui': fileURLToPath(
          new URL('../../packages/web-ui/src/ui.ts', import.meta.url),
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      fs: {
        allow: [repoRoot],
      },
    },
    css: {
      preprocessorOptions: {
        less: {
          javascriptEnabled: true,
        },
      },
    },
    build: {
      modulePreload: {
        polyfill: false,
      },
    },
  },
});
