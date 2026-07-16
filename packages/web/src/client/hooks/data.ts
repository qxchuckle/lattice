import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '../adapters';
import { queryKeys } from '../lib';
import type { ProjectMeta, TaskMeta, ParsedSpec } from '@qcqx/lattice-core';

export function useEntityDetail(entityId: string | null, entityType: string | null) {
  const adapter = getAdapter();

  return useQuery({
    queryKey: ['detail', entityType, entityId],
    queryFn: async () => {
      if (!entityId || !entityType) return null;
      if (entityType === 'task') {
        const [task, progress] = await Promise.all([
          adapter.getTask(entityId),
          adapter.getTaskProgress(entityId),
        ]);
        return { type: 'task' as const, task, progress };
      }
      if (entityType === 'project') {
        const [project, gitStatus, specs, tasks, relations] = await Promise.all([
          adapter.getProject(entityId),
          adapter.getProjectGitStatus(entityId),
          adapter.getProjectSpecs(entityId),
          adapter.getProjectTasks(entityId),
          adapter.getProjectRelations(entityId),
        ]);
        return { type: 'project' as const, project, gitStatus, specs, tasks, relations };
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

export function useUsers() {
  const adapter = getAdapter();
  return useQuery({
    queryKey: ['users'],
    queryFn: () => adapter.getUsers(),
    staleTime: 60_000,
  });
}
