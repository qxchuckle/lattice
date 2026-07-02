import { useEffect, useDeferredValue, type CSSProperties } from 'react';
import { useSnapshot } from 'valtio';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from './adapters';
import { queryKeys, layoutGraph, getRelationStyle } from './lib';
import {
  canvasStore,
  sidebarStore,
  toggleTheme,
  themeStore,
  closeDetail,
  type ViewMode,
} from './store';
import type { LatticeNode, LatticeEdge } from './types/graph';
import type {
  ProjectMeta,
  ProjectRelation,
  TaskMeta,
  ParsedSpec,
  CheckpointEntry,
  ReferencedSpec,
} from '@qcqx/lattice-core';

// ── 全局视角：项目 + 关系图 ──

export function useGlobalGraph() {
  const adapter = getAdapter();
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: () => adapter.getTasks(),
  });
  const relationsQuery = useQuery({
    queryKey: queryKeys.relations,
    queryFn: () => adapter.getRelations(),
  });
  const specsQuery = useQuery({
    queryKey: queryKeys.specs(),
    queryFn: () => adapter.getSpecs(),
  });

  const nodes: LatticeNode[] = [];
  const edges: LatticeEdge[] = [];

  // 项目节点
  (projectsQuery.data || []).forEach((p: ProjectMeta) => {
    nodes.push({
      id: p.id,
      type: 'projectNode',
      position: { x: 0, y: 0 },
      data: {
        entityType: 'project',
        projectId: p.id,
        name: p.name,
        hasGit: !!p.gitRemotes?.length,
      },
    });
  });

  // Spec 节点：全局级 + 用户级 + 项目级（必须在任务遍历前创建，供任务引用）
  const allSpecs: (ParsedSpec & { scopeLevel: string })[] = [
    ...(specsQuery.data?.global || []).map((s: ParsedSpec) => ({ ...s, scopeLevel: 'global' })),
    ...(specsQuery.data?.user || []).map((s: ParsedSpec) => ({ ...s, scopeLevel: 'user' })),
    ...(specsQuery.data?.project || []).map((s: ParsedSpec) => ({ ...s, scopeLevel: 'project' })),
  ];
  const specIdToNodeId = new Map<string, string>();
  allSpecs.forEach((s) => {
    const specId = s.frontmatter.id || s.fileName;
    const specNodeId = `spec-${specId}`;
    specIdToNodeId.set(specId, specNodeId);
    specIdToNodeId.set(s.fileName, specNodeId);
    nodes.push({
      id: specNodeId,
      type: 'specNode',
      position: { x: 0, y: 0 },
      data: {
        entityType: 'spec',
        specId,
        title: s.frontmatter.title || s.fileName,
        scope: s.scopeLevel,
        filePath: s.filePath,
      },
    });
    // 项目级 spec → 连到对应项目
    if (s.scopeLevel === 'project') {
      const match = s.filePath.match(/\/projects\/([^/]+)\//);
      if (match) {
        edges.push({
          id: `edge-${match[1]}-${specNodeId}`,
          source: match[1],
          target: specNodeId,
          type: 'smoothstep',
          label: 'spec',
          style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
          data: { label: 'spec' },
        });
      }
    }
    // 全局/用户级 spec：游离节点，不连项目
  });

  // 任务节点 + 项目→任务 边 + 父子任务边 + 任务→spec 引用边
  (tasksQuery.data || []).forEach((t: TaskMeta) => {
    nodes.push({
      id: t.id,
      type: 'taskNode',
      position: { x: 0, y: 0 },
      data: { entityType: 'task', taskId: t.id, title: t.title, status: t.status },
    });
    (t.projects || []).forEach((pid: string) => {
      edges.push({
        id: `edge-${pid}-${t.id}`,
        source: pid,
        target: t.id,
        type: 'smoothstep',
        label: 'task',
        style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
        data: { label: 'task' },
      });
    });
    // 父任务→子任务 边
    if (t.parentTaskId) {
      edges.push({
        id: `edge-parent-${t.parentTaskId}-${t.id}`,
        source: t.parentTaskId,
        target: t.id,
        type: 'smoothstep',
        label: 'parent',
        style: { stroke: 'var(--brand-color)', opacity: 0.4 } as CSSProperties,
        data: { label: 'parent' },
      });
    }
    // 任务→引用的 spec 边
    (t.referencedSpecs || []).forEach((ref: ReferencedSpec) => {
      const specNodeId = specIdToNodeId.get(ref.id);
      if (specNodeId) {
        edges.push({
          id: `edge-spec-${t.id}-${ref.id}`,
          source: t.id,
          target: specNodeId,
          type: 'smoothstep',
          label: 'ref-spec',
          style: { stroke: '#13C2C2', opacity: 0.4 } as CSSProperties,
          data: { label: 'ref-spec' },
        });
      }
    });
  });

  // 项目↔项目 关系边
  (relationsQuery.data || []).forEach((r: ProjectRelation) => {
    const style = getRelationStyle(r.type);
    edges.push({
      id: r.id,
      source: r.projectA,
      target: r.projectB,
      type: 'smoothstep',
      label: r.type,
      style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray } as CSSProperties,
      data: { relationType: r.type, label: r.type },
      animated: r.type === 'depends-on',
    });
  });

  const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'TB') : nodes;
  return {
    nodes: layoutedNodes,
    edges,
    isLoading:
      projectsQuery.isLoading ||
      tasksQuery.isLoading ||
      relationsQuery.isLoading ||
      specsQuery.isLoading,
  };
}

