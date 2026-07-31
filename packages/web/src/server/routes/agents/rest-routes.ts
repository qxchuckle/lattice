/**
 * Agent REST 路由 — 查询类端点（无 WS 状态依赖）
 *
 * 拆分自原 routes/agents.ts。所有端点只读（除 DELETE conversations），
 * 数据来自 LatticeAgent 单例（懒初始化）。
 */
import type { FastifyInstance } from 'fastify';
import type { LatticeAgent } from '@qcqx/lattice-agent';
import type {
  ResourceListItem,
  SourceResourceQuery,
  ModelInfo,
} from '@qcqx/lattice-agent-protocol';
import { getUsername, listProjects } from '@qcqx/lattice-core';
import { isPathSafe, ok, fail } from '../shared';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readCustomModels } from './shared';

export function registerAgentRestRoutes(
  app: FastifyInstance,
  getAgent: () => Promise<LatticeAgent>,
  cleanupTree: (treeId: string) => void,
): void {
  // 获取可用源列表（数据驱动：可用性/能力/降准全部来自握手 manifest）
  app.get('/api/agent/sources', async () => {
    const latticeAgent = await getAgent();
    const manifests = latticeAgent.sources.registry.listManifests();
    return ok({
      sources: manifests.map((m) => ({
        id: m.info.id,
        displayName: m.info.displayName,
        version: m.info.version,
        modelPolicy: m.capabilities.models.policy,
        available: m.available,
        modelCount: m.modelsSnapshot?.length ?? 0,
        // 数据驱动：UI 直接渲染，不硬编码源名判断
        unavailableReason: m.unavailableReason,
        downgrades: m.downgrades.length > 0 ? m.downgrades : undefined,
        capabilities: m.capabilities,
      })),
    });
  });

  // 获取模型列表（可按源过滤）：源提供的模型 + 用户自定义模型（仅 hybrid/open 源）
  app.get('/api/agent/models', async (req) => {
    const { sourceId } = req.query as { sourceId?: string };
    const latticeAgent = await getAgent();
    const registry = latticeAgent.sources.registry;
    const manifests = registry.listManifests();
    const sourceIds = sourceId ? [sourceId] : manifests.map((m) => m.info.id);
    // 动态通道聚合（listModels 是权威来源；manifest 快照仅展示用途）
    const models: Array<ModelInfo & { sourceId: string }> = [];
    for (const id of sourceIds) {
      const source = registry.getSource(id);
      if (!source) continue;
      for (const m of await source.listModels().catch(() => [])) {
        models.push({ ...m, sourceId: id });
      }
    }
    const items = models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      sourceId: m.sourceId,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: m.capabilities,
      costFactor: m.costFactor,
      costLabel: m.costLabel,
      tuning: m.tuning,
    }));
    // 合并自定义模型（catalog 源不支持）；参数规格全 freeform（模型未知，由用户自行设定）
    for (const id of sourceIds) {
      const policy = registry.getManifest(id)?.capabilities.models.policy;
      if (!policy || policy === 'catalog') continue;
      for (const modelId of await readCustomModels(id)) {
        if (items.some((m) => m.sourceId === id && m.id === modelId)) continue;
        items.push({
          id: modelId,
          displayName: modelId,
          sourceId: id,
          contextWindow: 0,
          maxOutputTokens: 0,
          capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
          costFactor: undefined,
          costLabel: undefined,
          custom: true,
          tuning: {
            contextWindow: { options: [], freeform: true },
            thinking: { options: ['low', 'medium', 'high'], toggleable: true, freeform: true },
          },
        } as (typeof items)[number] & { custom: boolean });
      }
    }
    return ok({ models: items });
  });

  // 资源发现：本地（lattice 命令/skill）+ 源级（产品自带）聚合
  app.get('/api/agent/resources', async (req) => {
    const q = req.query as { sourceId?: string; cwd?: string; kinds?: string };
    const latticeAgent = await getAgent();
    const kinds = q.kinds
      ? (q.kinds.split(',').filter(Boolean) as SourceResourceQuery['kinds'])
      : undefined;
    let cwd: string | undefined;
    if (q.cwd) {
      const username = await getUsername();
      if (await isPathSafe(q.cwd, username)) cwd = q.cwd;
    }

    const resources: ResourceListItem[] = [];
    latticeAgent.workflow.loadLocalCommands(cwd);
    for (const r of latticeAgent.workflow.listLocalResources()) {
      if (kinds?.length && !kinds.includes(r.kind)) continue;
      resources.push({ ...r, origin: 'local' });
    }
    const query: SourceResourceQuery = { ...(cwd ? { cwd } : {}), ...(kinds ? { kinds } : {}) };
    const { bySource, warnings } = await latticeAgent.sources.registry.listResources(
      q.sourceId,
      query,
    );
    for (const [sid, list] of Object.entries(bySource)) {
      for (const r of list) resources.push({ ...r, origin: 'source', sourceId: sid });
    }
    // warnings 透出：某源枚举失败时前端菜单可见提示（源永不静默降级）
    return ok({ resources, warnings });
  });

  // @ 文件引用搜索：在全部注册项目范围内按文件名模糊匹配（浅层遍历，上限 20 条）
  app.get('/api/agent/file-search', async (req) => {
    const { q } = req.query as { q?: string };
    const kw = (q ?? '').trim().toLowerCase();
    if (!kw) return ok({ files: [] });

    const IGNORED = new Set([
      'node_modules',
      '.git',
      'dist',
      '.next',
      '__pycache__',
      '.pnpm-store',
      'coverage',
      'build',
    ]);
    const MAX_RESULTS = 20;
    const MAX_DEPTH = 6;
    const results: Array<{ path: string; name: string; root: string }> = [];

    const projects = listProjects(await getUsername());
    const roots: string[] = [];
    for (const p of projects) {
      try {
        const paths = JSON.parse(p.local_path) as string[];
        if (Array.isArray(paths)) roots.push(...paths.filter((x) => typeof x === 'string'));
      } catch {
        /* 脏数据跳过 */
      }
    }

    const walk = async (dir: string, root: string, depth: number): Promise<void> => {
      if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, root, depth + 1);
        } else if (entry.name.toLowerCase().includes(kw)) {
          results.push({ path: full, name: entry.name, root: relative(root, full) });
        }
      }
    };

    for (const root of roots) {
      if (results.length >= MAX_RESULTS) break;
      await walk(root, root, 0);
    }
    return ok({ files: results });
  });

  // 获取对话树（含中断检测 + 能力投影）
  app.get('/api/agent/tree/:treeId', async (req) => {
    const { treeId } = req.params as { treeId: string };
    const latticeAgent = await getAgent();
    const tree = await latticeAgent.session.loadTree(treeId);
    if (!tree) return fail('not_found');
    const nodes = latticeAgent.session.getNodes(treeId);
    const interruptedStreams = await latticeAgent.session.getInterruptedStreams(treeId);
    const turnCapabilities = latticeAgent.conversation.turnCapabilities(treeId);
    return ok({ tree, nodes, interruptedStreams, turnCapabilities });
  });

  // 获取历史会话列表
  app.get('/api/agent/conversations', async () => {
    const latticeAgent = await getAgent();
    const sessions = await latticeAgent.session.listSessions();
    return ok({ conversations: sessions.sort((a, b) => b.updatedAt - a.updatedAt) });
  });

  // 删除历史会话
  app.delete('/api/agent/conversations/:treeId', async (req) => {
    const { treeId } = req.params as { treeId: string };
    try {
      await (await getAgent()).session.deleteTree(treeId);
      cleanupTree(treeId); // 清理 WS 同步状态（订阅/presence/宽限计时）
      return ok();
    } catch (err) {
      return fail('exec_failed', String(err));
    }
  });
}
