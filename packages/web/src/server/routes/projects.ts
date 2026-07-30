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
import { isPathSafe, resolveFilePath, ok, fail } from './shared';

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { username?: string } }>('/api/projects', async (req) => {
    const username = req.query.username || (await getUsername());
    return ok(await listVirtualProjectMetas(username));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return fail('not_found', '项目不存在');
    return ok(meta);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/git-status', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return fail('not_found', '项目不存在');
    return ok(await getProjectGitStatus(meta));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/specs', async (req) => {
    const username = await getUsername();
    return ok(await getProjectSpecs(username, req.params.id));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/tasks', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return ok([]);
    const idSet = new Set(meta.ids);
    const allTasks = await listTasks(username);
    return ok(allTasks.filter((t) => (t.projects || []).some((pid) => idSet.has(pid))));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/relations', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return ok([]);
    const idSet = new Set(meta.ids);
    const allRelations = await listRelations(username);
    return ok(allRelations.filter((r) => idSet.has(r.projectA) || idSet.has(r.projectB)));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/local-paths', async (req) => {
    const username = await getUsername();
    const meta = await getVirtualProjectMeta(username, req.params.id);
    if (!meta) return fail('not_found', '项目不存在');
    const localPaths = meta.localPaths || [];
    const existingPaths = localPaths.filter((p) => existsSync(p));
    return ok({ paths: existingPaths });
  });

  // ── 路径获取 ──

  app.get<{ Params: { type: string; id: string } }>('/api/paths/:type/:id', async (req) => {
    const username = await getUsername();
    const { type, id } = req.params;
    let path: string;
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
        default:
          return fail('bad_request', `未知路径类型: ${type}`);
      }
      return ok({ path });
    } catch {
      return fail('not_found', '路径不存在');
    }
  });

  // ── 文件内容读取 ──

  app.get<{ Params: { type: string; id: string } }>('/api/content/:type/:id', async (req) => {
    const username = await getUsername();
    const { type, id } = req.params;
    try {
      if (type === 'prd') {
        const content = await getTaskPrd(username, id);
        if (content !== null) return ok({ content });
        return fail('not_found', 'PRD 文件不存在或为空');
      }
      const filePath = await resolveFilePath(type, id, username);
      if (filePath) {
        const content = await readText(filePath);
        if (content !== null) return ok({ content });
        return fail('not_found', '文件不存在');
      }
      return fail('not_found', '文件不存在');
    } catch {
      return fail('not_found', '内容不存在');
    }
  });

  // ── Spec 内容读取（POST，传 specId 而非路径）──

  app.post<{ Body: { specId: string } }>('/api/spec/content', async (req) => {
    const username = await getUsername();
    const specId = req.body?.specId;
    if (!specId) return fail('bad_request', 'specId is required');
    const filePath = await resolveFilePath('spec', specId, username);
    if (!filePath) return fail('not_found', 'Spec 不存在');
    try {
      const content = await readText(filePath);
      if (content !== null) return ok({ content });
      return fail('not_found', '文件不存在');
    } catch {
      return fail('not_found', '内容不存在');
    }
  });

  // ── 打开文件/目录 ──

  app.post<{ Body: { type: string; entityId: string; app: string } }>('/api/open', async (req) => {
    const username = await getUsername();
    const { type, entityId, app } = req.body;
    const path = await resolveFilePath(type, entityId, username);
    if (!path) return fail('not_found', '文件不存在');
    const result = await openWithEditor(path, app as EditorApp);
    if (result.success) {
      return ok();
    }
    return fail('exec_failed', result.message);
  });

  // ── 打开已知安全路径（项目目录等，后端校验 isPathSafe）──

  app.post<{ Body: { path: string; app: string } }>('/api/open-path', async (req) => {
    const username = await getUsername();
    const { path, app } = req.body;
    if (!(await isPathSafe(path, username))) {
      return fail('forbidden', '路径不在允许范围内');
    }
    const result = await openWithEditor(path, app as EditorApp);
    if (result.success) {
      return ok();
    }
    return fail('exec_failed', result.message);
  });
}