// ── 任务视角：以任务为锚点展开 ──

export function useTaskGraph(taskId: string | null) {
  const adapter = getAdapter();
  const taskQuery = useQuery({
    queryKey: queryKeys.task(taskId || ''),
    queryFn: () => adapter.getTask(taskId!),
    enabled: !!taskId,
  });
  const progressQuery = useQuery({
    queryKey: queryKeys.taskProgress(taskId || ''),
    queryFn: () => adapter.getTaskProgress(taskId!),
    enabled: !!taskId,
  });
  // 无错点时获取所有任务
  const allTasksQuery = useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: () => adapter.getTasks(),
    enabled: !taskId,
  });

  const nodes: LatticeNode[] = [];
  const edges: LatticeEdge[] = [];

  // 无错点模式：展示所有任务 + 父子关系
  if (!taskId && allTasksQuery.data) {
    allTasksQuery.data.forEach((t: TaskMeta) => {
      nodes.push({
        id: t.id,
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: { entityType: 'task', taskId: t.id, title: t.title, status: t.status },
      });
      if (t.parentTaskId) {
        edges.push({
          id: `edge-${t.parentTaskId}-${t.id}`,
          source: t.parentTaskId,
          target: t.id,
          type: 'smoothstep',
          label: 'parent',
          style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
          data: { label: 'parent' },
        });
      }
    });
    const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'TB') : nodes;
    return { nodes: layoutedNodes, edges, isLoading: allTasksQuery.isLoading };
  }

  if (taskQuery.data && !(taskQuery.data as { error?: string }).error) {
    const task = taskQuery.data;
    // 中心任务节点
    nodes.push({
      id: task.id,
      type: 'taskNode',
      position: { x: 0, y: 0 },
      data: { entityType: 'task', taskId: task.id, title: task.title, status: task.status },
    });

    // 关联项目
    (task.projects || []).forEach((pid: string) => {
      nodes.push({
        id: pid,
        type: 'projectNode',
        position: { x: 0, y: 0 },
        data: { entityType: 'project', projectId: pid, name: pid.slice(0, 12) },
      });
      edges.push({
        id: `edge-${task.id}-${pid}`,
        source: task.id,
        target: pid,
        type: 'smoothstep',
        label: 'belongs-to',
        style: { stroke: 'var(--text-secondary)', opacity: 0.5 } as CSSProperties,
        data: { label: 'belongs-to' },
      });
    });

    // 父任务
    if (task.parentTaskId) {
      nodes.push({
        id: task.parentTaskId,
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: { entityType: 'task', taskId: task.parentTaskId, title: '父任务', status: 'unknown' },
      });
      edges.push({
        id: `edge-${task.parentTaskId}-${task.id}`,
        source: task.parentTaskId,
        target: task.id,
        type: 'smoothstep',
        label: 'parent',
        style: { stroke: 'var(--text-secondary)', opacity: 0.5 } as CSSProperties,
        data: { label: 'parent' },
      });
    }

    // Checkpoint 时间线（线性串联）
    (progressQuery.data || []).forEach((cp: CheckpointEntry, i: number) => {
      nodes.push({
        id: cp.id,
        type: 'checkpointNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'checkpoint',
          checkpointId: cp.id,
          title: cp.title,
          checkpointType: cp.type,
          message: cp.message,
          time: cp.time,
          taskId: task.id,
        },
      });
      const source = i === 0 ? task.id : progressQuery.data![i - 1].id;
      edges.push({
        id: `edge-${source}-${cp.id}`,
        source,
        target: cp.id,
        type: 'smoothstep',
        label: 'checkpoint',
        style: { stroke: 'var(--text-secondary)', opacity: 0.5 } as CSSProperties,
        data: { label: 'checkpoint' },
      });
    });
  }

  const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'LR') : nodes;
  return { nodes: layoutedNodes, edges, isLoading: taskQuery.isLoading || progressQuery.isLoading };
}

