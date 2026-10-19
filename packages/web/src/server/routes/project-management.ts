import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  updateProjectMeta,
  unregisterProject,
  upsertRelationFile,
  deleteRelationFile,
  mergeProjects,
} from '@qcqx/lattice-core';
import * as lattice from '@qcqx/lattice-services';

export function registerProjectManagementRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      tags?: string[];
      /** 整组替换（分组完整路径数组；缺失路径自动创建） */
      groupPaths?: string[];
      /** 增量添加（路径数组；缺失自动创建） */
      addGroups?: string[];
      /** 移除（路径或 grp- id） */
      removeGroups?: string[];
    };
  }>('/api/projects/:id/update', async (req) => {
    const username = await getUsername();
    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.tags !== undefined) updates.tags = req.body.tags;
    if (Object.keys(updates).length > 0) {
      await updateProjectMeta(username, req.params.id, updates);
    }
    const groupOptions: { set?: string[]; add?: string[]; remove?: string[] } = {};
    if (req.body.groupPaths !== undefined) groupOptions.set = req.body.groupPaths;
    if (req.body.addGroups !== undefined) groupOptions.add = req.body.addGroups;
    if (req.body.removeGroups !== undefined) groupOptions.remove = req.body.removeGroups;
    let createdPaths: string[] = [];
    let unknownRemovals: string[] = [];
    if (groupOptions.set || groupOptions.add || groupOptions.remove) {
      const result = await lattice.setProjectGroups(username, req.params.id, groupOptions);
      if (result.error) return { success: false, error: result.error };
      createdPaths = result.createdPaths;
      unknownRemovals = result.unknownRemovals;
    }
    return { success: true, createdPaths, unknownRemovals };
  });

  // ── 项目分组注册表 ──

  app.get('/api/project-groups', async () => {
    const username = await getUsername();
    return lattice.getProjectGroupTree(username);
  });

  app.get<{ Querystring: { ref?: string } }>('/api/project-groups/impact', async (req) => {
    const username = await getUsername();
    const ref = req.query.ref ?? '';
    return lattice.previewProjectGroupImpact(username, ref);
  });

  app.post<{ Body: { parentRef?: string | null; name?: string } }>(
    '/api/project-groups/create',
    async (req) => {
      const username = await getUsername();
      const result = await lattice.createProjectGroup(
        username,
        req.body.parentRef ?? null,
        req.body.name ?? '',
      );
      if (result.error) return { success: false, error: result.error };
      return { success: true, path: result.path, node: result.node };
    },
  );

  app.post<{ Body: { ref?: string; newName?: string } }>(
    '/api/project-groups/rename',
    async (req) => {
      const username = await getUsername();
      const result = await lattice.renameProjectGroup(
        username,
        req.body.ref ?? '',
        req.body.newName ?? '',
      );
      if (result.error) return { success: false, error: result.error };
      return {
        success: true,
        path: result.path,
        affectedProjects: result.affectedProjectIds?.length ?? 0,
      };
    },
  );

  app.post<{ Body: { ref?: string; newParentRef?: string | null } }>(
    '/api/project-groups/move',
    async (req) => {
      const username = await getUsername();
      const result = await lattice.moveProjectGroup(
        username,
        req.body.ref ?? '',
        req.body.newParentRef ?? null,
      );
      if (result.error) return { success: false, error: result.error };
      return {
        success: true,
        path: result.path,
        affectedProjects: result.affectedProjectIds?.length ?? 0,
      };
    },
  );

  app.post<{ Body: { ref?: string } }>('/api/project-groups/remove', async (req) => {
    const username = await getUsername();
    const result = await lattice.removeProjectGroup(username, req.body.ref ?? '');
    if (result.error) return { success: false, error: result.error };
    return {
      success: true,
      removedCount: result.removedCount ?? 0,
      affectedProjects: result.affectedProjectIds?.length ?? 0,
    };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/remove', async (req) => {
    const username = await getUsername();
    await unregisterProject(username, req.params.id);
    return { success: true };
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
    return { success: true, id: saved.id };
  });

  app.delete<{ Params: { id: string; rid: string } }>(
    '/api/projects/:id/relations/:rid',
    async (req) => {
      const username = await getUsername();
      await deleteRelationFile(username, req.params.rid);
      return { success: true };
    },
  );

  // ── 项目合并 ──

  app.post<{ Body: { fromId: string; toId: string } }>('/api/projects/merge', async (req) => {
    const result = await mergeProjects(req.body.fromId, req.body.toId);
    return result;
  });
}
