import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  updateTask,
  archiveTask,
  deleteTask,
  addCheckpoint,
  createTask,
  type CheckpointType,
  type TaskStatus,
} from '@qcqx/lattice-core';

const VALID_TASK_STATUSES: TaskStatus[] = ['planning', 'in_progress', 'completed', 'archived'];
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
      if (!VALID_TASK_STATUSES.includes(status as TaskStatus)) {
        return { error: 'bad_request', message: `无效的状态: ${status}` };
      }
      await updateTask(username, req.params.id, { status: status as TaskStatus });
      return { success: true };
    },
  );

  app.post<{ Params: { id: string } }>('/api/tasks/:id/archive', async (req) => {
    const username = await getUsername();
    await archiveTask(username, req.params.id);
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/delete', async (req) => {
    const username = await getUsername();
    await deleteTask(username, req.params.id);
    return { success: true };
  });

  app.post<{
    Params: { id: string };
    Body: { type: string; title: string; message: string };
  }>('/api/tasks/:id/checkpoint', async (req) => {
    const username = await getUsername();
    const cpType = req.body.type;
    if (!VALID_CHECKPOINT_TYPES.includes(cpType as CheckpointType)) {
      return { error: 'bad_request', message: `无效的检查点类型: ${cpType}` };
    }
    await addCheckpoint(username, req.params.id, {
      type: cpType as CheckpointType,
      title: req.body.title,
      message: req.body.message,
    });
    return { success: true };
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
      return { success: true, task };
    },
  );
}