// ── 项目视角：以项目为锚点展开 ──

export function useProjectGraph(projectId: string | null) {
  const adapter = getAdapter();
  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId || ''),
    queryFn: () => adapter.getProject(projectId!),
    enabled: !!projectId,
  });
  const specsQuery = useQuery({
    queryKey: ['projects', projectId || '', 'specs'],
    queryFn: () => adapter.getProjectSpecs(projectId!),
    enabled: !!projectId,
  });
  const tasksQuery = useQuery({
    queryKey: ['projects', projectId || '', 'tasks'],
    queryFn: () => adapter.getProjectTasks(projectId!),
    enabled: !!projectId,
  });
  const relationsQuery = useQuery({
    queryKey: ['projects', projectId || '', 'relations'],
    queryFn: () => adapter.getProjectRelations(projectId!),
    enabled: !!projectId,
  });
  // 全局数据用于递归一层
  const allTasksQuery = useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: () => adapter.getTasks(),
  });
  const allSpecsQuery = useQuery({
    queryKey: queryKeys.specs('project'),
    queryFn: () => adapter.getSpecs('project'),
  });
  const allProjectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });
  const allRelationsQuery = useQuery({
    queryKey: queryKeys.relations,
    queryFn: () => adapter.getRelations(),
  });

  const nodes: LatticeNode[] = [];
  const edges: LatticeEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (node: LatticeNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  // 无错点模式：展示所有项目 + 关系
  if (!projectId) {
    (allProjectsQuery.data || []).forEach((p: ProjectMeta) => {
      addNode({
        id: p.id,
        type: 'projectNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'project',
          projectId: p.id,
          name: p.name,
          hasGit: !!p.gitRemotes?.length,
        },
      });
    });
    (allRelationsQuery.data || []).forEach((r: ProjectRelation) => {
      const style = getRelationStyle(r.type);
      edges.push({
        id: r.id,
        source: r.projectA,
        target: r.projectB,
        type: 'smoothstep',
        label: r.type,
        style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray } as CSSProperties,
        data: { relationType: r.type, label: r.type },
        animated: r.type === 'depends-on',
      });
    });
    const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'TB') : nodes;
    return {
      nodes: layoutedNodes,
      edges,
      isLoading: allProjectsQuery.isLoading || allRelationsQuery.isLoading,
    };
  }

  if (projectQuery.data && !(projectQuery.data as { error?: string }).error) {
    const project = projectQuery.data;
    // 中心项目节点
    addNode({
      id: project.id,
      type: 'projectNode',
      position: { x: 0, y: 0 },
      data: {
        entityType: 'project',
        projectId: project.id,
        name: project.name,
        hasGit: !!project.gitRemotes?.length,
      },
    });

    // 项目的 Spec
    (specsQuery.data || []).forEach((s: ParsedSpec) => {
      const specNodeId = `spec-${project.id}-${s.fileName}`;
      addNode({
        id: specNodeId,
        type: 'specNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'spec',
          specId: s.fileName,
          title: s.frontmatter.title || s.fileName,
          scope: 'project',
        },
      });
      edges.push({
        id: `edge-${project.id}-${specNodeId}`,
        source: project.id,
        target: specNodeId,
        type: 'smoothstep',
        label: 'spec',
        style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
        data: { label: 'spec' },
      });
    });

    // 项目的任务
    (tasksQuery.data || []).forEach((t: TaskMeta) => {
      addNode({
        id: t.id,
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: { entityType: 'task', taskId: t.id, title: t.title, status: t.status },
      });
      edges.push({
        id: `edge-${project.id}-${t.id}`,
        source: project.id,
        target: t.id,
        type: 'smoothstep',
        label: 'task',
        style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
        data: { label: 'task' },
      });
    });

    // 关系项目 + 递归一层
    const relatedIds = new Set<string>();
    (relationsQuery.data || []).forEach((r: ProjectRelation) => {
      const otherId = r.projectA === project.id ? r.projectB : r.projectA;
      relatedIds.add(otherId);
      addNode({
        id: otherId,
        type: 'projectNode',
        position: { x: 0, y: 0 },
        data: { entityType: 'project', projectId: otherId, name: otherId.slice(0, 12) },
      });
      const style = getRelationStyle(r.type);
      edges.push({
        id: r.id,
        source: project.id,
        target: otherId,
        type: 'smoothstep',
        label: r.type,
        style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray } as CSSProperties,
        data: { relationType: r.type, label: r.type },
        animated: r.type === 'depends-on',
      });
    });

    // 递归一层：关系项目的 Spec 和任务
    relatedIds.forEach((otherId) => {
      // 关系项目的 Spec
      (allSpecsQuery.data?.project || [])
        .filter((s) => s.filePath.includes(`/projects/${otherId}/`))
        .forEach((s) => {
          const specNodeId = `spec-${otherId}-${s.fileName}`;
          addNode({
            id: specNodeId,
            type: 'specNode',
            position: { x: 0, y: 0 },
            data: {
              entityType: 'spec',
              specId: s.fileName,
              title: s.frontmatter.title || s.fileName,
              scope: 'project',
            },
          });
          edges.push({
            id: `edge-${otherId}-${specNodeId}`,
            source: otherId,
            target: specNodeId,
            type: 'smoothstep',
            label: 'spec',
            style: { stroke: 'var(--text-secondary)', opacity: 0.3 } as CSSProperties,
            data: { label: 'spec' },
          });
        });
      // 关系项目的任务
      (allTasksQuery.data || [])
        .filter((t) => t.projects?.includes(otherId))
        .forEach((t) => {
          addNode({
            id: t.id,
            type: 'taskNode',
            position: { x: 0, y: 0 },
            data: { entityType: 'task', taskId: t.id, title: t.title, status: t.status },
          });
          edges.push({
            id: `edge-${otherId}-${t.id}`,
            source: otherId,
            target: t.id,
            type: 'smoothstep',
            label: 'task',
            style: { stroke: 'var(--text-secondary)', opacity: 0.3 } as CSSProperties,
            data: { label: 'task' },
          });
        });
    });
  }

  const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'LR') : nodes;
  return {
    nodes: layoutedNodes,
    edges,
    isLoading:
      projectQuery.isLoading ||
      specsQuery.isLoading ||
      tasksQuery.isLoading ||
      relationsQuery.isLoading,
  };
}

