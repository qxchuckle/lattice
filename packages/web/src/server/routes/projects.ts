import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import {
  getUsername,
  listVirtualProjectMetas,
  getVirtualProjectMeta,
  getProjectGitStatus,
  listTasks,
  listRelations,
  getProjectSpecs,
  getProjectDir,
  getTaskDir,
  getTaskPrdPath,
  getTaskProgressPath,
  getTaskDesignPath,
  getTaskPrd,
  readText,
  openWithEditor,
  type EditorApp,
} from '@qcqx/lattice-core';
import { isPathSafe } from './shared';

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { username?: string } }>('/api/projects', async (req) => {
    const username = req.query.username || (await getUsername());
    return listVirtualProjectMetas(username);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return { error: 'not_found', message: '项目不存在' };
    return meta;
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/git-status', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return { error: 'not_found', message: '项目不存在' };
    return await getProjectGitStatus(meta);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/specs', async (req) => {
    const username = await getUsername();
    return getProjectSpecs(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/tasks', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return [];
    const idSet = new Set(meta.ids);
    const allTasks = await listTasks(username);
    return allTasks.filter((t) => (t.projects || []).some((pid) => idSet.has(pid)));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/relations', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return [];
    const idSet = new Set(meta.ids);
    const allRelations = await listRelations(username);
    return allRelations.filter((r) => idSet.has(r.projectA) || idSet.has(r.projectB));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/local-paths', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return { error: 'not_found', message: '项目不存在' };
    const localPaths = meta.localPaths || [];
    const existingPaths = localPaths.filter((p) => existsSync(p));
    return { paths: existingPaths };
  });

  // ── 路径获取 ──

  app.get<{ Params: { type: string; id: string } }>('/api/paths/:type/:id', async (req) => {
    const username = await getUsername();
    const { type, id } = req.params;
    let path: string | null = null;
    try {
      switch (type) {
        case 'project-dir':
          path = getProjectDir(username, id);
          break;
        case 'task-dir':
          path = getTaskDir(username, id);
          break;
        case 'prd':
          path = getTaskPrdPath(username, id);
          break;
        case 'progress':
          path = getTaskProgressPath(username, id);
          break;
        case 'design':
          path = getTaskDesignPath(username, id);
          break;
        case 'spec':
          // spec 的 id 就是 filePath
          path = id;
          break;
        default:
          return { error: 'bad_request', message: `未知路径类型: ${type}` };
      }
      return { path };
    } catch {
      return { error: 'not_found', message: '路径不存在' };
    }
  });

  // ── 文件内容读取 ──

  app.get<{ Params: { type: string; id: string } }>('/api/content/:type/:id', async (req) => {
    const username = await getUsername();
    const { type, id } = req.params;
    try {
      if (type === 'prd') {
        const content = await getTaskPrd(username, id);
        if (content !== null) return { content };
        return { error: 'not_found', message: 'PRD 文件不存在或为空' };
      }
      let filePath: string | null = null;
      switch (type) {
        case 'design':
          filePath = getTaskDesignPath(username, id);
          break;
        case 'progress':
          filePath = getTaskProgressPath(username, id);
          break;
        case 'spec':
          // spec 的 id 就是 filePath
          filePath = id;
          break;
        default:
          return { error: 'bad_request', message: `未知内容类型: ${type}` };
      }
      if (filePath) {
        const content = await readText(filePath);
        if (content !== null) return { content };
        return { error: 'not_found', message: '文件不存在' };
      }
      return { error: 'not_found', message: '文件不存在' };
    } catch {
      return { error: 'not_found', message: '内容不存在' };
    }
  });

  // ── 打开文件/目录 ──

  app.post<{ Body: { path: string; app: string } }>('/api/open', async (req) => {
    const username = await getUsername();
    const { path, app } = req.body;
    if (!(await isPathSafe(path, username))) {
      return { error: 'forbidden', message: '路径不在允许范围内' };
    }
    const result = await openWithEditor(path, app as EditorApp);
    if (result.success) {
      return { success: true };
    }
    return { error: 'exec_failed', message: result.message };
  });
}
