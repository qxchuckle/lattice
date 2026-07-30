import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  updateProjectMeta,
  unregisterProject,
  upsertRelationFile,
  deleteRelationFile,
  mergeProjects,
} from '@qcqx/lattice-core';
import { ok } from './shared';

export function registerProjectManagementRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { id: string };
    Body: { name?: string; description?: string; groups?: string[]; tags?: string[] };
  }>('/api/projects/:id/update', async (req) => {
    const username = await getUsername();
    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.groups !== undefined) updates.groups = req.body.groups;
    if (req.body.tags !== undefined) updates.tags = req.body.tags;
    await updateProjectMeta(username, req.params.id, updates);
    return ok();
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/remove', async (req) => {
    const username = await getUsername();
    await unregisterProject(username, req.params.id);
    return ok();
  });

  app.post<{
    Params: { id: string };
    Body: { projectB: string; type: string; description?: string };
  }>('/api/projects/:id/relations', async (req) => {
    const username = await getUsername();
    const saved = await upsertRelationFile(username, {
      projectA: req.params.id,
      projectB: req.body.projectB,
      type: req.body.type,
      description: req.body.description,
      createdBy: 'manual',
    });
    return ok({ id: saved.id });
  });

  app.delete<{ Params: { id: string; rid: string } }>(
    '/api/projects/:id/relations/:rid',
    async (req) => {
      const username = await getUsername();
      await deleteRelationFile(username, req.params.rid);
      return ok();
    },
  );

  // ── 项目合并 ──

  app.post<{ Body: { fromId: string; toId: string } }>('/api/projects/merge', async (req) => {
    return ok(await mergeProjects(req.body.fromId, req.body.toId));
  });
}
