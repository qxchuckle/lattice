import { useEffect, useDeferredValue, useMemo, type CSSProperties } from 'react';
import { useSnapshot } from 'valtio';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from './adapters';
import {
  queryKeys,
  layoutGraph,
  getRelationStyle,
  buildIdMap,
  resolvePrimaryId,
  deduplicateProjects,
  getProjectId,
} from './lib';
import {
  canvasStore,
  canvasSearchStore,
  sidebarStore,
  toggleTheme,
  themeStore,
  closeDetail,
  openCanvasSearch,
  closeCanvasSearch,
  type ViewMode,
} from './store';
import type { LatticeNode, LatticeEdge } from './types/graph';
import type {
  ProjectMeta,
  ProjectRelation,
  TaskMeta,
  ParsedSpec,
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
  const { nodes, edges } = useMemo(() => {
    const nodes: LatticeNode[] = [];
    const edges: LatticeEdge[] = [];

    // 多 ID 机制：去重虚拟合并项目 + 构建映射表
    const projects = deduplicateProjects(projectsQuery.data || []);
    const idMap = buildIdMap(projects);

    // 项目节点
    projects.forEach((p: ProjectMeta) => {
      const pid = getProjectId(p);
      if (!pid) return;
      nodes.push({
        id: pid,
        type: 'projectNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'project',
          projectId: pid,
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
          const resolvedSpecPid = resolvePrimaryId(idMap, match[1]);
          // 存储 resolved projectId 供 elements 筛选使用
          (nodes[nodes.length - 1].data as Record<string, unknown>).projectId = resolvedSpecPid;
          edges.push({
            id: `edge-${resolvedSpecPid}-${specNodeId}`,
            source: resolvedSpecPid,
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

    // Spec 覆盖链边：同 fileName 不同 scope 之间建 overrides 边（global → user → project）
    const specsByFileName = new Map<string, Array<{ scope: string; nodeId: string }>>();
    allSpecs.forEach((s) => {
      const specId = s.frontmatter.id || s.fileName;
      const nodeId = specIdToNodeId.get(specId) || `spec-${specId}`;
      const list = specsByFileName.get(s.fileName) || [];
      list.push({ scope: s.scopeLevel, nodeId });
      specsByFileName.set(s.fileName, list);
    });
    const scopeOrder: Record<string, number> = { global: 0, user: 1, project: 2 };
    specsByFileName.forEach((specs) => {
      if (specs.length < 2) return;
      specs.sort((a, b) => (scopeOrder[a.scope] ?? 99) - (scopeOrder[b.scope] ?? 99));
      for (let i = 0; i < specs.length - 1; i++) {
        edges.push({
          id: `edge-overrides-${specs[i].nodeId}-${specs[i + 1].nodeId}`,
          source: specs[i].nodeId,
          target: specs[i + 1].nodeId,
          type: 'smoothstep',
          label: 'overrides',
          style: { stroke: '#FA8C16', opacity: 0.3, strokeDasharray: '4 4' } as CSSProperties,
          data: { label: 'overrides' },
        });
      }
    });

    // 任务节点 + 项目→任务 边 + 父子任务边 + 任务→spec 引用边
    (tasksQuery.data || []).forEach((t: TaskMeta) => {
      nodes.push({
        id: t.id,
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'task',
          taskId: t.id,
          title: t.title,
          status: t.status,
          projectIds: (t.projects || []).map((pid: string) => resolvePrimaryId(idMap, pid)),
        },
      });
      (t.projects || []).forEach((pid: string) => {
        const resolvedPid = resolvePrimaryId(idMap, pid);
        edges.push({
          id: `edge-${resolvedPid}-${t.id}`,
          source: resolvedPid,
          target: t.id,
          type: 'smoothstep',
          label: 'task',
          style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
          data: { label: 'task' },
        });
      });
      // scopePaths 中有 projectId 但不在 task.projects 中的 → 建 scope 边
      const projectSet = new Set(t.projects || []);
      (t.scopePaths || []).forEach((sp) => {
        if (sp.projectId && !projectSet.has(resolvePrimaryId(idMap, sp.projectId))) {
          const resolvedScopePid = resolvePrimaryId(idMap, sp.projectId);
          edges.push({
            id: `edge-scope-${resolvedScopePid}-${t.id}`,
            source: resolvedScopePid,
            target: t.id,
            type: 'smoothstep',
            label: 'scope',
            style: { stroke: '#FA8C16', opacity: 0.3, strokeDasharray: '2 4' } as CSSProperties,
            data: { label: 'scope' },
          });
        }
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
      const relSource = resolvePrimaryId(idMap, r.projectA);
      const relTarget = resolvePrimaryId(idMap, r.projectB);
      edges.push({
        id: r.id,
        source: relSource,
        target: relTarget,
        type: 'smoothstep',
        label: r.type,
        style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray } as CSSProperties,
        data: { relationType: r.type, label: r.type },
        animated: r.type === 'depends-on',
      });
    });

    return { nodes, edges };
  }, [projectsQuery.data, tasksQuery.data, relationsQuery.data, specsQuery.data]);

  return {
    nodes,
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
  const specsQuery = useQuery({
    queryKey: queryKeys.specs(),
    queryFn: () => adapter.getSpecs(),
    enabled: !!taskId,
  });
  const contextQuery = useQuery({
    queryKey: queryKeys.taskContext(taskId || ''),
    queryFn: () => adapter.getTaskContext(taskId!),
    enabled: !!taskId,
  });
  // 获取所有任务（无错点时展示全部，有错点时用于查找子任务）
  const allTasksQuery = useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: () => adapter.getTasks(),
  });
  // 多 ID 机制：获取项目列表用于解析项目名称
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });
  const taskIdMap = buildIdMap(deduplicateProjects(projectsQuery.data || []));
  const taskProjectMap = new Map<string, ProjectMeta>();
  deduplicateProjects(projectsQuery.data || []).forEach((p) => {
    taskProjectMap.set(getProjectId(p), p);
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
      const resolvedPid = resolvePrimaryId(taskIdMap, pid);
      const proj = taskProjectMap.get(resolvedPid);
      nodes.push({
        id: resolvedPid,
        type: 'projectNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'project',
          projectId: resolvedPid,
          name: proj?.name || resolvedPid.slice(0, 12),
        },
      });
      edges.push({
        id: `edge-${task.id}-${resolvedPid}`,
        source: task.id,
        target: resolvedPid,
        type: 'smoothstep',
        label: 'belongs-to',
        style: { stroke: 'var(--text-secondary)', opacity: 0.5 } as CSSProperties,
        data: { label: 'belongs-to' },
      });
    });
    // scopePaths 中有 projectId 但不在 task.projects 中的 → 建 scope 边
    const projectSet = new Set(
      (task.projects || []).map((pid: string) => resolvePrimaryId(taskIdMap, pid)),
    );
    (task.scopePaths || []).forEach((sp) => {
      if (sp.projectId) {
        const resolvedScopePid = resolvePrimaryId(taskIdMap, sp.projectId);
        if (!projectSet.has(resolvedScopePid)) {
          const scopeProj = taskProjectMap.get(resolvedScopePid);
          nodes.push({
            id: resolvedScopePid,
            type: 'projectNode',
            position: { x: 0, y: 0 },
            data: {
              entityType: 'project',
              projectId: resolvedScopePid,
              name: scopeProj?.name || resolvedScopePid.slice(0, 12),
            },
          });
          edges.push({
            id: `edge-scope-${task.id}-${resolvedScopePid}`,
            source: task.id,
            target: resolvedScopePid,
            type: 'smoothstep',
            label: 'scope',
            style: { stroke: '#FA8C16', opacity: 0.3, strokeDasharray: '2 4' } as CSSProperties,
            data: { label: 'scope' },
          });
        }
      }
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

    // 任务引用的 Spec 节点 + Task → Spec 边
    if (specsQuery.data) {
      const allSpecs: (ParsedSpec & { scope: string })[] = [
        ...(specsQuery.data.global || []).map((s: ParsedSpec) => ({ ...s, scope: 'global' })),
        ...(specsQuery.data.user || []).map((s: ParsedSpec) => ({ ...s, scope: 'user' })),
        ...(specsQuery.data.project || []).map((s: ParsedSpec) => ({ ...s, scope: 'project' })),
      ];
      const specIdToNodeId = new Map<string, string>();
      allSpecs.forEach((s) => {
        const id = s.frontmatter.id || s.fileName;
        const specNodeId = `spec-${id}`;
        specIdToNodeId.set(id, specNodeId);
        specIdToNodeId.set(s.fileName, specNodeId);
      });
      (task.referencedSpecs || []).forEach((ref: ReferencedSpec) => {
        const specNodeId = specIdToNodeId.get(ref.id);
        if (!specNodeId) return;
        const spec = allSpecs.find((s) => (s.frontmatter.id || s.fileName) === ref.id);
        if (!spec) return;
        nodes.push({
          id: specNodeId,
          type: 'specNode',
          position: { x: 0, y: 0 },
          data: {
            entityType: 'spec',
            specId: ref.id,
            title: spec.frontmatter.title || spec.fileName,
            scope: spec.scope,
            filePath: spec.filePath,
          },
        });
        edges.push({
          id: `edge-spec-${task.id}-${ref.id}`,
          source: task.id,
          target: specNodeId,
          type: 'smoothstep',
          label: 'ref-spec',
          style: { stroke: '#13C2C2', opacity: 0.4 } as CSSProperties,
          data: { label: 'ref-spec' },
        });
      });
    }

    // 语义关联 Spec（RAG 语义搜索）+ Task → Spec semantic 边
    if (contextQuery.data) {
      const nodeIdsInGraph = new Set(nodes.map((n) => n.id));
      contextQuery.data.semanticSpecs.forEach((s: ParsedSpec) => {
        const specId = s.frontmatter.id || s.fileName;
        const specNodeId = `spec-${specId}`;
        if (!nodeIdsInGraph.has(specNodeId)) {
          nodes.push({
            id: specNodeId,
            type: 'specNode',
            position: { x: 0, y: 0 },
            data: {
              entityType: 'spec',
              specId,
              title: s.frontmatter.title || s.fileName,
              scope: s.filePath.includes('/global/')
                ? 'global'
                : s.filePath.includes('/user/')
                  ? 'user'
                  : 'project',
              filePath: s.filePath,
            },
          });
        }
        edges.push({
          id: `edge-semantic-${task.id}-${specId}`,
          source: task.id,
          target: specNodeId,
          type: 'smoothstep',
          label: 'semantic',
          style: { stroke: '#EB2F96', opacity: 0.3, strokeDasharray: '8 4' } as CSSProperties,
          data: { label: 'semantic' },
        });
      });
    }

    // 子任务 + Parent → Child 边
    (allTasksQuery.data || [])
      .filter((t) => t.parentTaskId === task.id)
      .forEach((t: TaskMeta) => {
        nodes.push({
          id: t.id,
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: { entityType: 'task', taskId: t.id, title: t.title, status: t.status },
        });
        edges.push({
          id: `edge-parent-${task.id}-${t.id}`,
          source: task.id,
          target: t.id,
          type: 'smoothstep',
          label: 'parent',
          style: { stroke: 'var(--brand-color)', opacity: 0.4 } as CSSProperties,
          data: { label: 'parent' },
        });
      });
  }

  const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'LR') : nodes;
  return {
    nodes: layoutedNodes,
    edges,
    isLoading:
      taskQuery.isLoading ||
      specsQuery.isLoading ||
      allTasksQuery.isLoading ||
      contextQuery.isLoading,
  };
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
    queryKey: queryKeys.specs(),
    queryFn: () => adapter.getSpecs(),
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

  // 多 ID 机制：构建映射表
  const allProjects = deduplicateProjects(allProjectsQuery.data || []);
  const idMap = buildIdMap(allProjects);

  const addNode = (node: LatticeNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  // 无锚点模式：展示所有项目 + 关系
  if (!projectId) {
    allProjects.forEach((p: ProjectMeta) => {
      const pid = getProjectId(p);
      if (!pid) return;
      addNode({
        id: pid,
        type: 'projectNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'project',
          projectId: pid,
          name: p.name,
          hasGit: !!p.gitRemotes?.length,
        },
      });
    });
    (allRelationsQuery.data || []).forEach((r: ProjectRelation) => {
      const style = getRelationStyle(r.type);
      const sourceId = resolvePrimaryId(idMap, r.projectA);
      const targetId = resolvePrimaryId(idMap, r.projectB);
      edges.push({
        id: r.id,
        source: sourceId,
        target: targetId,
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
    const projectIdResolved = getProjectId(project);
    // 中心项目节点
    addNode({
      id: projectIdResolved,
      type: 'projectNode',
      position: { x: 0, y: 0 },
      data: {
        entityType: 'project',
        projectId: projectIdResolved,
        name: project.name,
        hasGit: !!project.gitRemotes?.length,
      },
    });

    // 项目的 Spec
    const specIdToNodeId = new Map<string, string>();
    (specsQuery.data || []).forEach((s: ParsedSpec) => {
      const specNodeId = `spec-${projectIdResolved}-${s.fileName}`;
      const specId = s.frontmatter.id || s.fileName;
      specIdToNodeId.set(specId, specNodeId);
      specIdToNodeId.set(s.fileName, specNodeId);
      addNode({
        id: specNodeId,
        type: 'specNode',
        position: { x: 0, y: 0 },
        data: {
          entityType: 'spec',
          specId: s.fileName,
          title: s.frontmatter.title || s.fileName,
          scope: 'project',
          filePath: s.filePath,
        },
      });
      edges.push({
        id: `edge-${projectIdResolved}-${specNodeId}`,
        source: projectIdResolved,
        target: specNodeId,
        type: 'smoothstep',
        label: 'spec',
        style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
        data: { label: 'spec' },
      });
    });

    // 补充：任务引用的用户级/全局级 spec 也加入图
    const referencedSpecIds = new Set<string>();
    (tasksQuery.data || []).forEach((t: TaskMeta) => {
      (t.referencedSpecs || []).forEach((ref: ReferencedSpec) => {
        referencedSpecIds.add(ref.id);
      });
    });
    const allSpecsResult = allSpecsQuery.data;
    if (allSpecsResult) {
      const addExternalSpec = (s: ParsedSpec, scopeLevel: string) => {
        const specId = s.frontmatter.id || s.fileName;
        if (!referencedSpecIds.has(specId) || specIdToNodeId.has(specId)) return;
        const specNodeId = `spec-${scopeLevel}-${specId}`;
        specIdToNodeId.set(specId, specNodeId);
        specIdToNodeId.set(s.fileName, specNodeId);
        addNode({
          id: specNodeId,
          type: 'specNode',
          position: { x: 0, y: 0 },
          data: {
            entityType: 'spec',
            specId,
            title: s.frontmatter.title || s.fileName,
            scope: scopeLevel,
            filePath: s.filePath,
          },
        });
      };
      (allSpecsResult.user || []).forEach((s) => addExternalSpec(s, 'user'));
      (allSpecsResult.global || []).forEach((s) => addExternalSpec(s, 'global'));
    }

    // Spec 覆盖链边：同 fileName 不同 scope 间建 overrides 边
    const specsInGraphProj: Array<{ fileName: string; scope: string; nodeId: string }> = [];
    (specsQuery.data || []).forEach((s: ParsedSpec) => {
      const nodeId = specIdToNodeId.get(s.fileName);
      if (nodeId) specsInGraphProj.push({ fileName: s.fileName, scope: 'project', nodeId });
    });
    if (allSpecsResult) {
      (allSpecsResult.user || []).forEach((s) => {
        const specId = s.frontmatter.id || s.fileName;
        const nodeId = specIdToNodeId.get(specId);
        if (nodeId && nodeId.startsWith('spec-user-'))
          specsInGraphProj.push({ fileName: s.fileName, scope: 'user', nodeId });
      });
      (allSpecsResult.global || []).forEach((s) => {
        const specId = s.frontmatter.id || s.fileName;
        const nodeId = specIdToNodeId.get(specId);
        if (nodeId && nodeId.startsWith('spec-global-'))
          specsInGraphProj.push({ fileName: s.fileName, scope: 'global', nodeId });
      });
    }
    const specsByFileNameProj = new Map<string, typeof specsInGraphProj>();
    specsInGraphProj.forEach((s) => {
      const list = specsByFileNameProj.get(s.fileName) || [];
      list.push(s);
      specsByFileNameProj.set(s.fileName, list);
    });
    const scopeOrderProj: Record<string, number> = { global: 0, user: 1, project: 2 };
    specsByFileNameProj.forEach((specs) => {
      if (specs.length < 2) return;
      specs.sort((a, b) => (scopeOrderProj[a.scope] ?? 99) - (scopeOrderProj[b.scope] ?? 99));
      for (let i = 0; i < specs.length - 1; i++) {
        edges.push({
          id: `edge-overrides-${specs[i].nodeId}-${specs[i + 1].nodeId}`,
          source: specs[i].nodeId,
          target: specs[i + 1].nodeId,
          type: 'smoothstep',
          label: 'overrides',
          style: { stroke: '#FA8C16', opacity: 0.3, strokeDasharray: '4 4' } as CSSProperties,
          data: { label: 'overrides' },
        });
      }
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
        id: `edge-${projectIdResolved}-${t.id}`,
        source: projectIdResolved,
        target: t.id,
        type: 'smoothstep',
        label: 'task',
        style: { stroke: 'var(--text-secondary)', opacity: 0.4 } as CSSProperties,
        data: { label: 'task' },
      });
      // Task → Spec 引用边
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
      // Parent → Child task 边
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
    });

    // 补充：scopePaths 指向本项目的任务（但不在 task.projects 中）
    const taskIdsInGraph = new Set<string>();
    (tasksQuery.data || []).forEach((t) => taskIdsInGraph.add(t.id));
    (allTasksQuery.data || [])
      .filter(
        (t) =>
          !taskIdsInGraph.has(t.id) &&
          (t.scopePaths || []).some(
            (sp) => resolvePrimaryId(idMap, sp.projectId || '') === projectIdResolved,
          ),
      )
      .forEach((t: TaskMeta) => {
        addNode({
          id: t.id,
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: { entityType: 'task', taskId: t.id, title: t.title, status: t.status },
        });
        edges.push({
          id: `edge-scope-${projectIdResolved}-${t.id}`,
          source: projectIdResolved,
          target: t.id,
          type: 'smoothstep',
          label: 'scope',
          style: { stroke: '#FA8C16', opacity: 0.3, strokeDasharray: '2 4' } as CSSProperties,
          data: { label: 'scope' },
        });
        // Task → Spec 引用边
        (t.referencedSpecs || []).forEach((ref: ReferencedSpec) => {
          const specNodeId = specIdToNodeId.get(ref.id);
          if (specNodeId) {
            edges.push({
              id: `edge-spec-${t.id}-${ref.id}`,
              source: t.id,
              target: specNodeId,
              type: 'smoothstep',
              label: 'ref-spec',
              style: { stroke: '#13C2C2', opacity: 0.3 } as CSSProperties,
              data: { label: 'ref-spec' },
            });
          }
        });
        // Parent → Child 边
        if (t.parentTaskId) {
          edges.push({
            id: `edge-parent-${t.parentTaskId}-${t.id}`,
            source: t.parentTaskId,
            target: t.id,
            type: 'smoothstep',
            label: 'parent',
            style: { stroke: 'var(--brand-color)', opacity: 0.3 } as CSSProperties,
            data: { label: 'parent' },
          });
        }
      });

    // 关系项目 + 递归一层
    const relatedIds = new Set<string>();
    (relationsQuery.data || []).forEach((r: ProjectRelation) => {
      const resolvedA = resolvePrimaryId(idMap, r.projectA);
      const resolvedB = resolvePrimaryId(idMap, r.projectB);
      const otherId = resolvedA === projectIdResolved ? resolvedB : resolvedA;
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
        source: projectIdResolved,
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
      // 关系项目的 Spec（同时注册到 specIdToNodeId 供任务引用查找）
      (allSpecsQuery.data?.project || [])
        .filter((s) => s.filePath.includes(`/projects/${otherId}/`))
        .forEach((s) => {
          const specNodeId = `spec-${otherId}-${s.fileName}`;
          const specId = s.frontmatter.id || s.fileName;
          specIdToNodeId.set(specId, specNodeId);
          specIdToNodeId.set(s.fileName, specNodeId);
          addNode({
            id: specNodeId,
            type: 'specNode',
            position: { x: 0, y: 0 },
            data: {
              entityType: 'spec',
              specId: s.frontmatter.id || s.fileName,
              title: s.frontmatter.title || s.fileName,
              scope: 'project',
              filePath: s.filePath,
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
      // 关系项目的任务（含 scopePaths 指向关系项目的）
      (allTasksQuery.data || [])
        .filter(
          (t) =>
            (t.projects || []).some((pid) => resolvePrimaryId(idMap, pid) === otherId) ||
            (t.scopePaths || []).some(
              (sp) => resolvePrimaryId(idMap, sp.projectId || '') === otherId,
            ),
        )
        .forEach((t) => {
          addNode({
            id: t.id,
            type: 'taskNode',
            position: { x: 0, y: 0 },
            data: { entityType: 'task', taskId: t.id, title: t.title, status: t.status },
          });
          const isFormal = (t.projects || []).some(
            (pid) => resolvePrimaryId(idMap, pid) === otherId,
          );
          edges.push({
            id: `edge-${otherId}-${t.id}`,
            source: otherId,
            target: t.id,
            type: 'smoothstep',
            label: isFormal ? 'task' : 'scope',
            style: isFormal
              ? ({ stroke: 'var(--text-secondary)', opacity: 0.3 } as CSSProperties)
              : ({ stroke: '#FA8C16', opacity: 0.3, strokeDasharray: '2 4' } as CSSProperties),
            data: { label: isFormal ? 'task' : 'scope' },
          });
          // Task → Spec 引用边
          (t.referencedSpecs || []).forEach((ref: ReferencedSpec) => {
            const specNodeId = specIdToNodeId.get(ref.id);
            if (specNodeId) {
              edges.push({
                id: `edge-spec-${t.id}-${ref.id}`,
                source: t.id,
                target: specNodeId,
                type: 'smoothstep',
                label: 'ref-spec',
                style: { stroke: '#13C2C2', opacity: 0.3 } as CSSProperties,
                data: { label: 'ref-spec' },
              });
            }
          });
          // Parent → Child 边
          if (t.parentTaskId) {
            edges.push({
              id: `edge-parent-${t.parentTaskId}-${t.id}`,
              source: t.parentTaskId,
              target: t.id,
              type: 'smoothstep',
              label: 'parent',
              style: { stroke: 'var(--brand-color)', opacity: 0.3 } as CSSProperties,
              data: { label: 'parent' },
            });
          }
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
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: () => adapter.getTasks(),
  });
  const relationsQuery = useQuery({
    queryKey: queryKeys.relations,
    queryFn: () => adapter.getRelations(),
  });

  const nodes: LatticeNode[] = [];
  const edges: LatticeEdge[] = [];
  const nodeIds = new Set<string>();

  // 多 ID 机制：去重 + 映射表
  const projects = deduplicateProjects(projectsQuery.data || []);
  const idMap = buildIdMap(projects);

  const addNode = (node: LatticeNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  // 项目节点
  projects.forEach((p: ProjectMeta) => {
    const pid = getProjectId(p);
    if (!pid) return;
    addNode({
      id: pid,
      type: 'projectNode',
      position: { x: 0, y: 0 },
      data: {
        entityType: 'project',
        projectId: pid,
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

    // 构建 specId → nodeId 映射
    const specIdToNodeId = new Map<string, string>();

    allSpecs.forEach((s) => {
      const id = s.frontmatter.id || s.fileName;
      const specNodeId = `spec-${id}`;
      specIdToNodeId.set(id, specNodeId);
      specIdToNodeId.set(s.fileName, specNodeId);
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
          const resolvedPid = resolvePrimaryId(idMap, match[1]);
          // 存储 resolved projectId 供 elements 筛选使用
          (nodes[nodes.length - 1].data as Record<string, unknown>).projectId = resolvedPid;
          if (nodeIds.has(resolvedPid)) {
            edges.push({
              id: `edge-${resolvedPid}-${specNodeId}`,
              source: resolvedPid,
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

    // Spec 覆盖链边：同 fileName 不同 scope 之间建 overrides 边（global → user → project）
    const specsByFileName = new Map<string, Array<{ scope: string; nodeId: string }>>();
    allSpecs.forEach((s) => {
      const id = s.frontmatter.id || s.fileName;
      const nodeId = specIdToNodeId.get(id) || `spec-${id}`;
      const list = specsByFileName.get(s.fileName) || [];
      list.push({ scope: s.scope, nodeId });
      specsByFileName.set(s.fileName, list);
    });
    const scopeOrder: Record<string, number> = { global: 0, user: 1, project: 2 };
    specsByFileName.forEach((specs) => {
      if (specs.length < 2) return;
      specs.sort((a, b) => (scopeOrder[a.scope] ?? 99) - (scopeOrder[b.scope] ?? 99));
      for (let i = 0; i < specs.length - 1; i++) {
        edges.push({
          id: `edge-overrides-${specs[i].nodeId}-${specs[i + 1].nodeId}`,
          source: specs[i].nodeId,
          target: specs[i + 1].nodeId,
          type: 'smoothstep',
          label: 'overrides',
          style: { stroke: '#FA8C16', opacity: 0.3, strokeDasharray: '4 4' } as CSSProperties,
          data: { label: 'overrides' },
        });
      }
    });

    // 任务节点 + Task → Spec 引用边 + Project → Task 边 + Parent → Child 边
    const tasksInGraph = new Set<string>();
    (tasksQuery.data || []).forEach((t: TaskMeta) => {
      const hasSpecRef = (t.referencedSpecs || []).some((ref) => specIdToNodeId.has(ref.id));
      if (!hasSpecRef) return;
      addNode({
        id: t.id,
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: { entityType: 'task', taskId: t.id, title: t.title, status: t.status },
      });
      tasksInGraph.add(t.id);
      // Task → Spec 引用边
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
      // Project → Task 边
      (t.projects || []).forEach((pid: string) => {
        const resolvedTaskPid = resolvePrimaryId(idMap, pid);
        if (nodeIds.has(resolvedTaskPid)) {
          edges.push({
            id: `edge-task-${resolvedTaskPid}-${t.id}`,
            source: resolvedTaskPid,
            target: t.id,
            type: 'smoothstep',
            label: 'task',
            style: { stroke: 'var(--text-secondary)', opacity: 0.3 } as CSSProperties,
            data: { label: 'task' },
          });
        }
      });
    });
    // Parent → Child 边（父任务可能不在图中，需补充）
    (tasksQuery.data || []).forEach((t: TaskMeta) => {
      if (!t.parentTaskId || !tasksInGraph.has(t.id)) return;
      if (!tasksInGraph.has(t.parentTaskId)) {
        // 父任务不在图中，补充添加
        const parentTask = (tasksQuery.data || []).find((x) => x.id === t.parentTaskId);
        if (parentTask) {
          addNode({
            id: parentTask.id,
            type: 'taskNode',
            position: { x: 0, y: 0 },
            data: {
              entityType: 'task',
              taskId: parentTask.id,
              title: parentTask.title,
              status: parentTask.status,
            },
          });
          tasksInGraph.add(parentTask.id);
        }
      }
      if (tasksInGraph.has(t.parentTaskId)) {
        edges.push({
          id: `edge-parent-${t.parentTaskId}-${t.id}`,
          source: t.parentTaskId,
          target: t.id,
          type: 'smoothstep',
          label: 'parent',
          style: { stroke: 'var(--brand-color)', opacity: 0.3 } as CSSProperties,
          data: { label: 'parent' },
        });
      }
    });
  }

  // 项目↔项目 关系边
  (relationsQuery.data || []).forEach((r: ProjectRelation) => {
    const resolvedA = resolvePrimaryId(idMap, r.projectA);
    const resolvedB = resolvePrimaryId(idMap, r.projectB);
    if (nodeIds.has(resolvedA) && nodeIds.has(resolvedB)) {
      const style = getRelationStyle(r.type);
      edges.push({
        id: r.id,
        source: resolvedA,
        target: resolvedB,
        type: 'smoothstep',
        label: r.type,
        style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray } as CSSProperties,
        data: { relationType: r.type, label: r.type },
        animated: r.type === 'depends-on',
      });
    }
  });

  const layoutedNodes = nodes.length > 0 ? layoutGraph(nodes, edges, 'TB') : nodes;
  return {
    nodes: layoutedNodes,
    edges,
    isLoading:
      specsQuery.isLoading ||
      projectsQuery.isLoading ||
      tasksQuery.isLoading ||
      relationsQuery.isLoading,
  };
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
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Cmd/Ctrl + F → 打开画布搜索（阻止浏览器原生查找）
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        if (canvasSearchStore.open) {
          document.querySelector<HTMLInputElement>('#canvas-search-input')?.focus();
        } else {
          openCanvasSearch();
        }
        return;
      }

      // Cmd/Ctrl + K → 聚焦搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('#sidebar-search-input');
        input?.focus();
        return;
      }

      // 输入框聚焦时不触发以下非修饰键快捷键
      if (isInputFocused) return;

      // 数字键 1-4 → 切换视角
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[1-4]$/.test(e.key)) {
        const modes: ViewMode[] = ['global', 'task', 'project', 'spec'];
        const idx = parseInt(e.key, 10) - 1;
        if (idx < modes.length) {
          canvasStore.viewMode = modes[idx];
        }
      }
      // Esc → 关闭画布搜索或详情面板
      if (e.key === 'Escape') {
        if (canvasSearchStore.open) {
          closeCanvasSearch();
        } else {
          closeDetail();
        }
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

// ── 搜索 hook（带防抖 + 筛选）──

export function useSearch() {
  const { searchKeyword, searchFilters } = useSnapshot(sidebarStore);
  const debouncedKeyword = useDeferredValue(searchKeyword);
  const adapter = getAdapter();
  const hasStatusOrScopeFilter =
    searchFilters.taskStatus.length > 0 || searchFilters.specScope.length > 0;
  const searchType = searchFilters.type === 'all' ? undefined : searchFilters.type;
  return useQuery({
    queryKey: queryKeys.search(debouncedKeyword, searchFilters.type),
    queryFn: () =>
      adapter.search(debouncedKeyword, {
        type: searchType,
        limit: hasStatusOrScopeFilter ? 50 : 20,
      }),
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
