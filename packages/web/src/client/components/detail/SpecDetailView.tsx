/**
 * SpecDetailView — Spec 详情视图
 *
 * 从 DetailPanel.tsx 拆分：Spec 标题、作用域标签、文件路径、
 * Spec 内容预览、关联项目/任务板块 Tab。
 */
import { Empty, Tag, List, Tabs } from 'antd';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { TaskMeta } from '@qcqx/lattice-core';
import { getAdapter } from '../../adapters';
import { getViewPath } from '../../store';
import { getEntityColor, getTaskStatusColor, truncate, queryKeys, getProjectId } from '../../lib';
import type { SpecNodeData } from '../../types/graph';
import { EditButton } from '../editor/DocumentEditorModal';
import { MarkdownWithToc } from './MarkdownWithToc';
import { FilePathBar } from './FilePathBar';
import { SearchFilterBar, TASK_STATUS_OPTIONS } from './shared';

export function SpecDetailView({ data }: { data: SpecNodeData }) {
  const adapter = getAdapter();
  const navigate = useNavigate();
  const title = data.title || '未知';
  const specId = data.specId || '';
  const scope = data.scope || 'project';
  const scopeLabel = scope === 'global' ? '全局级' : scope === 'user' ? '用户级' : '项目级';
  const scopeColor = scope === 'global' ? 'orange' : scope === 'user' ? 'cyan' : 'blue';
  const filePath = data.filePath || null;
  const specsQuery = useQuery({
    queryKey: queryKeys.specs(),
    queryFn: () => adapter.getSpecs(),
  });
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: () => adapter.getTasks(),
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });
  const allSpecs = [
    ...(specsQuery.data?.project || []),
    ...(specsQuery.data?.user || []),
    ...(specsQuery.data?.global || []),
  ];
  const spec = allSpecs.find((s) => s.fileName === specId || s.frontmatter.id === specId);
  const finalFilePath = filePath || spec?.filePath || null;
  const tasks = (tasksQuery.data as TaskMeta[] | undefined) ?? [];

  const relatedTasks = useMemo(
    () => tasks.filter((t) => (t.referencedSpecs || []).some((r) => r.id === specId)),
    [tasks, specId],
  );

  const relatedProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of relatedTasks) {
      for (const pid of t.projects || []) ids.add(pid);
    }
    if (scope === 'project' && finalFilePath) {
      const match = finalFilePath.match(/\/projects\/([^/]+)\//);
      if (match) ids.add(match[1]);
    }
    return Array.from(ids);
  }, [relatedTasks, scope, finalFilePath]);

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsQuery.data || []) map.set(getProjectId(p), p.name);
    return map;
  }, [projectsQuery.data]);

  return (
    <div className='detail-component'>
      <h3 className='detail-component__title'>{title}</h3>
      <div className='detail-component__tags'>
        <Tag color={scopeColor}>{scopeLabel}</Tag>
      </div>
      {finalFilePath && <FilePathBar path={finalFilePath} />}
      <div className='detail-component__meta'>
        <div className='mono detail-component__meta-id'>文件: {specId}</div>
      </div>
      <div className='detail-component__scroll'>
        <Tabs
          size='small'
          className='detail-component__tabs'
          items={[
            {
              key: 'content',
              label: 'Spec 内容',
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                    <EditButton contentType='spec' entityId={specId} title={title} />
                  </div>
                  {spec?.content && <MarkdownWithToc content={spec.content} />}
                </>
              ),
            },
            ...(relatedProjectIds.length > 0
              ? [
                  {
                    key: 'projects',
                    label: `关联项目 (${relatedProjectIds.length})`,
                    children: (
                      <SearchFilterBar
                        items={relatedProjectIds}
                        placeholder='搜索关联项目...'
                        getSearchText={(pid: string) => projectNameMap.get(pid) || pid}>
                        {(filtered) =>
                          filtered.length > 0 ? (
                            <List
                              size='small'
                              dataSource={filtered}
                              renderItem={(pid: string) => (
                                <List.Item
                                  className='detail-list-item'
                                  onClick={() => navigate(getViewPath('project', pid))}>
                                  <div className='detail-list-item__relation'>
                                    <div className='detail-list-item__row'>
                                      <Tag
                                        color={getEntityColor('project')}
                                        style={{ fontSize: 10, margin: 0 }}>
                                        project
                                      </Tag>
                                      <span>{projectNameMap.get(pid) || pid.slice(0, 12)}</span>
                                    </div>
                                    <span className='detail-list-item__relation-id mono'>
                                      {truncate(pid, 24)}
                                    </span>
                                  </div>
                                </List.Item>
                              )}
                            />
                          ) : (
                            <Empty description='无匹配项目' image={Empty.PRESENTED_IMAGE_SIMPLE} />
                          )
                        }
                      </SearchFilterBar>
                    ),
                  },
                ]
              : []),
            ...(relatedTasks.length > 0
              ? [
                  {
                    key: 'tasks',
                    label: `关联任务 (${relatedTasks.length})`,
                    children: (
                      <SearchFilterBar
                        items={relatedTasks}
                        placeholder='搜索关联任务...'
                        getSearchText={(t: TaskMeta) => t.title}
                        filterOptions={TASK_STATUS_OPTIONS}
                        getFilterValue={(t: TaskMeta) => t.status}>
                        {(filtered) =>
                          filtered.length > 0 ? (
                            <List
                              size='small'
                              dataSource={filtered}
                              renderItem={(t: TaskMeta) => (
                                <List.Item
                                  className='detail-list-item'
                                  onClick={() => navigate(getViewPath('task', t.id))}>
                                  <div className='detail-list-item__row'>
                                    <Tag
                                      color={getTaskStatusColor(t.status)}
                                      style={{ fontSize: 10, margin: 0 }}>
                                      {t.status}
                                    </Tag>
                                    <span>{truncate(t.title, 30)}</span>
                                  </div>
                                </List.Item>
                              )}
                            />
                          ) : (
                            <Empty description='无匹配任务' image={Empty.PRESENTED_IMAGE_SIMPLE} />
                          )
                        }
                      </SearchFilterBar>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </div>
  );
}
