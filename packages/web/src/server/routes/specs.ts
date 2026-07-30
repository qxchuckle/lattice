import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  getGlobalSpecs,
  getUserSpecs,
  getProjectSpecs,
  getAllProjectSpecs,
  unifiedSearch,
} from '@qcqx/lattice-core';
import { ok } from './shared';

export function registerSpecRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { scope?: string; projectId?: string; username?: string } }>(
    '/api/specs',
    async (req) => {
      const username = req.query.username || (await getUsername());
      const scope = req.query.scope;
      if (scope === 'global') return ok(await getGlobalSpecs());
      if (scope === 'user') return ok(await getUserSpecs(username));
      if (scope === 'project' && req.query.projectId) {
        return ok(await getProjectSpecs(username, req.query.projectId));
      }
      const projectSpecs = req.query.projectId
        ? await getProjectSpecs(username, req.query.projectId)
        : await getAllProjectSpecs(username);
      return ok({
        global: await getGlobalSpecs(),
        user: await getUserSpecs(username),
        project: projectSpecs,
      });
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
      return ok(await unifiedSearch(req.query.q, opts));
    },
  );
}
