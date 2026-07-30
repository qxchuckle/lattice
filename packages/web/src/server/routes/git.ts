import type { FastifyInstance } from 'fastify';
import {
  getGitStatus,
  commitAll,
  pullRebase,
  pushGit,
  syncAll,
  listRemotes,
  addRemote,
  setRemoteUrl,
  removeRemote,
} from '@qcqx/lattice-core';
import { ok } from './shared';

export function registerGitRoutes(app: FastifyInstance): void {
  app.get('/api/git/status', async () => {
    return ok(await getGitStatus());
  });

  app.post<{ Body: { message?: string } }>('/api/git/commit', async (req) => {
    return ok(await commitAll(req.body?.message));
  });

  app.post('/api/git/pull', async () => {
    return ok(await pullRebase());
  });

  app.post('/api/git/push', async () => {
    return ok(await pushGit());
  });

  app.post('/api/git/sync', async () => {
    return ok(await syncAll());
  });

  // ── Remote 管理 ──

  app.get('/api/git/remotes', async () => {
    return ok(await listRemotes());
  });

  app.post<{ Body: { name: string; url: string } }>('/api/git/remotes/add', async (req) => {
    return ok(await addRemote(req.body.name, req.body.url));
  });

  app.post<{ Body: { name: string; url: string } }>('/api/git/remotes/set-url', async (req) => {
    return ok(await setRemoteUrl(req.body.name, req.body.url));
  });

  app.post<{ Body: { name: string } }>('/api/git/remotes/remove', async (req) => {
    return ok(await removeRemote(req.body.name));
  });
}
