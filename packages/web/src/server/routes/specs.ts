import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  getGlobalSpecs,
  getUserSpecs,
  getProjectSpecs,
  getAllProjectSpecs,
  unifiedSearch,
} from '@qcqx/lattice-core';

export function registerSpecRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { scope?: string; projectId?: string; username?: string } }>(
    '/api/specs',
    async (req) => {
      const username = req.query.username || (await getUsername());
      const scope = req.query.scope;
      if (scope === 'global') return getGlobalSpecs();
      if (scope === 'user') return getUserSpecs(username);
      if (scope === 'project' && req.query.projectId) {
        return getProjectSpecs(username, req.query.projectId);
      }
      const projectSpecs = req.query.projectId
        ? await getProjectSpecs(username, req.query.projectId)
        : await getAllProjectSpecs(username);
      return {
        global: await getGlobalSpecs(),
        user: await getUserSpecs(username),
        project: projectSpecs,
      };
    },
  );

  // ── 搜索 ──

  app.get<{ Querystring: { q: string; type?: string; projectId?: string; limit?: string } }>(
    '/api/search',
    async (req) => {
      const opts: Record<string, unknown> = {};
      if (req.query.type) opts.type = req.query.type;
      if (req.query.projectId) opts.projectId = req.query.projectId;
      if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
      return unifiedSearch(req.query.q, opts);
    },
  );
}
