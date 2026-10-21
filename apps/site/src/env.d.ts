/// <reference types="astro/client" />

// Starlight ships `.d.astro.ts` type files that the bundler module resolution of
// this project cannot follow; the runtime exports are fine, so declare them here.
declare module '@astrojs/starlight/components/*.astro' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  const component: AstroComponentFactory;
  export default component;
}

declare module 'virtual:starlight/user-config' {
  interface StarlightLocaleConfig {
    label: string;
    lang?: string;
  }

  const config: {
    isMultilingual: boolean;
    locales?: Record<string, StarlightLocaleConfig>;
    defaultLocale?: {
      locale?: string;
    };
  };

  export default config;
}
