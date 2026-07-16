import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  writeText,
  updateRagIndex,
  listVirtualProjectMetas,
  listTasks,
  listRelations,
  getGlobalStatus,
  openLatticeRoot,
  openWithEditor,
  type OpenMode,
  type EditorApp,
} from '@qcqx/lattice-core';
import { resolveFilePath } from './shared';

export function registerContentRoutes(app: FastifyInstance): void {
  app.post<{ Body: { type: string; entityId: string; content: string } }>('/api/content/save', async (req) => {
    const username = await getUsername();
    const { type, entityId, content } = req.body;
    const path = await resolveFilePath(type, entityId, username);
    if (!path) return { error: 'not_found', message: '文件不存在' };
    await writeText(path, content);
    try {
      await updateRagIndex();
    } catch {
      // rag update 失败不影响保存结果
    }
    return { success: true };
  });
}

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get('/api/stats', async () => {
    const username = await getUsername();
    const projects = await listVirtualProjectMetas(username);
    const tasks = await listTasks(username);
    const relations = await listRelations(username);
    const activeTasks = tasks.filter((t) => t.status === 'in_progress');
    return {
      projectCount: projects.length,
      taskCount: tasks.length,
      activeTaskCount: activeTasks.length,
      relationCount: relations.length,
    };
  });

  // ── 全局状态（含 latticeRoot）──

  app.get('/api/global-status', async () => {
    // DB 已在 createServer() 时初始化，无需在此重复 init/close
    const status = await getGlobalStatus();
    if (!status) return { error: 'not_initialized', message: 'Lattice 未初始化' };
    return status;
  });

  // ── 打开 LatticeRoot ──

  app.post<{ Body: { mode?: string } }>('/api/open-lattice-root', async (req) => {
    const mode = (req.body?.mode ?? 'finder') as OpenMode;
    const result = await openLatticeRoot(mode);
    if (result.success) {
      return { success: true, message: result.message };
    }
    return { error: 'open_failed', message: result.message };
  });

  // ── 用编辑器打开路径 ──

  app.post<{ Body: { type: string; entityId: string; app: string } }>('/api/open-with-editor', async (req) => {
    const username = await getUsername();
    const { type, entityId, app } = req.body;
    const path = await resolveFilePath(type, entityId, username);
    if (!path) return { error: 'not_found', message: '文件不存在' };
    const result = await openWithEditor(path, app as EditorApp);
    if (result.success) {
      return { success: true, message: result.message };
    }
    return { error: 'exec_failed', message: result.message };
  });
}
