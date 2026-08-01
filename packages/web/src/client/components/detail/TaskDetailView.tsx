/**
 * TaskDetailView — 任务详情视图
 *
 * 从 DetailPanel.tsx 拆分：任务标题、状态管理、祖先路径、文档预览、
 * 关联项目/Spec/范围路径/Checkpoint 等板块 Tab。
 */
import {
  Skeleton,
  Empty,
  Tag,
  Button,
  Timeline,
  List,
  Dropdown,
  Tabs,
  Tooltip,
  App as AntdApp,
} from 'antd';
import { DownOutlined, FolderOpenOutlined, CodeOutlined } from '@ant-design/icons';
import { useState, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskMeta, ReferencedSpec, ScopePath, CheckpointEntry } from '@qcqx/lattice-core';
import { getAdapter } from '../../adapters';
import type { EditorApp } from '../../adapters/types';
import { closeDetail, getViewPath, openTerminal } from '../../store';
import {
  formatDate,
  getTaskStatusColor,
  getEntityColor,
  truncate,
  queryKeys,
  getProjectId,
} from '../../lib';
import { EditButton } from '../editor/DocumentEditorModal';
import { CheckpointModal } from '../modals/CheckpointModal';
import { MarkdownWithToc } from './MarkdownWithToc';
import { FilePathBar, editorMenuItems } from './FilePathBar';
import { SearchFilterBar, CHECKPOINT_TYPE_LABELS, getCheckpointTimelineColor } from './shared';

