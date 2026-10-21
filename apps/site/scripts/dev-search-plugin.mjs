/**
 * Vite plugin that serves a Pagefind index during `astro dev`.
 *
 * Pagefind only runs against built HTML, so Starlight disables search in development. We serve a
 * development index generated from the repository docs under the same `/pagefind/` path the
 * production build uses, which means the search UI itself is identical in both modes.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { buildDevSearchIndex, repoRoot, siteRoot } from './dev-search.mjs';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pagefind': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_meta': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

function contentType(path) {
  return CONTENT_TYPES[extname(path)] ?? 'application/octet-stream';
}

export function devSearchPlugin() {
  return {
    name: 'lattice-dev-search',
    apply: 'serve',
    configureServer(server) {
      const base = server.config.base.endsWith('/') ? server.config.base : `${server.config.base}/`;
      const prefix = `${base.replace(/\/$/, '')}/pagefind/`;
      const outputPath = join(server.config.cacheDir, 'pagefind-dev');

      let build = null;
      let queued = false;
      let timer = null;

      const rebuild = () => {
        if (build) {
          queued = true;
          return build;
        }
        build = (async () => {
          do {
            queued = false;
            try {
              const result = await buildDevSearchIndex(outputPath);
              server.config.logger.info(
                `[dev-search] indexed ${result.pages} docs (${base}pagefind/)`,
              );
            } catch (error) {
              server.config.logger.error(`[dev-search] ${error.message}`);
            }
          } while (queued);
          build = null;
        })();
        return build;
      };

      rebuild();

      server.watcher.add([join(repoRoot, 'docs'), join(siteRoot, 'src/content/docs')]);
      server.watcher.on('all', (_event, file) => {
        if (!/\.(?:md|mdx)$/.test(file)) return;
        clearTimeout(timer);
        timer = setTimeout(rebuild, 150);
      });
      server.httpServer?.once('close', () => clearTimeout(timer));

      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith(prefix)) return next();

        const pathname = decodeURIComponent(request.url.split('?')[0].slice(prefix.length));
        const filePath = resolve(outputPath, pathname || 'index.html');
        const outputRoot = resolve(outputPath);

        if (!filePath.startsWith(outputRoot + sep)) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }

        // The first request can arrive before the initial build finishes.
        if (build) await build;
        else if (!existsSync(join(outputPath, 'pagefind.js'))) await rebuild();

        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }

        response.setHeader('Content-Type', contentType(filePath));
        response.setHeader('Cache-Control', 'no-store');
        createReadStream(filePath).pipe(response);
      });
    },
  };
}
