import type { ProjectRelation } from '@qcqx/lattice-core';
import { useDebouncedValue } from './ui';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '../adapters';
import { queryKeys, apiGet } from '../lib';
import type {
  ProjectMeta,
  TaskMeta,
  ParsedSpec,
  SearchResult,
  GlobalStatus,
} from '@qcqx/lattice-core';
import { homeToTildeWith } from '@qcqx/lattice-core';

/**
 * 剥离域命名空间前缀（domain:<hash8>:task|project|spec:xxx → xxx）：
 * 树/画布域节点 ID 带前缀（画布定位用），详情 API 查询用裸 ID（服务端有域回退）。
 */
function stripDomainPrefix(id: string): string {
  return id.replace(/^domain:[0-9a-f]{8,16}:(task|project|spec):/, '');
}

export function useEntityDetail(entityId: string | null, entityType: string | null) {
  const adapter = getAdapter();
  // 域前缀 ID 统一剥离后再查 API（queryKey 同步，跨入口缓存一致）
  const bareId = entityId ? stripDomainPrefix(entityId) : null;

  return useQuery({
    queryKey: ['detail', entityType, bareId],
    queryFn: async () => {
      if (!bareId || !entityType) return null;
      if (entityType === 'task') {
        const [task, progress] = await Promise.all([
          adapter.getTask(bareId),
          adapter.getTaskProgress(bareId),
        ]);
        return { type: 'task' as const, task, progress };
      }
      if (entityType === 'project') {
        // 子查询逐个容错：域项目的 gitStatus/specs/relations 可能无数据（只读回退）
        const [project, gitStatus, specs, tasks, relations] = await Promise.all([
          adapter.getProject(bareId),
          adapter.getProjectGitStatus(bareId).catch(() => null),
          adapter.getProjectSpecs(bareId).catch(() => []),
          adapter.getProjectTasks(bareId).catch(() => []),
          adapter.getProjectRelations(bareId).catch(() => [] as ProjectRelation[]),
        ]);
        // not_found 以 200+{error} 返回：置 null 触发「加载失败」而非携带错误对象渲染崩溃
        if (!project || (project as { error?: string }).error) {
          return null;
        }
        return {
          type: 'project' as const,
          project,
          gitStatus,
          specs,
          tasks,
          relations,
        };
      }
      return null;
    },
    enabled: !!entityId && !!entityType,
  });
}

export function useProjectGitStatus(projectId: string | null) {
  const adapter = getAdapter();
  return useQuery({
    queryKey: queryKeys.projectGitStatus(projectId || ''),
    queryFn: () => adapter.getProjectGitStatus(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useStats() {
  const adapter = getAdapter();
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => adapter.getStats(),
    staleTime: 60_000,
  });
}

/**
 * 返回把绝对路径 ~化 的展示函数（home/pathSep 来自 server `/api/global-status`；浏览器无 homedir）。
 * 未加载时返回原路径（安全降级）。**仅用于展示**——文件操作（openPathByPath 等）仍传绝对路径。
 */
export function useHomeTilde(): (path: string | null | undefined) => string {
  const { data } = useQuery({
    queryKey: ['global-status'],
    queryFn: async (): Promise<GlobalStatus | null> => {
      const d = await apiGet<GlobalStatus & { error?: string }>('/api/global-status');
      return d.error ? null : d;
    },
    staleTime: 60_000,
  });
  const home = data?.home;
  const sep = data?.pathSep;
  return (path) => (path && home && sep ? homeToTildeWith(path, home, sep) : (path ?? ''));
}

export function useUsers() {
  const adapter = getAdapter();
  return useQuery({
    queryKey: ['users'],
    queryFn: () => adapter.getUsers(),
    staleTime: 60_000,
  });
}

/**
 * 项目详情面板关联任务 tab 的 RAG 搜索。
 * 调用 ltc 标准 hybridSearch（type=task + projectId 过滤），结果限定在当前项目关联任务范围。
 * 参考 useSearch（hooks/ui.ts）的防抖与 staleTime 策略。
 */
export function useProjectTaskSearch(projectId: string | null, query: string) {
  const debouncedQuery = useDebouncedValue(query, 300);
  const adapter = getAdapter();
  return useQuery<SearchResult[]>({
    queryKey: ['project-task-search', projectId, debouncedQuery],
    queryFn: ({ signal }) =>
      adapter.search(debouncedQuery, {
        type: 'task',
        projectId: projectId || undefined,
        limit: 50,
        signal,
      }),
    enabled: debouncedQuery.length > 0 && !!projectId,
  });
}

/**
 * 域（经验包）数据包：Web 视图来源筛选的数据源。
 * knowledgeView 已遮蔽去重（被本地遮蔽的域副本不返回）；use=off 的域不在列表。
 */
export interface DomainDataPack {
  domains: Array<{ hash: string; label: string; use: string; users: string[] }>;
  degraded: string[];
  specs: Array<{
    source: string;
    scope: 'global' | 'user' | 'project';
    username: string;
    contractId: string | null;
    filePath: string;
    fileName: string;
    relativePath: string;
    title: string;
    tags: string[];
    content: string;
  }>;
  tasks: Array<import('@qcqx/lattice-core').TaskMeta & { source: string; username: string }>;
  projects: Array<
    import('@qcqx/lattice-core').ProjectMeta & {
      source: string;
      username: string;
      contractId: string | null;
    }
  >;
}

export function useDomainsData(enabled = true) {
  const adapter = getAdapter();
  return useQuery<DomainDataPack>({
    queryKey: ['domains-data'],
    queryFn: () => adapter.getDomainsData(),
    enabled,
    staleTime: 60_000,
  });
}