// ── Spec 视角：所有 spec 列表 ──

export function useSpecGraph(_specId: string | null) {
  const adapter = getAdapter();
  const specsQuery = useQuery({
    queryKey: queryKeys.specs(),
    queryFn: () => adapter.getSpecs(),
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });

  const nodes: LatticeNode[] = [];
  const edges: LatticeEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (node: LatticeNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  // 项目节点
  (projectsQuery.data || []).forEach((p: ProjectMeta) => {
    addNode({
      id: p.id,
      type: 'projectNode',
      position: { x: 0, y: 0 },
      data: {
        entityType: 'project',
        projectId: p.id,
        name: p.name,
        hasGit: !!p.gitRemotes?.length,
      },
    });
  });

  if (specsQuery.data) {
    const allSpecs: (ParsedSpec & { scope: string })[] = [
      ...(specsQuery.data.global || []).map((s: ParsedSpec) => ({ ...s, scope: 'global' })),
      ...(specsQuery.data.user || []).map((s: ParsedSpec) => ({ ...s, scope: 'user' })),
      ...(specsQuery.data.project || []).map((s: ParsedSpec) => ({ ...s, scope: 'project' })),
    ];

    allSpecs.forEach((s) => {
      const id = s.frontmatter.id || s.fileName;
      const specNodeId = `spec-${id}`;
      addNode({
        id: specNodeId,
        type: 'specNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'spec',
          specId: id,
          title: s.frontmatter.title || s.fileName,
          scope: s.scope,
          filePath: s.filePath,
        },
      });
      // 项目级 Spec 连到对应项目
      if (s.scope === 'project') {
        const match = s.filePath.match(/\/projects\/([^/]+)\//);
        if (match) {
          const projectId = match[1];
          if (nodeIds.has(projectId)) {
            edges.push({
              id: `edge-${projectId}-${specNodeId}`,
              source: projectId,
              target: specNodeId,
              type: 'smoothstep',
              label: 'spec',
              style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
              data: { label: 'spec' },
            });
          }
        }
      }
    });
  }

  const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'TB') : nodes;
  return {
    nodes: layoutedNodes,
    edges,
    isLoading: specsQuery.isLoading || projectsQuery.isLoading,
  };
}

