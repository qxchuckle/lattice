import type { FastifyInstance } from 'fastify';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import {
  getUsername,
  listProjectMetas,
  getProjectMeta,
  listTasks,
  getTaskMeta,
  getTaskGraphViews,
  getTaskLineage,
  listCheckpoints,
  listRelations,
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
  getSmartContext,
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
async function isPathSafe(path: string, username: string): Promise<boolean> {
  const latticeRoot = getLatticeRoot();
  if (path.startsWith(latticeRoot)) return true;
  // 项目路径验证：检查是否是某个已注册项目的 localPaths
  try {
    const projects = await listProjectMetas(username);
    return projects.some((p) => {
      const localPaths = p.localPaths || [];
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
    return listProjectMetas(username);
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
    // 多 ID 机制：task.projects 可能存储的是任意 ID，需用项目的全部 IDs 匹配
    const meta = await getProjectMeta(username, req.params.id);
    if (!meta) return [];
    const idSet = new Set(meta.ids);
    const allTasks = await listTasks(username);
    return allTasks.filter((t) => (t.projects || []).some((pid) => idSet.has(pid)));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/relations', async (req) => {
    const username = await getUsername();
    // 多 ID 机制：relation 的 projectA/projectB 可能存储的是任意 ID
    const meta = await getProjectMeta(username, req.params.id);
    if (!meta) return [];
    const idSet = new Set(meta.ids);
    const allRelations = await listRelations(username);
    return allRelations.filter((r) => idSet.has(r.projectA) || idSet.has(r.projectB));
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

  // 任务语义上下文（含语义关联 Spec）
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

  app.get('/api/relations', async () => {
    const username = await getUsername();
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
    if (!(await isPathSafe(path, username))) {
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
    const projects = await listProjectMetas(username);
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
