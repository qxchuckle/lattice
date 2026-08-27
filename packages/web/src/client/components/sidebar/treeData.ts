import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import { getAdapter } from '../../adapters';
import {
  queryKeys,
  truncate,
  buildIdMap,
  resolvePrimaryId,
  deduplicateProjects,
  getProjectId,
} from '../../lib';
import { canvasStore } from '../../store';
import type { ViewMode } from '../../store';
import { useDomainsData, type DomainDataPack } from '../../hooks/data';
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
export function useTreeData(): {
  tree: TreeNode[];
  loading: boolean;
  tasks: TaskMeta[];
  specs: ParsedSpec[];
  domainsData?: DomainDataPack;
} {
  const adapter = getAdapter();
  const { domainFilter, domainUserFilter, localDataFilter } = useSnapshot(canvasStore);
  const hasDomainSelection = domainFilter.length > 0 || domainUserFilter.length > 0;
  const domainsQuery = useDomainsData(hasDomainSelection);
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });
  const tasksQuery = useQuery({ queryKey: queryKeys.tasks(), queryFn: () => adapter.getTasks() });
  const specsQuery = useQuery({ queryKey: queryKeys.specs(), queryFn: () => adapter.getSpecs() });

  const loading = projectsQuery.isLoading || tasksQuery.isLoading || specsQuery.isLoading;

  const tree = useMemo<TreeNode[]>(() => {
    if (loading) return [];
    const rawProjects = projectsQuery.data || [];
    // 多 ID 机制：去重 + 映射表
    const projects = deduplicateProjects(rawProjects as ProjectMeta[]);
    const idMap = buildIdMap(projects);
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
      const rawPid = s.projectId || 'other';
      const pid = rawPid === 'other' ? 'other' : resolvePrimaryId(idMap, rawPid);
      if (!projectSpecMap.has(pid)) projectSpecMap.set(pid, []);
      projectSpecMap.get(pid)!.push(s);
    });
    projectSpecMap.forEach((specs, pid) => {
      const project = projects.find((p) => getProjectId(p) === pid);
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
    const projectChildren: TreeNode[] = projects.map((p) => {
      const pid = getProjectId(p);
      const projectTasks = (tasks as TaskMeta[]).filter((t) =>
        (t.projects || []).some((tpid: string) => resolvePrimaryId(idMap, tpid) === pid),
      );
      const projectSpecItems = projectSpecs.filter((s: ParsedSpec) => {
        return !!s.projectId && resolvePrimaryId(idMap, s.projectId) === pid;
      });
      const children: TreeNode[] = [];
      if (projectTasks.length > 0) {
        children.push({
          key: `proj-tasks-${pid}`,
          title: `任务 (${projectTasks.length})`,
          type: 'spec-scope',
          children: projectTasks.map((t: TaskMeta) => ({
            key: `proj-task-${pid}-${t.id}`,
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
          key: `proj-specs-${pid}`,
          title: `Spec (${projectSpecItems.length})`,
          type: 'spec-scope',
          children: projectSpecItems.map((s: ParsedSpec) => ({
            key: `proj-spec-${pid}-${s.frontmatter.id || s.fileName}`,
            title: s.frontmatter.title || s.fileName,
            type: 'spec-item' as const,
            entityId: s.frontmatter.id || s.fileName,
            viewMode: 'spec' as ViewMode,
            meta: { scope: '项目级' },
          })),
        });
      }
      return {
        key: `proj-${pid}`,
        title: p.name,
        type: 'project-item' as const,
        entityId: pid,
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
        .map((pid: string) =>
          projects.find((p) => getProjectId(p) === resolvePrimaryId(idMap, pid)),
        )
        .filter((p): p is ProjectMeta => !!p);
      if (taskProjects.length > 0) {
        children.push({
          key: `task-projects-${t.id}`,
          title: `关联项目 (${taskProjects.length})`,
          type: 'spec-scope',
          children: taskProjects.map((p) => ({
            key: `task-proj-${t.id}-${getProjectId(p)}`,
            title: p.name,
            type: 'project-item' as const,
            entityId: getProjectId(p),
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

    // ── 域（经验包）树：勾选的域/域用户分组展示（默认不显示本地以外数据） ──
    const domainChildren: TreeNode[] = [];
    const pack = domainsQuery.data;
    if (pack && hasDomainSelection) {
      for (const d of pack.domains) {
        const wholeDomain = domainFilter.includes(d.hash);
        const selectedUsers = new Set(
          domainUserFilter.filter((k) => k.startsWith(`${d.hash}:`)).map((k) => k.split(':')[1]),
        );
        if (!wholeDomain && selectedUsers.size === 0) continue;
        const label8 = d.hash.slice(0, 8);
        const domainName = d.label || `域${label8}`;
        const domainSpecs = pack.specs.filter(
          (sp) =>
            sp.source === d.hash &&
            (wholeDomain || selectedUsers.has(sp.username)) &&
            (sp.scope === 'user' || sp.scope === 'global' ? true : true),
        );
        const domainTasks = pack.tasks.filter(
          (t) => t.source === d.hash && (wholeDomain || selectedUsers.has(t.username)),
        );
        const domainProjects = pack.projects.filter(
          (pj) => pj.source === d.hash && (wholeDomain || selectedUsers.has(pj.username)),
        );
        if (domainSpecs.length + domainTasks.length + domainProjects.length === 0) continue;
        domainChildren.push({
          key: `domain-${d.hash}`,
          title: domainName,
          type: 'spec-root',
          meta: { domain: domainName },
          children: [
            ...(domainProjects.length > 0
              ? [
                  {
                    key: `domain-${d.hash}-projects`,
                    title: `项目 (${domainProjects.length})`,
                    type: 'spec-scope' as const,
                    children: domainProjects.map((pj) => ({
                      key: `domain-${d.hash}-proj-${pj.contractId ?? pj.id}`,
                      title: pj.name ?? pj.contractId ?? pj.id ?? '',
                      type: 'project-item' as const,
                      // 与画布域节点 ID 同构：详情 entityData 定位 + 路由选中画布节点
                      entityId: `domain:${d.hash.slice(0, 8)}:project:${pj.contractId ?? pj.id ?? ''}`,
                      viewMode: 'project' as ViewMode,
                      meta: { domain: domainName, desc: `@${pj.username}` },
                    })),
                  },
                ]
              : []),
            ...(domainSpecs.length > 0
              ? [
                  {
                    key: `domain-${d.hash}-specs`,
                    title: `Spec (${domainSpecs.length})`,
                    type: 'spec-scope' as const,
                    children: domainSpecs.map((sp) => ({
                      key: `domain-${d.hash}-spec-${sp.filePath}`,
                      title: sp.title,
                      type: 'spec-item' as const,
                      // 与画布域节点 ID 同构（domain:<hash8>:spec:<filePath>）：详情面板依赖该 ID 定位 entityData
                      entityId: `domain:${d.hash.slice(0, 8)}:spec:${sp.filePath}`,
                      viewMode: 'spec' as ViewMode,
                      meta: {
                        domain: domainName,
                        desc: 'spec',
                        scope:
                          sp.scope === 'global'
                            ? '全局级'
                            : sp.scope === 'user'
                              ? '用户级'
                              : '项目级',
                      },
                    })),
                  },
                ]
              : []),
            ...(domainTasks.length > 0
              ? [
                  {
                    key: `domain-${d.hash}-tasks`,
                    title: `任务 (${domainTasks.length})`,
                    type: 'spec-scope' as const,
                    children: domainTasks.map((t) => ({
                      key: `domain-${d.hash}-task-${t.id}`,
                      title: truncate(t.title, 30),
                      type: 'task-item' as const,
                      // 与画布域节点 ID 同构：详情 entityData 定位 + 路由选中画布节点
                      entityId: `domain:${d.hash.slice(0, 8)}:task:${t.id}`,
                      viewMode: 'task' as ViewMode,
                      meta: { domain: domainName, status: t.status, desc: `@${t.username}` },
                    })),
                  },
                ]
              : []),
          ],
        });
      }
    }

    const roots: TreeNode[] = [];
    // 来源筛选：本机关闭时只显示域数据（本地三根不进树）
    if (localDataFilter) {
      roots.push(
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
      );
    }
    if (domainChildren.length > 0) {
      roots.push({
        key: 'root-domain',
        title: `域 (${domainChildren.length})`,
        type: 'spec-root',
        children: domainChildren,
      });
    }
    return roots;
  }, [
    loading,
    projectsQuery.data,
    tasksQuery.data,
    specsQuery.data,
    domainsQuery.data,
    hasDomainSelection,
    localDataFilter,
  ]);

  const specs = useMemo<ParsedSpec[]>(() => {
    const s = specsQuery.data;
    if (!s) return [];
    return [...(s.global || []), ...(s.user || []), ...(s.project || [])];
  }, [specsQuery.data]);

  return {
    tree,
    loading,
    tasks: (tasksQuery.data as TaskMeta[] | undefined) ?? [],
    specs,
    domainsData: domainsQuery.data,
  };
}
