import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import {
  getUsername,
  writeSpec,
  getGlobalSpecDir,
  getUserSpecDir,
  findSpecByName,
  getGlobalSpecs,
  getUserSpecs,
  lintSpecs,
  detectSpecConflicts,
  listSpecTemplates,
  applySpecTemplate,
  updateRagIndex,
} from '@qcqx/lattice-core';
import { ok, fail } from './shared';

export async function registerSpecManagementRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      relativePath: string;
      scope: string;
      title: string;
      description: string;
      tags?: string;
    };
  }>('/api/specs/init', async (req) => {
    const username = await getUsername();
    const { relativePath, scope, title, description, tags } = req.body;
    if (relativePath.includes('..')) {
      return fail('bad_request', '路径不允许包含 ..');
    }
    let dir: string;
    if (scope === 'global') {
      dir = getGlobalSpecDir();
    } else if (scope === 'user') {
      dir = getUserSpecDir(username);
    } else {
      return fail('bad_request', '项目级 Spec 请在项目目录中创建');
    }
    const filePath = join(dir, relativePath);
    const tagList = tags ? tags.split(',').map((s: string) => s.trim()) : [];
    await writeSpec(filePath, { title, description, tags: tagList }, `# ${title}\n\n`);
    return ok();
  });

  app.post<{
    Params: { id: string };
    Body: { title?: string; description?: string; tags?: string };
  }>('/api/specs/:id/frontmatter', async (req) => {
    const username = await getUsername();
    const matches = await findSpecByName(username, null, req.params.id);
    if (matches.length === 0) return fail('not_found', 'Spec 未找到');
    const spec = matches[0].spec;
    const tagList = req.body.tags ? req.body.tags.split(',').map((s: string) => s.trim()) : [];
    await writeSpec(
      spec.filePath,
      {
        title: req.body.title ?? spec.frontmatter.title,
        description: req.body.description ?? spec.frontmatter.description,
        tags: tagList.length > 0 ? tagList : spec.frontmatter.tags,
      },
      spec.content,
    );
    try {
      await updateRagIndex();
    } catch {
      // ignore
    }
    return ok();
  });

  app.post('/api/specs/lint', async () => {
    const username = await getUsername();
    const [globalSpecs, userSpecs] = await Promise.all([getGlobalSpecs(), getUserSpecs(username)]);
    return ok(await lintSpecs([...globalSpecs, ...userSpecs]));
  });

  app.post('/api/specs/conflicts', async () => {
    const username = await getUsername();
    return ok(await detectSpecConflicts(username, ''));
  });

  // ── Spec 模板 ──

  app.get('/api/spec-templates', async () => {
    return ok(await listSpecTemplates());
  });

  app.post<{ Body: { name: string; projectId?: string } }>(
    '/api/spec-templates/apply',
    async (req) => {
      const username = await getUsername();
      const filePath = await applySpecTemplate(username, req.body.projectId ?? '', req.body.name);
      if (filePath) {
        try {
          await updateRagIndex();
        } catch {
          // ignore
        }
        return ok({ filePath });
      }
      return fail('not_found', `模板 ${req.body.name} 未找到`);
    },
  );
}
