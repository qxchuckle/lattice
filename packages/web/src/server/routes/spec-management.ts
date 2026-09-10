import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import {
  getUsername,
  writeSpec,
  parseSpec,
  getGlobalSpecDir,
  getUserSpecDir,
  getGlobalSpecs,
  getUserSpecs,
  lintSpecs,
  detectSpecConflicts,
  listSpecTemplates,
  applySpecTemplate,
  updateRagIndex,
} from '@qcqx/lattice-core';
import { resolveFilePath } from './shared';

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
      return { error: 'bad_request', message: '路径不允许包含 ..' };
    }
    let dir: string;
    if (scope === 'global') {
      dir = getGlobalSpecDir();
    } else if (scope === 'user') {
      dir = getUserSpecDir(username);
    } else {
      return { error: 'bad_request', message: '项目级 Spec 请在项目目录中创建' };
    }
    const filePath = join(dir, relativePath);
    const tagList = tags ? tags.split(',').map((s: string) => s.trim()) : [];
    await writeSpec(filePath, { title, description, tags: tagList }, `# ${title}\n\n`);
    return { success: true };
  });

  app.post<{
    Params: { id: string };
    Body: { title?: string; description?: string; tags?: string };
  }>('/api/specs/:id/frontmatter', async (req) => {
    const username = await getUsername();
    // 复用 shared.resolveFilePath：按 specId（fileName / frontmatter.id / relativePath）跨 global/user/全部项目解析
    const filePath = await resolveFilePath('spec', req.params.id, username);
    if (!filePath) return { error: 'not_found', message: 'Spec 未找到' };
    const spec = await parseSpec(filePath);
    // 坏 frontmatter 拒绝写回：writeSpec 会重建 frontmatter，原内容将丢失（spec-io-yaml-conventions）
    if (!spec || spec.parseError) {
      return { error: 'parse_error', message: 'Spec frontmatter 解析失败，请先修复语法错误' };
    }
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
    return { success: true };
  });

  app.post('/api/specs/lint', async () => {
    const username = await getUsername();
    const [globalSpecs, userSpecs] = await Promise.all([getGlobalSpecs(), getUserSpecs(username)]);
    return lintSpecs([...globalSpecs, ...userSpecs]);
  });

  app.post('/api/specs/conflicts', async () => {
    const username = await getUsername();
    return await detectSpecConflicts(username, '');
  });

  // ── Spec 模板 ──

  app.get('/api/spec-templates', async () => {
    return await listSpecTemplates();
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
        return { success: true, filePath };
      }
      return { error: 'not_found', message: `模板 ${req.body.name} 未找到` };
    },
  );
}
