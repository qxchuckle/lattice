import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  getTaskMeta,
  updateTask,
  archiveTask,
  deleteTask,
  addCheckpoint,
  createTask,
  isValidTaskStatus,
  canTransitionTaskStatus,
  type CheckpointType,
} from '@qcqx/lattice-core';
import { ok, fail } from './shared';

const VALID_CHECKPOINT_TYPES: CheckpointType[] = [
  'context',
  'correction',
  'constraint',
  'assumption',
  'followup',
  'note',
  'decision',
  'pivot',
  'milestone',
  'issue',
  'summary',
];

export function registerTaskManagementRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string }; Body: { status: string } }>(
    '/api/tasks/:id/status',
    async (req) => {
      const username = await getUsername();
      const status = req.body.status;
      if (!isValidTaskStatus(status)) {
        return fail('bad_request', `无效的状态: ${status}`);
      }
      // 转换合法性由 core 状态机判定；任务不存在时交给 updateTask 按原逻辑处理
      const meta = await getTaskMeta(username, req.params.id);
      if (meta && !canTransitionTaskStatus(meta.status, status)) {
        return fail('bad_request', `无效的状态转换: ${meta.status} -> ${status}`);
      }
      await updateTask(username, req.params.id, { status });
      return ok();
    },
  );

  app.post<{ Params: { id: string } }>('/api/tasks/:id/archive', async (req) => {
    const username = await getUsername();
    await archiveTask(username, req.params.id);
    return ok();
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/delete', async (req) => {
    const username = await getUsername();
    await deleteTask(username, req.params.id);
    return ok();
  });

  app.post<{
    Params: { id: string };
    Body: { type: string; title: string; message: string };
  }>('/api/tasks/:id/checkpoint', async (req) => {
    const username = await getUsername();
    const cpType = req.body.type;
    if (!VALID_CHECKPOINT_TYPES.includes(cpType as CheckpointType)) {
      return fail('bad_request', `无效的检查点类型: ${cpType}`);
    }
    await addCheckpoint(username, req.params.id, {
      type: cpType as CheckpointType,
      title: req.body.title,
      message: req.body.message,
    });
    return ok();
  });

  // ── 任务创建 ──

  app.post<{ Body: { title: string; projectIds?: string[]; parentTaskId?: string } }>(
    '/api/tasks/create',
    async (req) => {
      const username = await getUsername();
      const task = await createTask(username, req.body.title, {
        projects: req.body.projectIds,
        parentTaskId: req.body.parentTaskId,
      });
      return ok(task);
    },
  );
}
