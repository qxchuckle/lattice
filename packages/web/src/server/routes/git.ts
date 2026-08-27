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
  updateDomain,
  syncDomains,
  readSyncDomains,
  writeSyncDomains,
  readBaseline,
  previewContribution,
  domainHashOf,
  validateRoute,
  resolveDomainRef,
  createComposite,
  readSyncLog,
  initLatticeGit,
  getLatticeRoot,
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

  // ── 主数据 Git 管理 ──

  // 启用 ~/.lattice 主仓 Git 管理（origin 单仓多机同步轨道）
  app.post<{ Body: { remote?: string } }>('/api/git/enable', async (req) => {
    const root = getLatticeRoot();
    return await initLatticeGit(root, req.body?.remote || undefined);
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

  // 同步日志（JSONL 聚合读取：target=all 时合并 origin + 各域，按时间倒序）
  app.get<{ Querystring: { target?: string; limit?: number } }>(
    '/api/git/sync-logs',
    async (req) => {
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const target = req.query.target || 'all';
      if (target !== 'all') {
        return { entries: await readSyncLog(target, limit) };
      }
      const targets = ['origin'];
      try {
        for (const d of await listDomains()) targets.push(d.hash);
      } catch {
        // 未初始化时只有 origin
      }
      const all = (await Promise.all(targets.map((t) => readSyncLog(t, limit)))).flat();
      all.sort((a, b) => (a.at < b.at ? 1 : -1));
      return { entries: all.slice(0, limit) };
    },
  );

  // 域数据包（Web 视图来源筛选）：knowledgeView 域条目序列化（specs/tasks/projects + source/username 标注）
  app.get('/api/domains/data', async () => {
    const username = await getUsername();
    const composite = await createComposite(username);
    const view = await composite.knowledgeView();
    const domainEntries = view.specs.filter((v) => v.source !== 'local');
    const domainTasks = view.tasks.filter((v) => v.source !== 'local');
    const domainProjects = view.projects.filter((v) => v.source !== 'local');

    const domainsInfo = new Map<
      string,
      { hash: string; label: string; use: string; users: string[] }
    >();
    for (const src of composite.sources) {
      if (src.kind !== 'domain' || src.use === 'off') continue;
      domainsInfo.set(src.id, {
        hash: src.id,
        label: view.labels.get(src.id) ?? '',
        use: src.use,
        users: [],
      });
    }
    for (const v of [...domainEntries, ...domainTasks, ...domainProjects]) {
      const d = domainsInfo.get(v.source);
      if (d && v.username && !d.users.includes(v.username)) d.users.push(v.username);
    }

    return {
      domains: [...domainsInfo.values()],
      degraded: view.degraded,
      specs: domainEntries.map((v) => ({
        source: v.source,
        scope: v.scope,
        username: v.username ?? '',
        contractId: v.contractId ?? null,
        filePath: v.spec.filePath,
        fileName: v.spec.fileName,
        relativePath: v.spec.relativePath,
        title: v.spec.frontmatter.title ?? v.spec.fileName,
        tags: v.spec.frontmatter.tags ?? [],
        content: v.spec.content,
      })),
      tasks: domainTasks.map((v) => ({ ...v.task, source: v.source, username: v.username })),
      projects: domainProjects.map((v) => ({
        ...v.project,
        source: v.source,
        username: v.username,
        contractId: v.contractId,
      })),
    };
  });

  // dry-run 预览：给定 routes 会推送什么（不实际推送，保存前提示）
  app.post<{
    Body: { hash: string; routes?: string[] };
  }>('/api/git/domains/preview', async (req) => {
    const username = await getUsername();
    const resolved = await resolveDomainRef(req.body.hash);
    if (resolved.error || resolved.domain === undefined) throw new Error(resolved.error);
    const hash = domainHashOf(resolved.domain);
    const baseline = await readBaseline(hash);
    const result = await previewContribution(username, req.body.routes, baseline?.paths ?? []);
    return result;
  });

  // 域编辑（label/use/routes；hash 定位，支持 ≥4 位前缀）
  app.post<{
    Body: {
      hash: string;
      remote?: string;
      branch?: string;
      label?: string;
      use?: string;
      routes?: string[];
    };
  }>('/api/git/domains/update', async (req) => {
    const resolved = await resolveDomainRef(req.body.hash);
    if (resolved.error || resolved.domain === undefined) throw new Error(resolved.error);
    const oldHash = domainHashOf(resolved.domain!);
    const result = await updateDomain(oldHash, {
      ...(req.body.remote ? { remote: req.body.remote } : {}),
      ...(req.body.branch ? { branch: req.body.branch } : {}),
      ...(req.body.label !== undefined ? { label: req.body.label || undefined } : {}),
      ...(req.body.use !== undefined ? { use: req.body.use as SyncDomainConfig['use'] } : {}),
      ...(req.body.routes !== undefined ? { routes: req.body.routes } : {}),
    });
    return {
      ok: true,
      domain: result.domain,
      hash: result.hash,
      migrated: result.migrated,
      ...(result.pullWarning ? { pullWarning: result.pullWarning } : {}),
    };
  });

  // 域优先级重排（数组顺序 = 读时遮蔽优先级）
  app.post<{ Body: { hashes: string[] } }>('/api/git/domains/reorder', async (req) => {
    const domains = await readSyncDomains();
    const byHash = new Map(domains.map((d) => [domainHashOf(d), d]));
    const next: SyncDomainConfig[] = [];
    for (const h of req.body.hashes) {
      const d = byHash.get(h);
      if (!d) throw new Error(`未找到域：${h}`);
      next.push(d);
      byHash.delete(h);
    }
    for (const d of byHash.values()) next.push(d);
    await writeSyncDomains(next);
    return { ok: true, count: next.length };
  });

  app.post('/api/git/domains/sync', async () => {
    const username = await getUsername();
    return { outcomes: await syncDomains(username) };
  });

  app.post<{ Body: { hash: string; rule: string } }>('/api/git/domains/route/add', async (req) => {
    validateRoute(req.body.rule);
    const resolved = await resolveDomainRef(req.body.hash);
    if (resolved.error || resolved.domain === undefined) throw new Error(resolved.error);
    const domains = await readSyncDomains();
    const idx = domains.findIndex((d) => domainHashOf(d) === domainHashOf(resolved.domain!));
    domains[idx] = { ...domains[idx], routes: [...(domains[idx].routes ?? []), req.body.rule] };
    await writeSyncDomains(domains);
    return { ok: true, routes: domains[idx].routes };
  });

  app.post<{ Body: { hash: string; rule: string } }>(
    '/api/git/domains/route/remove',
    async (req) => {
      const resolved = await resolveDomainRef(req.body.hash);
      if (resolved.error || resolved.domain === undefined) throw new Error(resolved.error);
      const domains = await readSyncDomains();
      const idx = domains.findIndex((d) => domainHashOf(d) === domainHashOf(resolved.domain!));
      domains[idx] = {
        ...domains[idx],
        routes: (domains[idx].routes ?? []).filter((r) => r !== req.body.rule),
      };
      await writeSyncDomains(domains);
      return { ok: true, routes: domains[idx].routes };
    },
  );
}
