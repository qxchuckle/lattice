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
  getUsername,
  listDomains,
  joinDomain,
  unlinkDomain,
  syncDomains,
  readSyncDomains,
  writeSyncDomains,
  domainHashOf,
  validateRoute,
  type SyncDomainConfig,
} from '@qcqx/lattice-core';

export function registerGitRoutes(app: FastifyInstance): void {
  app.get('/api/git/status', async () => {
    return await getGitStatus();
  });

  app.post<{ Body: { message?: string } }>('/api/git/commit', async (req) => {
    return await commitAll(req.body?.message);
  });

  app.post('/api/git/pull', async () => {
    return await pullRebase();
  });

  app.post('/api/git/push', async () => {
    return await pushGit();
  });

  app.post('/api/git/sync', async () => {
    return await syncAll();
  });

  // ── Remote 管理 ──

  app.get('/api/git/remotes', async () => {
    return await listRemotes();
  });

  app.post<{ Body: { name: string; url: string } }>('/api/git/remotes/add', async (req) => {
    return await addRemote(req.body.name, req.body.url);
  });

  app.post<{ Body: { name: string; url: string } }>('/api/git/remotes/set-url', async (req) => {
    return await setRemoteUrl(req.body.name, req.body.url);
  });

  app.post<{ Body: { name: string } }>('/api/git/remotes/remove', async (req) => {
    return await removeRemote(req.body.name);
  });

  // ── 域（经验包）管理 ──

  app.get('/api/git/domains', async () => {
    return await listDomains();
  });

  app.post<{
    Body: { remote: string; branch?: string; label?: string; use?: string; routes?: string[] };
  }>('/api/git/domains/join', async (req) => {
    const username = await getUsername();
    const domain: SyncDomainConfig = {
      remote: req.body.remote,
      branch: req.body.branch,
      label: req.body.label,
      use: req.body.use as SyncDomainConfig['use'],
      routes: req.body.routes,
    };
    return await joinDomain(domain, username);
  });

  app.post<{ Body: { hash: string } }>('/api/git/domains/unlink', async (req) => {
    return await unlinkDomain(req.body.hash);
  });

  app.post('/api/git/domains/sync', async () => {
    const username = await getUsername();
    return { outcomes: await syncDomains(username) };
  });

  app.post<{ Body: { hash: string; rule: string } }>('/api/git/domains/route/add', async (req) => {
    validateRoute(req.body.rule);
    const domains = await readSyncDomains();
    const idx = domains.findIndex((d) => domainHashOf(d) === req.body.hash);
    if (idx === -1) throw new Error(`未找到域：${req.body.hash}`);
    domains[idx] = { ...domains[idx], routes: [...(domains[idx].routes ?? []), req.body.rule] };
    await writeSyncDomains(domains);
    return { ok: true, routes: domains[idx].routes };
  });

  app.post<{ Body: { hash: string; rule: string } }>(
    '/api/git/domains/route/remove',
    async (req) => {
      const domains = await readSyncDomains();
      const idx = domains.findIndex((d) => domainHashOf(d) === req.body.hash);
      if (idx === -1) throw new Error(`未找到域：${req.body.hash}`);
      domains[idx] = {
        ...domains[idx],
        routes: (domains[idx].routes ?? []).filter((r) => r !== req.body.rule),
      };
      await writeSyncDomains(domains);
      return { ok: true, routes: domains[idx].routes };
    },
  );
}