export function TaskDetailView({
  task,
  progress,
}: {
  task: TaskMeta;
  progress: CheckpointEntry[];
}) {
  const navigate = useNavigate();
  const statusColor = getTaskStatusColor(task.status);
  const adapter = getAdapter();
  const prdQuery = useQuery({
    queryKey: ['content', 'prd', task.id],
    queryFn: () => adapter.getContent('prd', task.id),
    enabled: !!task.id,
  });
  const designQuery = useQuery({
    queryKey: ['content', 'design', task.id],
    queryFn: () => adapter.getContent('design', task.id),
    enabled: !!task.id,
  });
  const progressContentQuery = useQuery({
    queryKey: ['content', 'progress', task.id],
    queryFn: () => adapter.getContent('progress', task.id),
    enabled: !!task.id,
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });
  const specsQuery = useQuery({
    queryKey: queryKeys.specs(),
    queryFn: () => adapter.getSpecs(),
  });
  const specTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    const s = specsQuery.data;
    if (s) {
      for (const spec of [...(s.global || []), ...(s.user || []), ...(s.project || [])]) {
        map.set(spec.frontmatter.id || spec.fileName, spec.frontmatter.title || spec.fileName);
      }
    }
    return map;
  }, [specsQuery.data]);
  const lineageQuery = useQuery({
    queryKey: ['lineage', task.id],
    queryFn: () => adapter.getTaskLineage(task.id),
    enabled: !!task.id,
  });
  const lineage = (lineageQuery.data as TaskMeta[] | null) || [];

  const [checkpointOpen, setCheckpointOpen] = useState(false);

  const queryClient = useQueryClient();
  const { message, modal } = AntdApp.useApp();
  const handleStatusChange = async (status: string) => {
    try {
      await adapter.updateTaskStatus(task.id, status);
      message.success(`状态已更新为 ${status}`);
      queryClient.invalidateQueries();
    } catch (err) {
      message.error(`更新失败: ${(err as Error).message}`);
    }
  };
  const handleArchive = () => {
    modal.confirm({
      title: '归档任务',
      content: `确认归档「${task.title}」？`,
      onOk: async () => {
        try {
          await adapter.archiveTask(task.id);
          message.success('已归档');
          queryClient.invalidateQueries();
        } catch (err) {
          message.error(`归档失败: ${(err as Error).message}`);
          throw err;
        }
      },
    });
  };
  const handleDelete = () => {
    modal.confirm({
      title: '删除任务',
      content: `确认删除「${task.title}」？任务将移入垃圾桶，可恢复。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await adapter.deleteTask(task.id);
          message.success('已删除');
          closeDetail();
          queryClient.invalidateQueries();
        } catch (err) {
          message.error(`删除失败: ${(err as Error).message}`);
          throw err;
        }
      },
    });
  };

  const isStringContent = (d: unknown): d is string => typeof d === 'string';
  const docTabs = useMemo(() => {
    const tabs: { key: string; label: string; content: string | null; loading: boolean }[] = [];
    if (prdQuery.isLoading || isStringContent(prdQuery.data))
      tabs.push({
        key: 'prd',
        label: 'PRD',
        content: isStringContent(prdQuery.data) ? prdQuery.data : null,
        loading: prdQuery.isLoading,
      });
    if (designQuery.isLoading || isStringContent(designQuery.data))
      tabs.push({
        key: 'design',
        label: '设计文档',
        content: isStringContent(designQuery.data) ? designQuery.data : null,
        loading: designQuery.isLoading,
      });
    if (progressContentQuery.isLoading || isStringContent(progressContentQuery.data))
      tabs.push({
        key: 'progress',
        label: '进度文件',
        content: isStringContent(progressContentQuery.data) ? progressContentQuery.data : null,
        loading: progressContentQuery.isLoading,
      });
    return tabs;
  }, [
    prdQuery.isLoading,
    prdQuery.data,
    designQuery.isLoading,
    designQuery.data,
    progressContentQuery.isLoading,
    progressContentQuery.data,
  ]);

  const detailTabs = useMemo(() => {
    const items: { key: string; label: string; children: ReactNode }[] = [];
    if (task.projects && task.projects.length > 0) {
      items.push({
        key: 'projects',
        label: `关联项目 (${task.projects.length})`,
        children: (
          <SearchFilterBar
            items={task.projects}
            placeholder='搜索关联项目...'
            getSearchText={(pid: string) => {
              const project = projectsQuery.data?.find(
                (p) => p.ids?.includes(pid) || getProjectId(p) === pid,
              );
              return project?.name || pid;
            }}>
            {(filtered) =>
              filtered.length > 0 ? (
                <List
                  size='small'
                  dataSource={filtered}
                  renderItem={(pid: string) => {
                    const project = projectsQuery.data?.find(
                      (p) => p.ids?.includes(pid) || getProjectId(p) === pid,
                    );
                    const resolvedPid = project ? getProjectId(project) : pid;
                    return (
                      <List.Item
                        className='detail-list-item'
                        onClick={() => navigate(getViewPath('project', resolvedPid))}>
                        <div>
                          <div className='detail-list-item__name'>
                            {project?.name || resolvedPid.slice(0, 12)}
                          </div>
                          <div className='mono detail-list-item__id'>{resolvedPid}</div>
                          {project?.description && (
                            <div className='detail-list-item__desc'>{project.description}</div>
                          )}
                        </div>
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <Empty description='无匹配项目' image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )
            }
          </SearchFilterBar>
        ),
      });
    }
    if (task.referencedSpecs && task.referencedSpecs.length > 0) {
      items.push({
        key: 'specs',
        label: `引用 Spec (${task.referencedSpecs.length})`,
        children: (
          <SearchFilterBar
            items={task.referencedSpecs}
            placeholder='搜索引用 Spec...'
            getSearchText={(ref: ReferencedSpec) => ref.id}
            filterOptions={[...new Set(task.referencedSpecs.map((r) => r.scope))].map((scope) => ({
              value: scope,
              label: scope,
            }))}
            getFilterValue={(ref: ReferencedSpec) => ref.scope}>
            {(filtered) =>
              filtered.length > 0 ? (
                <List
                  size='small'
                  dataSource={filtered}
                  renderItem={(ref: ReferencedSpec) => (
                    <List.Item
                      className='detail-list-item'
                      onClick={() => navigate(getViewPath('spec', ref.id))}>
                      <div className='detail-list-item__relation'>
                        <div className='detail-list-item__row'>
                          <Tag color={getEntityColor('spec')} style={{ fontSize: 10, margin: 0 }}>
                            spec
                          </Tag>
                          <span>{specTitleMap.get(ref.id) || ref.id}</span>
                        </div>
                        <span className='detail-list-item__relation-id mono'>
                          {ref.id} <span className='detail-list-item__scope'>{ref.scope}</span>
                        </span>
                      </div>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description='无匹配 Spec' image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )
            }
          </SearchFilterBar>
        ),
      });
    }
    if (task.scopePaths && task.scopePaths.length > 0) {
      items.push({
        key: 'scopePaths',
        label: `范围路径 (${task.scopePaths.length})`,
        children: (
          <SearchFilterBar
            items={task.scopePaths}
            placeholder='搜索范围路径...'
            getSearchText={(sp: ScopePath) => `${sp.path} ${sp.projectId || ''} ${sp.note || ''}`}>
            {(filtered) =>
              filtered.length > 0 ? (
                <List
                  size='small'
                  dataSource={filtered}
                  renderItem={(sp: ScopePath) => (
                    <List.Item className='detail-list-item' style={{ cursor: 'default' }}>
                      <div style={{ width: '100%' }}>
                        <div className='scope-path__path-row'>
                          <span className='mono scope-path__path' title={sp.path}>
                            {sp.path}
                          </span>
                        </div>
                        <div className='scope-path__actions'>
                          <Dropdown.Button
                            size='small'
                            type='text'
                            icon={<DownOutlined />}
                            onClick={async () => {
                              const adapter = getAdapter();
                              await adapter.openPathByPath(sp.path, 'finder');
                            }}
                            menu={{
                              items: editorMenuItems,
                              onClick: async ({ key }) => {
                                const adapter = getAdapter();
                                await adapter.openPathByPath(sp.path, key as EditorApp);
                              },
                            }}>
                            <FolderOpenOutlined />
                          </Dropdown.Button>
                          <Tooltip title='在内置终端打开'>
                            <Button
                              size='small'
                              type='text'
                              icon={<CodeOutlined />}
                              onClick={() => openTerminal(sp.path)}
                            />
                          </Tooltip>
                          {sp.projectId && (
                            <Tag
                              color={getEntityColor('project')}
                              style={{ fontSize: 10, margin: 0, cursor: 'pointer' }}
                              onClick={() => navigate(getViewPath('project', sp.projectId))}>
                              {truncate(sp.projectId, 16)}
                            </Tag>
                          )}
                          {sp.note && <Tag style={{ fontSize: 10, margin: 0 }}>{sp.note}</Tag>}
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description='无匹配路径' image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )
            }
          </SearchFilterBar>
        ),
      });
    }
    if (docTabs.length > 0) {
      items.push({
        key: 'docs',
        label: '文档预览',
        children: (
          <Tabs
            size='small'
            items={docTabs.map((tab) => ({
              key: tab.key,
              label: tab.label,
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                    <EditButton
                      contentType={tab.key}
                      entityId={task.id}
                      title={tab.label}
                      isYaml={tab.key === 'progress'}
                    />
                  </div>
                  {tab.loading ? (
                    <div className='markdown-body detail-markdown'>
                      <Skeleton active paragraph={{ rows: 4 }} />
                    </div>
                  ) : tab.content ? (
                    <MarkdownWithToc content={tab.content} />
                  ) : (
                    <Empty description='文件为空' image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                </>
              ),
            }))}
          />
        ),
      });
    }
    if (progress && progress.length > 0) {
      items.push({
        key: 'checkpoints',
        label: `Checkpoint (${progress.length})`,
        children: (
          <SearchFilterBar
            items={progress}
            placeholder='搜索 Checkpoint...'
            getSearchText={(cp: CheckpointEntry) => `${cp.title} ${cp.message || ''}`}
            filterOptions={CHECKPOINT_TYPE_LABELS.filter((opt) =>
              progress.some((cp) => cp.type === opt.value),
            )}
            getFilterValue={(cp: CheckpointEntry) => cp.type}>
            {(filtered) =>
              filtered.length > 0 ? (
                <Timeline
                  items={filtered.map((cp: CheckpointEntry) => ({
                    color: getCheckpointTimelineColor(cp.type),
                    children: (
                      <div>
                        <div className='checkpoint-item__title'>{cp.title}</div>
                        <div className='checkpoint-item__meta'>
                          <Tag style={{ fontSize: 10, margin: 0 }}>{cp.type}</Tag>{' '}
                          {formatDate(cp.time)}
                        </div>
                        {cp.message && (
                          <div className='checkpoint-item__message'>
                            {truncate(cp.message, 200)}
                          </div>
                        )}
                      </div>
                    ),
                  }))}
                />
              ) : (
                <Empty description='无匹配 Checkpoint' image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )
            }
          </SearchFilterBar>
        ),
      });
    }
    return items;
  }, [task, progress, docTabs, projectsQuery.data, specTitleMap, navigate]);

  return (
    <>
      <div className='detail-component'>
        <h3 className='detail-component__title'>{task.title}</h3>
        <div className='detail-component__tags'>
          <Tag color={statusColor}>{task.status}</Tag>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'status-planning',
                  label: 'planning',
                  onClick: () => handleStatusChange('planning'),
                },
                {
                  key: 'status-in_progress',
                  label: 'in_progress',
                  onClick: () => handleStatusChange('in_progress'),
                },
                {
                  key: 'status-completed',
                  label: 'completed',
                  onClick: () => handleStatusChange('completed'),
                },
                { type: 'divider' as const },
                {
                  key: 'checkpoint',
                  label: '添加 Checkpoint',
                  onClick: () => setCheckpointOpen(true),
                },
                { type: 'divider' as const },
                { key: 'archive', label: '归档', onClick: handleArchive },
                { key: 'delete', label: '删除', danger: true, onClick: handleDelete },
              ],
            }}>
            <Button size='small' type='text' icon={<DownOutlined />} />
          </Dropdown>
        </div>
        <FilePathBar pathType='task-dir' entityId={task.id} />
        {lineage.length > 1 && (
          <div className='detail-ancestor'>
            <span className='detail-ancestor__label'>祖先路径: </span>
            {lineage.slice(0, -1).map((ancestor: TaskMeta, i: number) => (
              <span key={ancestor.id}>
                <span
                  className='detail-ancestor__link'
                  onClick={() => navigate(getViewPath('task', ancestor.id))}>
                  {truncate(ancestor.title, 20)}
                </span>
                {i < lineage.length - 2 && <span className='detail-ancestor__sep'>›</span>}
              </span>
            ))}
          </div>
        )}
        <div className='detail-component__meta'>
          <div className='mono detail-component__meta-id'>ID: {task.id}</div>
          <div>创建: {formatDate(task.created)}</div>
          {task.updated && <div>更新: {formatDate(task.updated)}</div>}
        </div>
        <div className='detail-component__scroll'>
          <Tabs size='small' className='detail-component__tabs' items={detailTabs} />
        </div>
      </div>
      <CheckpointModal
        open={checkpointOpen}
        onClose={() => setCheckpointOpen(false)}
        taskId={task.id}
      />
    </>
  );
}
