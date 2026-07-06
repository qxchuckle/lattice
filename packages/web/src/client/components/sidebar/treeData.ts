import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';
import { queryKeys, truncate } from '../../lib';
import type { ViewMode } from '../../store';
import type { TreeNode } from './treeUtils';
import type { TaskMeta, ProjectMeta, ParsedSpec } from '@qcqx/lattice-core';

/** 构建 spec-item 的关联任务子节点（无关联任务时返回 undefined） */
function buildSpecTaskChildren(specId: string, tasks: TaskMeta[]): TreeNode[] | undefined {
  const refTasks = tasks.filter((t: TaskMeta) =>
    (t.referencedSpecs || []).some((r: { id: string }) => r.id === specId),
  );
  if (refTasks.length === 0) return undefined;
  return refTasks.map((t: TaskMeta) => ({
    key: `spec-task-${specId}-${t.id}`,
    title: truncate(t.title, 30),
    type: 'task-item' as const,
    entityId: t.id,
    viewMode: 'task' as ViewMode,
    meta: { status: t.status },
  }));
}

/** 构建树形数据：Spec / 项目 / 任务 三级树 */
export function useTreeData(): { tree: TreeNode[]; loading: boolean; tasks: TaskMeta[] } {
  const adapter = getAdapter();
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });
  const tasksQuery = useQuery({ queryKey: queryKeys.tasks(), queryFn: () => adapter.getTasks() });
  const specsQuery = useQuery({ queryKey: queryKeys.specs(), queryFn: () => adapter.getSpecs() });

  const loading = projectsQuery.isLoading || tasksQuery.isLoading || specsQuery.isLoading;

  const tree = useMemo<TreeNode[]>(() => {
    if (loading) return [];
    const projects = projectsQuery.data || [];
    const tasks = tasksQuery.data || [];
    const allSpecs = specsQuery.data;

    // ── Spec 树 ──
    const specChildren: TreeNode[] = [];
    const globalSpecs = allSpecs?.global || [];
    const userSpecs = allSpecs?.user || [];
    const projectSpecs = allSpecs?.project || [];
    const totalSpecCount = globalSpecs.length + userSpecs.length + projectSpecs.length;

    if (globalSpecs.length > 0) {
      specChildren.push({
        key: 'spec-global',
        title: `全局级 (${globalSpecs.length})`,
        type: 'spec-scope',
        children: globalSpecs.map((s: ParsedSpec) => {
          const specId = s.frontmatter.id || s.fileName;
          return {
            key: `spec-g-${specId}`,
            title: s.frontmatter.title || s.fileName,
            type: 'spec-item' as const,
            entityId: specId,
            viewMode: 'spec' as ViewMode,
            meta: { scope: '全局级' },
            children: buildSpecTaskChildren(specId, tasks as TaskMeta[]),
          };
        }),
      });
    }
    if (userSpecs.length > 0) {
      specChildren.push({
        key: 'spec-user',
        title: `用户级 (${userSpecs.length})`,
        type: 'spec-scope',
        children: userSpecs.map((s: ParsedSpec) => {
          const specId = s.frontmatter.id || s.fileName;
          return {
            key: `spec-u-${specId}`,
            title: s.frontmatter.title || s.fileName,
            type: 'spec-item' as const,
            entityId: specId,
            viewMode: 'spec' as ViewMode,
            meta: { scope: '用户级' },
            children: buildSpecTaskChildren(specId, tasks as TaskMeta[]),
          };
        }),
      });
    }
    const projectSpecMap = new Map<string, ParsedSpec[]>();
    projectSpecs.forEach((s: ParsedSpec) => {
      const match = s.filePath.match(/\/projects\/([^/]+)\//);
      const pid = match ? match[1] : 'other';
      if (!projectSpecMap.has(pid)) projectSpecMap.set(pid, []);
      projectSpecMap.get(pid)!.push(s);
    });
    projectSpecMap.forEach((specs, pid) => {
      const project = projects.find((p) => p.id === pid);
      specChildren.push({
        key: `spec-p-${pid}`,
        title: `${project?.name || truncate(pid, 16)} (${specs.length})`,
        type: 'spec-scope',
        children: specs.map((s: ParsedSpec) => {
          const specId = s.frontmatter.id || s.fileName;
          return {
            key: `spec-pi-${pid}-${specId}`,
            title: s.frontmatter.title || s.fileName,
            type: 'spec-item' as const,
            entityId: specId,
            viewMode: 'spec' as ViewMode,
            meta: { scope: '项目级' },
            children: buildSpecTaskChildren(specId, tasks as TaskMeta[]),
          };
        }),
      });
    });

    // ── 项目树 ──
    const projectChildren: TreeNode[] = (projects as ProjectMeta[]).map((p) => {
      const projectTasks = (tasks as TaskMeta[]).filter((t) => (t.projects || []).includes(p.id));
      const projectSpecItems = projectSpecs.filter((s: ParsedSpec) => {
        const match = s.filePath.match(/\/projects\/([^/]+)\//);
        return match && match[1] === p.id;
      });
      const children: TreeNode[] = [];
      if (projectTasks.length > 0) {
        children.push({
          key: `proj-tasks-${p.id}`,
          title: `任务 (${projectTasks.length})`,
          type: 'spec-scope',
          children: projectTasks.map((t: TaskMeta) => ({
            key: `proj-task-${p.id}-${t.id}`,
            title: truncate(t.title, 30),
            type: 'task-item' as const,
            entityId: t.id,
            viewMode: 'task' as ViewMode,
            meta: { status: t.status },
          })),
        });
      }
      if (projectSpecItems.length > 0) {
        children.push({
          key: `proj-specs-${p.id}`,
          title: `Spec (${projectSpecItems.length})`,
          type: 'spec-scope',
          children: projectSpecItems.map((s: ParsedSpec) => ({
            key: `proj-spec-${p.id}-${s.frontmatter.id || s.fileName}`,
            title: s.frontmatter.title || s.fileName,
            type: 'spec-item' as const,
            entityId: s.frontmatter.id || s.fileName,
            viewMode: 'spec' as ViewMode,
            meta: { scope: '项目级' },
          })),
        });
      }
      return {
        key: `proj-${p.id}`,
        title: p.name,
        type: 'project-item' as const,
        entityId: p.id,
        viewMode: 'project' as ViewMode,
        meta: { desc: p.description },
        children: children.length > 0 ? children : undefined,
      };
    });

    // ── 任务树 ──
    const rootTasks = (tasks as TaskMeta[]).filter((t) => !t.parentTaskId);
    // 构建 spec 查找表（用于解析任务引用的 spec）
    const allSpecList = [...globalSpecs, ...userSpecs, ...projectSpecs];
    const specMap = new Map<string, ParsedSpec>();
    allSpecList.forEach((s: ParsedSpec) => {
      const sid = s.frontmatter.id || s.fileName;
      if (sid) specMap.set(sid, s);
    });
    const taskChildren: TreeNode[] = rootTasks.map((t: TaskMeta) => {
      const children: TreeNode[] = [];

      // 关联项目
      const taskProjects = (t.projects || [])
        .map((pid: string) => (projects as ProjectMeta[]).find((p) => p.id === pid))
        .filter((p): p is ProjectMeta => !!p);
      if (taskProjects.length > 0) {
        children.push({
          key: `task-projects-${t.id}`,
          title: `关联项目 (${taskProjects.length})`,
          type: 'spec-scope',
          children: taskProjects.map((p) => ({
            key: `task-proj-${t.id}-${p.id}`,
            title: p.name,
            type: 'project-item' as const,
            entityId: p.id,
            viewMode: 'project' as ViewMode,
            meta: { desc: p.description },
          })),
        });
      }

      // 引用 Spec
      const taskSpecItems = (t.referencedSpecs || []).flatMap((ref) => {
        const spec = specMap.get(ref.id);
        if (!spec) return [];
        const scopeLabel =
          ref.scope === 'global' ? '全局级' : ref.scope === 'user' ? '用户级' : '项目级';
        return [{ ref, spec, scopeLabel }];
      });
      if (taskSpecItems.length > 0) {
        children.push({
          key: `task-specs-${t.id}`,
          title: `引用 Spec (${taskSpecItems.length})`,
          type: 'spec-scope',
          children: taskSpecItems.map(({ ref, spec, scopeLabel }) => ({
            key: `task-spec-${t.id}-${ref.id}`,
            title: spec.frontmatter.title || spec.fileName,
            type: 'spec-item' as const,
            entityId: ref.id,
            viewMode: 'spec' as ViewMode,
            meta: { scope: scopeLabel },
          })),
        });
      }

      // 子任务
      const subTasks = (tasks as TaskMeta[]).filter((st) => st.parentTaskId === t.id);
      if (subTasks.length > 0) {
        children.push({
          key: `task-subtasks-${t.id}`,
          title: `子任务 (${subTasks.length})`,
          type: 'spec-scope',
          children: subTasks.map((st: TaskMeta) => ({
            key: `task-${t.id}-${st.id}`,
            title: truncate(st.title, 30),
            type: 'task-item' as const,
            entityId: st.id,
            viewMode: 'task' as ViewMode,
            meta: { status: st.status },
          })),
        });
      }

      return {
        key: `task-${t.id}`,
        title: truncate(t.title, 30),
        type: 'task-item' as const,
        entityId: t.id,
        viewMode: 'task' as ViewMode,
        meta: { status: t.status },
        children: children.length > 0 ? children : undefined,
      };
    });

    return [
      {
        key: 'root-spec',
        title: `Spec (${totalSpecCount})`,
        type: 'spec-root',
        children: specChildren,
      },
      {
        key: 'root-project',
        title: `项目 (${projects.length})`,
        type: 'project-root',
        children: projectChildren,
      },
      {
        key: 'root-task',
        title: `任务 (${tasks.length})`,
        type: 'task-root',
        children: taskChildren,
      },
    ];
  }, [loading, projectsQuery.data, tasksQuery.data, specsQuery.data]);

  return { tree, loading, tasks: (tasksQuery.data as TaskMeta[] | undefined) ?? [] };
}
