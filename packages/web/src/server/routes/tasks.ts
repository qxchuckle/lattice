import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  listTasks,
  listTasksCrossUser,
  getTaskMeta,
  getTaskGraphViews,
  getTaskLineage,
  listCheckpoints,
  listRelations,
  getSmartContext,
  listAllUsernames,
  type TaskStatus,
} from '@qcqx/lattice-core';

export function registerTaskRoutes(app: FastifyInstance): void {
  app.get<{
    Querystring: { status?: string; projectId?: string; allUser?: string; username?: string };
  }>('/api/tasks', async (req) => {
    const currentUsername = req.query.username || (await getUsername());
    const status = req.query.status as TaskStatus | undefined;
    const projectId = req.query.projectId;

    if (req.query.allUser === 'true') {
      if (projectId) {
        return listTasksCrossUser(currentUsername, projectId, { status });
      }
      // 无 projectId：聚合所有用户的任务
      const allUsernames = await listAllUsernames();
      const results = await Promise.all(
        allUsernames.map((u) =>
          listTasks(u, { status }).then((tasks) => tasks.map((t) => ({ ...t, sourceUser: u }))),
        ),
      );
      return results.flat();
    }

    return listTasks(currentUsername, { status, projectId });
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req) => {
    const username = await getUsername();
    const task = await getTaskMeta(username, req.params.id);
    if (!task) return { error: 'not_found', message: '任务不存在' };
    return task;
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/progress', async (req) => {
    const username = await getUsername();
    return listCheckpoints(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/tree', async (req) => {
    const username = await getUsername();
    return getTaskGraphViews(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/lineage', async (req) => {
    const username = await getUsername();
    return getTaskLineage(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/context', async (req) => {
    const username = await getUsername();
    try {
      const ctx = await getSmartContext(username, req.params.id, { crossUser: false });
      return {
        directSpecs: ctx.directSpecs,
        relatedSpecs: ctx.relatedSpecs,
        semanticSpecs: ctx.semanticSpecs,
      };
    } catch {
      return { directSpecs: [], relatedSpecs: [], semanticSpecs: [] };
    }
  });

  // ── 项目关系 ──

  app.get('/api/relations', async (req) => {
    const query = req.query as { username?: string };
    const username = query.username || (await getUsername());
    return listRelations(username);
  });

  // ── 活跃任务 Checkpoint（全局图用）──

  app.get('/api/checkpoints/active', async () => {
    const username = await getUsername();
    const tasks = await listTasks(username, { status: 'in_progress' });
    const results = await Promise.all(
      tasks.map(async (t) => ({
        taskId: t.id,
        checkpoints: await listCheckpoints(username, t.id),
      })),
    );
    return results;
  });
}
