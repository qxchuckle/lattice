/**
 * The site can be built for a sub-path (`/lattice`) or for a custom-domain root (`/`).
 * Tests run against the same production build, so every URL goes through this helper.
 */
const rawBase = process.env.SITE_BASE ?? '/lattice';
export const basePath = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;

export function siteUrl(path: string) {
  return `${basePath}${path}`;
}
