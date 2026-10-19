import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import {
  createComposite,
  getProjectGitStatus,
  openWithEditor,
  readGroupRegistry,
  resolveGroupPathsForIds,
  type EditorApp,
  type ProjectMeta,
} from '@qcqx/lattice-core';
import * as lattice from '@qcqx/lattice-services';
import { isPathSafe, readDomainTaskDoc, readDomainMirrorFile } from './shared';

/** groupIds → 分组完整路径（注册表解析；注册表缺失时静默回退空数组）。 */
async function resolveGroupPaths(username: string, groupIds?: string[]): Promise<string[]> {
  if (!groupIds || groupIds.length === 0) return [];
  try {
    return resolveGroupPathsForIds(await readGroupRegistry(username), groupIds);
  } catch {
    return [];
  }
}

/**
 * 项目路由 = @qcqx/lattice-services 的 HTTP 绑定。
 * 域数据（sync-domains）回退属 web 宿主特有能力，保留在本层。
 */
export function registerProjectRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { username?: string } }>('/api/projects', async (req) => {
    const username = req.query.username || (await lattice.currentUsername());
    return lattice.listProjects(username);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const username = await lattice.currentUsername();
    const meta = await lattice.getProject(username, req.params.id);
    if (meta) return { ...meta, groupPaths: await resolveGroupPaths(username, meta.groupIds) };
    // 跨用户回退：ID 带 username: 前缀或属其他用户时，按全用户索引定位属主再查
    const bareId = req.params.id.replace(/^[\w.-]+:(?=legacy:|git:|remote:)/, '');
    if (bareId !== req.params.id) {
      const ownerUsername = req.params.id.slice(0, req.params.id.length - bareId.length - 1);
      const owner = await lattice.getProject(ownerUsername, bareId);
      if (owner) {
        return { ...owner, groupPaths: await resolveGroupPaths(ownerUsername, owner.groupIds) };
      }
    }
    try {
      const all = (await lattice.listProjects(username)) as Array<
        ProjectMeta & { username?: string }
      >;
      const hit = all.find(
        (m) => m.id === bareId || (m.ids ?? []).includes(bareId) || m.id === req.params.id,
      );
      if (hit?.username) {
        const ownerMeta = await lattice.getProject(hit.username, hit.id ?? hit.ids?.[0] ?? '');
        if (ownerMeta) {
          return {
            ...ownerMeta,
            groupPaths: await resolveGroupPaths(hit.username, ownerMeta.groupIds),
          };
        }
      }
    } catch {
      // 全用户索引不可用时走下方域回退
    }
    // 域项目回退（只读展示：本地 miss 时从统一数据源查域项目）
    try {
      const composite = await createComposite(username);
      const view = await composite.knowledgeView();
      const dp = view.projects.find(
        (v) =>
          v.source !== 'local' &&
          (v.contractId === req.params.id || v.project.ids?.includes(req.params.id)),
      );
      if (dp) {
        return {
          ...dp.project,
          domain: dp.source,
          domainLabel: view.labels.get(dp.source) ?? '',
        };
      }
    } catch {
      // 域数据不可用（G1 降级）
    }
    return { error: 'not_found', message: '项目不存在' };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/git-status', async (req) => {
    const username = await lattice.currentUsername();
    const meta = await lattice.getProject(username, req.params.id);
    if (!meta) return { error: 'not_found', message: '项目不存在' };
    return await getProjectGitStatus(meta);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/specs', async (req) => {
    const username = await lattice.currentUsername();
    const specs = await lattice.getProjectSpecsFor(username, req.params.id);
    return specs.map((entry) => entry.spec);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/tasks', async (req) => {
    const username = await lattice.currentUsername();
    return lattice.getProjectTasks(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/relations', async (req) => {
    const username = await lattice.currentUsername();
    return lattice.getProjectRelations(username, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/local-paths', async (req) => {
    const username = await lattice.currentUsername();
    const meta = await lattice.getProject(username, req.params.id);
    if (!meta) return { error: 'not_found', message: '项目不存在' };
    const localPaths = meta.localPaths || [];
    return { paths: localPaths.filter((p) => existsSync(p)) };
  });

  // ── 路径获取 ──

  const KNOWN_PATH_TYPES = new Set([
    'project-dir',
    'task-dir',
    'prd',
    'progress',
    'design',
    'profile',
    'spec',
  ]);

  app.get<{ Params: { type: string; id: string } }>('/api/paths/:type/:id', async (req) => {
    const username = await lattice.currentUsername();
    const { type, id } = req.params;
    if (!KNOWN_PATH_TYPES.has(type)) {
      return { error: 'bad_request', message: `未知路径类型: ${type}` };
    }
    const path = await lattice.resolveContentPath(username, type, id);
    if (!path) return { error: 'not_found', message: '路径不存在' };
    return { path };
  });

  // ── 文件内容读取 ──

  app.get<{ Params: { type: string; id: string } }>('/api/content/:type/:id', async (req) => {
    const username = await lattice.currentUsername();
    const { type, id } = req.params;
    try {
      const content = await lattice.readContent(username, type, id);
      if (content !== null) return { content };
      // 域任务回退：从镜像读（只读展示）
      const domainFile =
        type === 'prd'
          ? 'prd.md'
          : type === 'design'
            ? 'design.md'
            : type === 'progress'
              ? 'progress.yaml'
              : null;
      if (domainFile) {
        const domainContent = await readDomainTaskDoc(username, id, domainFile);
        if (domainContent !== null) return { content: domainContent };
      }
      return { error: 'not_found', message: '文件不存在' };
    } catch {
      return { error: 'not_found', message: '内容不存在' };
    }
  });

  // ── Spec 内容读取（POST，传 specId 而非路径）──

  app.post<{ Body: { specId: string } }>('/api/spec/content', async (req) => {
    const username = await lattice.currentUsername();
    const specId = req.body?.specId;
    if (!specId) return { error: 'bad_request', message: 'specId is required' };
    const content = await lattice.readContent(username, 'spec', specId);
    if (content !== null) return { content };
    // 域 spec 回退：specId 为镜像内绝对路径时直接读（限定 .sync-domains 前缀，防任意读取）
    const domainContent = await readDomainMirrorFile(specId);
    if (domainContent !== null) return { content: domainContent };
    return { error: 'not_found', message: 'Spec 不存在' };
  });

  // ── 打开文件/目录 ──

  app.post<{ Body: { type: string; entityId: string; app: string } }>('/api/open', async (req) => {
    const username = await lattice.currentUsername();
    const { type, entityId, app } = req.body;
    const path = await lattice.resolveContentPath(username, type, entityId);
    if (!path) return { error: 'not_found', message: '文件不存在' };
    const result = await openWithEditor(path, app as EditorApp);
    if (result.success) {
      return { success: true };
    }
    return { error: 'exec_failed', message: result.message };
  });

  // ── 打开已知安全路径（项目目录等，后端校验 isPathSafe）──

  app.post<{ Body: { path: string; app: string } }>('/api/open-path', async (req) => {
    const username = await lattice.currentUsername();
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
