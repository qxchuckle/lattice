import type { FastifyInstance } from 'fastify';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import {
  getUsername,
  listProjects,
  getProjectMeta,
  listTasks,
  getTaskMeta,
  getTaskGraphViews,
  getTaskLineage,
  listCheckpoints,
  listRelations,
  getRelationsByProject,
  getProjectSpecs,
  getAllProjectSpecs,
  getUserSpecs,
  getGlobalSpecs,
  hybridSearch,
  getProjectGitStatus,
  getLatticeRoot,
  getProjectDir,
  getTaskDir,
  getTaskPrdPath,
  getTaskProgressPath,
  getTaskDesignPath,
  getTaskPrd,
  readText,
} from '@qcqx/lattice-core';

const execAsync = promisify(exec);

/** 打开文件/目录的安全命令映射 */
const OPEN_COMMANDS: Record<string, (path: string) => string> = {
  vscode: (p) => `code ${JSON.stringify(p)}`,
  cursor: (p) => `cursor ${JSON.stringify(p)}`,
  qoder: (p) => `qoder ${JSON.stringify(p)}`,
  finder: (p) => `open ${JSON.stringify(p)}`,
};

/** 验证路径安全：只允许 ~/.lattice 下或已注册项目路径 */
function isPathSafe(path: string, username: string): boolean {
  const latticeRoot = getLatticeRoot();
  if (path.startsWith(latticeRoot)) return true;
  // 项目路径验证：检查是否是某个已注册项目的 localPaths
  try {
    const projects = listProjects(username);
    return projects.some((p) => {
      const localPaths = JSON.parse(p.local_path || '[]') as string[];
      return localPaths.some((lp: string) => path.startsWith(lp));
    });
  } catch {
    return false;
  }
}

/** 注册所有 API 路由 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ── 项目 ──

  app.get('/api/projects', async () => {
    const username = await getUsername();
    return listProjects(username);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const username = await getUsername();
    const meta = await getProjectMeta(username, req.params.id);
    if (!meta) return { error: 'not_found', message: '项目不存在' };
    return meta;
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/git-status', async (req) => {
    const username = await getUsername();
    const meta = await getProjectMeta(username, req.params.id);
    if (!meta) return { error: 'not_found', message: '项目不存在' };
    return await getProjectGitStatus(meta);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/specs', async (req) => {
    const username = await getUsername();
    return getProjectSpecs(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/tasks', async (req) => {
    const username = await getUsername();
    return listTasks(username, { projectId: req.params.id });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/relations', async (req) => {
    const username = await getUsername();
    return getRelationsByProject(username, req.params.id);
  });

  // 获取项目实际存在的本地路径
  app.get<{ Params: { id: string } }>('/api/projects/:id/local-paths', async (req) => {
    const username = await getUsername();
    const meta = await getProjectMeta(username, req.params.id);
    if (!meta) return { error: 'not_found', message: '项目不存在' };
    const localPaths = meta.localPaths || [];
    const existingPaths = localPaths.filter((p) => existsSync(p));
    return { paths: existingPaths };
  });

  // ── 任务 ──

  app.get<{ Querystring: { status?: string; projectId?: string; allUser?: string } }>(
    '/api/tasks',
    async (req) => {
      const username = await getUsername();
      const opts: Record<string, unknown> = {};
      if (req.query.status) opts.status = req.query.status;
      if (req.query.projectId) opts.projectId = req.query.projectId;
      if (req.query.allUser === 'true') opts.allUser = true;
      return listTasks(username, opts);
    },
  );

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

  // ── 项目关系 ──

  app.get('/api/relations', async () => {
    const username = await getUsername();
    return listRelations(username);
  });

  // ── Spec ──

  app.get<{ Querystring: { scope?: string; projectId?: string } }>('/api/specs', async (req) => {
    const username = await getUsername();
    const scope = req.query.scope;
    if (scope === 'global') return getGlobalSpecs();
    if (scope === 'user') return getUserSpecs(username);
    if (scope === 'project' && req.query.projectId) {
      return getProjectSpecs(username, req.query.projectId);
    }
    // 默认返回全部
    const projectSpecs = req.query.projectId
      ? await getProjectSpecs(username, req.query.projectId)
      : await getAllProjectSpecs(username);
    return {
      global: await getGlobalSpecs(),
      user: await getUserSpecs(username),
      project: projectSpecs,
    };
  });

  // ── 搜索 ──

  app.get<{ Querystring: { q: string; type?: string; projectId?: string; limit?: string } }>(
    '/api/search',
    async (req) => {
      const opts: Record<string, unknown> = {};
      if (req.query.type) opts.type = req.query.type;
      if (req.query.projectId) opts.projectId = req.query.projectId;
      if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
      return hybridSearch(req.query.q, opts);
    },
  );

  // ── 打开文件/目录 ──

  app.get<{ Querystring: { path: string; app: string } }>('/api/open', async (req) => {
    const username = await getUsername();
    const { path, app } = req.query;
    if (!isPathSafe(path, username)) {
      return { error: 'forbidden', message: '路径不在允许范围内' };
    }
    const cmdFn = OPEN_COMMANDS[app];
    if (!cmdFn) {
      return { error: 'bad_request', message: `不支持的应用: ${app}` };
    }
    try {
      await execAsync(cmdFn(path));
      return { success: true };
    } catch {
      return { error: 'exec_failed', message: `无法用 ${app} 打开: ${path}` };
    }
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
        // content !== null 区分"文件不存在"（null）与"文件存在但为空"（""）
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

  // ── 全局统计 ──

  app.get('/api/stats', async () => {
    const username = await getUsername();
    const projects = listProjects(username);
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
}
