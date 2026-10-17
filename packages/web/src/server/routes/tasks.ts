import type { FastifyInstance } from 'fastify';
import { createComposite, type TaskStatus } from '@qcqx/lattice-core';
import * as lattice from '@qcqx/lattice-services';

/**
 * 任务路由 = @qcqx/lattice-services 的 HTTP 绑定。
 * 域任务回退属 web 宿主特有能力，保留在本层。
 */
export function registerTaskRoutes(app: FastifyInstance): void {
  app.get<{
    Querystring: { status?: string; projectId?: string; allUser?: string; username?: string };
  }>('/api/tasks', async (req) => {
    const currentUsername = req.query.username || (await lattice.currentUsername());
    const status = req.query.status as TaskStatus | undefined;
    const projectId = req.query.projectId;

    if (req.query.allUser === 'true') {
      if (projectId) {
        return lattice.listTasks(currentUsername, { status, projectId, crossUser: true });
      }
      // 无 projectId：聚合所有用户的任务
      const allUsernames = await lattice.listUsers();
      const results = await Promise.all(
        allUsernames.map((u) =>
          lattice
            .listTasks(u, { status })
            .then((tasks) => tasks.map((t) => ({ ...t, sourceUser: u }))),
        ),
      );
      return results.flat();
    }

    return lattice.listTasks(currentUsername, { status, projectId });
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req) => {
    const username = await lattice.currentUsername();
    const task = await lattice.getTask(username, req.params.id);
    if (task) return task;
    // 域任务回退（只读展示：本地 miss 时从统一数据源查域任务元数据）
    try {
      const composite = await createComposite(username);
      const view = await composite.knowledgeView();
      const dt = view.tasks.find((v) => v.task.id === req.params.id && v.source !== 'local');
      if (dt) {
        return { ...dt.task, domain: dt.source, domainLabel: view.labels.get(dt.source) ?? '' };
      }
    } catch {
      // 域数据不可用（G1 降级）
    }
    return { error: 'not_found', message: '任务不存在' };
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/progress', async (req) => {
    const username = await lattice.currentUsername();
    return lattice.listCheckpoints(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/tree', async (req) => {
    const username = await lattice.currentUsername();
    return lattice.getTaskGraph(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/lineage', async (req) => {
    const username = await lattice.currentUsername();
    return lattice.getTaskLineage(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/context', async (req) => {
    const username = await lattice.currentUsername();
    try {
      const ctx = await lattice.getTaskContext(username, req.params.id, { crossUser: false });
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
    const username = query.username || (await lattice.currentUsername());
    return lattice.listRelations(username);
  });

  // ── 活跃任务 Checkpoint（全局图用）──

  app.get('/api/checkpoints/active', async () => {
    const username = await lattice.currentUsername();
    return lattice.listActiveCheckpoints(username);
  });
}
