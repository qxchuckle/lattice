import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  getGlobalSpecs,
  getUserSpecs,
  getProjectSpecs,
  getAllProjectSpecs,
  unifiedSearch,
  createComposite,
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
      const result: Record<string, unknown> = {
        global: await getGlobalSpecs(),
        user: await getUserSpecs(username),
        project: projectSpecs,
      };
      // 域 spec 并入（详情面板按 specId 查找 + 标题映射；domain 字段标注来源，scope 归位）
      try {
        const composite = await createComposite(username);
        const view = await composite.knowledgeView();
        const domainSpecs = view.specs.filter((v) => v.source !== 'local');
        if (domainSpecs.length > 0) {
          const mapped = domainSpecs.map((v) => ({
            frontmatter: v.spec.frontmatter,
            content: v.spec.content,
            filePath: v.spec.filePath,
            fileName: v.spec.fileName,
            relativePath: v.spec.relativePath,
            domain: v.source,
          }));
          for (const m of mapped) {
            const view2 = domainSpecs.find(
              (v) => v.spec.filePath === m.filePath && v.source === m.domain,
            );
            const scope = view2?.scope ?? 'user';
            const bucket = scope === 'global' ? 'global' : scope === 'project' ? 'project' : 'user';
            (result[bucket] as unknown[]).push(m);
          }
        }
      } catch {
        // 域数据不可用时仅返回本地（G1 降级）
      }
      return result;
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
