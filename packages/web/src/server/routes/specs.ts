import type { FastifyInstance } from 'fastify';
import { createComposite } from '@qcqx/lattice-core';
import * as lattice from '@qcqx/lattice-services';

/**
 * Spec / 搜索路由 = @qcqx/lattice-services 的 HTTP 绑定。
 * 域 spec 并入属 web 宿主特有能力，保留在本层。
 */
export function registerSpecRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { scope?: string; projectId?: string; username?: string } }>(
    '/api/specs',
    async (req) => {
      const username = req.query.username || (await lattice.currentUsername());
      const scope = req.query.scope;
      const projectId = req.query.projectId;

      const toSpecs = (entries: Awaited<ReturnType<typeof lattice.listSpecs>>) =>
        entries.map((entry) => entry.spec);

      if (scope === 'global')
        return toSpecs(await lattice.listSpecs(username, { scope: 'global' }));
      if (scope === 'user') return toSpecs(await lattice.listSpecs(username, { scope: 'user' }));
      if (scope === 'project' && projectId) {
        return toSpecs(await lattice.listSpecs(username, { scope: 'project', projectId }));
      }

      const entries = await lattice.listSpecs(
        username,
        projectId ? { scope: 'project', projectId } : {},
      );
      const result: Record<string, unknown> = {
        global: entries.filter((e) => e.scope === 'global').map((e) => e.spec),
        user: entries.filter((e) => e.scope === 'user').map((e) => e.spec),
        project: entries.filter((e) => e.scope === 'project').map((e) => e.spec),
      };

      // 域 spec 并入（详情面板按 specId 查找 + 标题映射；domain 字段标注来源，scope 归位）
      try {
        const composite = await createComposite(username);
        const view = await composite.knowledgeView();
        const domainSpecs = view.specs.filter((v) => v.source !== 'local');
        if (domainSpecs.length > 0) {
          for (const v of domainSpecs) {
            const mapped = {
              frontmatter: v.spec.frontmatter,
              content: v.spec.content,
              filePath: v.spec.filePath,
              fileName: v.spec.fileName,
              relativePath: v.spec.relativePath,
              domain: v.source,
            };
            const bucket =
              v.scope === 'global' ? 'global' : v.scope === 'project' ? 'project' : 'user';
            (result[bucket] as unknown[]).push(mapped);
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
      const username = await lattice.currentUsername();
      return lattice.search(username, req.query.q, {
        types: req.query.type ? [req.query.type] : undefined,
        projectId: req.query.projectId,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      });
    },
  );
}