// ── Checkpoint 视角：以任务为锚点展开 checkpoint 时间线 ──

export function useCheckpointGraph(taskId: string | null) {
  const adapter = getAdapter();
  const progressQuery = useQuery({
    queryKey: queryKeys.taskProgress(taskId || ''),
    queryFn: () => adapter.getTaskProgress(taskId!),
    enabled: !!taskId,
  });

  const nodes: LatticeNode[] = [];
  const edges: LatticeEdge[] = [];

  if (progressQuery.data && taskId) {
    nodes.push({
      id: taskId,
      type: 'taskNode',
      position: { x: 0, y: 0 },
      data: { entityType: 'task', taskId, title: '任务', status: 'in_progress' },
    });

    progressQuery.data.forEach((cp: CheckpointEntry, i: number) => {
      nodes.push({
        id: cp.id,
        type: 'checkpointNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'checkpoint',
          checkpointId: cp.id,
          title: cp.title,
          checkpointType: cp.type,
          message: cp.message,
          time: cp.time,
          taskId,
        },
      });
      // 线性串联：task → cp1 → cp2 → ... → cpN
      const source = i === 0 ? taskId : progressQuery.data[i - 1].id;
      edges.push({
        id: `${source}-${cp.id}`,
        source,
        target: cp.id,
        type: 'smoothstep',
        data: { label: 'checkpoint' },
      });
    });
  }

  const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'TB') : nodes;
  return { nodes: layoutedNodes, edges, isLoading: progressQuery.isLoading };
}

// ── 实体详情 ──

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

// ── 项目 git 状态 ──

export function useProjectGitStatus(projectId: string | null) {
  const adapter = getAdapter();
  return useQuery({
    queryKey: queryKeys.projectGitStatus(projectId || ''),
    queryFn: () => adapter.getProjectGitStatus(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ── 主题 hook ──

export function useTheme() {
  const { mode } = useSnapshot(themeStore);
  return { mode, toggle: toggleTheme };
}

// ── 键盘快捷键 hook ──

export function useKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K → 聚焦搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('#sidebar-search-input');
        input?.focus();
      }
      // 数字键 1-5 → 切换视角
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[1-5]$/.test(e.key)) {
        const modes: ViewMode[] = ['global', 'task', 'project', 'spec', 'checkpoint'];
        const idx = parseInt(e.key, 10) - 1;
        if (idx < modes.length) {
          canvasStore.viewMode = modes[idx];
        }
      }
      // Esc → 关闭详情面板
      if (e.key === 'Escape') {
        closeDetail();
      }
      // F → 重置画布视口
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        canvasStore.selectedNodeId = null;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

// ── 搜索 hook（带防抖）──

export function useSearch() {
  const { searchKeyword } = useSnapshot(sidebarStore);
  const debouncedKeyword = useDeferredValue(searchKeyword);
  const adapter = getAdapter();
  return useQuery({
    queryKey: queryKeys.search(debouncedKeyword),
    queryFn: () => adapter.search(debouncedKeyword, { limit: 20 }),
    enabled: debouncedKeyword.length > 0,
    staleTime: 30_000,
  });
}

// ── 统计数据 hook ──

export function useStats() {
  const adapter = getAdapter();
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => adapter.getStats(),
    staleTime: 60_000,
  });
}
