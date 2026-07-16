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
import { isPathSafe } from './shared';

export function registerContentRoutes(app: FastifyInstance): void {
  app.post<{ Body: { path: string; content: string } }>('/api/content/save', async (req) => {
    const { path, content } = req.body;
    if (!(await isPathSafe(path, await getUsername()))) {
      return { error: 'forbidden', message: '路径不在允许范围内' };
    }
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

  app.post<{ Body: { path: string; app: string } }>('/api/open-with-editor', async (req) => {
    const username = await getUsername();
    const { path, app } = req.body;
    if (!(await isPathSafe(path, username))) {
      return { error: 'forbidden', message: '路径不在允许范围内' };
    }
    const result = await openWithEditor(path, app as EditorApp);
    if (result.success) {
      return { success: true, message: result.message };
    }
    return { error: 'exec_failed', message: result.message };
  });
}
