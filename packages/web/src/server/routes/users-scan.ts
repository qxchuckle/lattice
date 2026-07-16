import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  listAllUsernames,
  renameUser,
  readLocalConfig,
  writeLocalConfig,
  scanForProjects,
  ensureDir,
  getUserDir,
  getUserSpecDir,
  getUserProjectsDir,
  getUserTasksDir,
  dirExists,
  removeDir,
  type ScanProgress,
} from '@qcqx/lattice-core';
import { createSseStream } from '../sse';

/** 校验用户名合法性（防止路径穿越） */
function isValidUsername(name: unknown): boolean {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z0-9_-]+$/.test(name) && !name.includes('..');
}

export function registerScanRoutes(app: FastifyInstance): void {
  app.post<{ Body: { dirs?: string[] } }>('/api/scan', async (req, reply) => {
    const username = await getUsername();
    const config = await readLocalConfig();
    const dirs = req.body?.dirs ?? config?.scanDirs ?? [];
    if (dirs.length === 0) {
      return { error: 'bad_request', message: '未指定扫描目录' };
    }
    const sse = createSseStream(reply);
    try {
      const result = await scanForProjects(username, dirs, (p: ScanProgress) => {
        sse.send({
          current: p.found,
          total: 0,
          added: p.added,
          updated: p.updated,
          currentFile: p.currentDir,
        });
      });
      sse.done({
        done: true,
        result: {
          added: result.added,
          updated: result.updated,
        },
      });
    } catch (err) {
      sse.done({ done: true, error: (err as Error).message });
    }
  });
}

export function registerUserRoutes(app: FastifyInstance): void {
  app.get('/api/users', async () => {
    const currentUser = await getUsername();
    const users = await listAllUsernames();
    return { users, currentUser };
  });

  app.post<{ Body: { username: string } }>('/api/users/switch', async (req) => {
    const config = (await readLocalConfig()) ?? { username: '' };
    await writeLocalConfig({ ...config, username: req.body.username });
    return { success: true };
  });

  app.post<{ Body: { name: string } }>('/api/users/create', async (req) => {
    if (!isValidUsername(req.body.name)) {
      return { error: 'bad_request', message: '用户名只允许字母、数字、下划线和连字符' };
    }
    await ensureDir(getUserDir(req.body.name));
    await ensureDir(getUserSpecDir(req.body.name));
    await ensureDir(getUserProjectsDir(req.body.name));
    await ensureDir(getUserTasksDir(req.body.name));
    return { success: true };
  });

  app.post<{ Body: { oldName: string; newName: string } }>('/api/users/rename', async (req) => {
    const { oldName, newName } = req.body;
    if (!isValidUsername(oldName) || !isValidUsername(newName)) {
      return { error: 'bad_request', message: '用户名只允许字母、数字、下划线和连字符' };
    }
    try {
      await renameUser(oldName, newName);
      return { success: true };
    } catch (err) {
      return { error: 'rename_failed', message: (err as Error).message };
    }
  });

  app.post<{ Body: { name: string } }>('/api/users/remove', async (req) => {
    const { name } = req.body;
    if (!isValidUsername(name)) {
      return { error: 'bad_request', message: '用户名只允许字母、数字、下划线和连字符' };
    }
    const currentUser = await getUsername();
    if (name === currentUser) {
      return { error: 'forbidden', message: '不能删除当前活跃用户' };
    }
    if (!(await dirExists(getUserDir(name)))) {
      return { error: 'not_found', message: `用户 ${name} 不存在` };
    }
    await removeDir(getUserDir(name));
    return { success: true };
  });
}
