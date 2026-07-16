import {
  Skeleton,
  Empty,
  Tag,
  Button,
  Timeline,
  List,
  Dropdown,
  App as AntdApp,
  Tooltip,
  Modal,
  Radio,
  Tabs,
} from 'antd';
import {
  FolderOpenOutlined,
  CloseOutlined,
  ReloadOutlined,
  DownOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CopyOutlined,
  AimOutlined,
  MenuFoldOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import type { ReferencedSpec, ScopePath } from '@qcqx/lattice-core';
import {
  useState,
  useRef as useReactRef,
  useMemo,
  memo,
  isValidElement,
  createElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import { useSnapshot } from 'valtio';
import { useNavigate } from 'react-router';
import { detailStore, closeDetail, getViewPath, locateNode, toggleDetailCollapse } from '../store';
import { useEntityDetail } from '../hooks';
import { getAdapter } from '../adapters';
import {
  formatDate,
  getTaskStatusColor,
  getEntityColor,
  truncate,
  queryKeys,
  getProjectId,
} from '../lib';
import type { EditorApp } from '../adapters/types';
import type {
  TaskMeta,
  ProjectMeta,
  ProjectRelation,
  CheckpointEntry,
  GitStatus,
  ParsedSpec,
} from '@qcqx/lattice-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { EditButton } from './editor/DocumentEditorModal';
import { CheckpointModal } from './modals/CheckpointModal';
import './DetailPanel.less';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';

// ── Markdown 目录（TOC）组件 ──

function slugifyToc(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'heading'
  );
}

function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractTocHeadings(markdown: string): { level: number; text: string; id: string }[] {
  const headings: { level: number; text: string; id: string }[] = [];
  const usedIds = new Map<string, number>();
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (!match) continue;
    const level = match[1].length;
    const text = stripMarkdownSyntax(match[2].trim());
    let id = slugifyToc(text);
    const count = usedIds.get(id) || 0;
    if (count > 0) id = `${id}-${count + 1}`;
    usedIds.set(id, count + 1);
    headings.push({ level, text, id });
  }
  return headings;
}

function getTextFromNode(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextFromNode).join('');
  if (isValidElement(node))
    return getTextFromNode((node.props as { children?: ReactNode }).children);
  return '';
}

const tocHeadingComponents: Record<
  string,
  (props: { children?: ReactNode; [k: string]: unknown }) => ReactElement
> = {};
for (let level = 1; level <= 6; level++) {
  const tag = `h${level}`;
  tocHeadingComponents[tag] = ({ children, ...props }) => {
    const id = slugifyToc(getTextFromNode(children));
    return createElement(tag, { ...props, id, 'data-toc-id': id }, children);
  };
}

const MarkdownWithToc = memo(function MarkdownWithToc({ content }: { content: string }) {
  const containerRef = useReactRef<HTMLDivElement>(null);
  const headings = useMemo(() => extractTocHeadings(content), [content]);
  const [tocOpen, setTocOpen] = useState(false);

  const scrollToHeading = (id: string) => {
    const el = containerRef.current?.querySelector(`[data-toc-id="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTocOpen(false);
  };

  return (
    <div className='markdown-toc-container' ref={containerRef}>
      <div className='markdown-body detail-markdown'>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeHighlight]}
          components={tocHeadingComponents}>
          {content}
        </ReactMarkdown>
      </div>
      {headings.length >= 2 && (
        <div className='markdown-toc-float'>
          {tocOpen && (
            <div className='markdown-toc-float__panel'>
              <div className='markdown-toc-float__header'>
                <span>目录</span>
                <Tag color='blue' style={{ fontSize: 10, margin: 0 }}>
                  {headings.length}
                </Tag>
              </div>
              <div className='markdown-toc-float__list'>
                {headings.map((h, i) => (
                  <a
                    key={i}
                    className={`markdown-toc-float__item markdown-toc-float__item--level-${Math.min(h.level, 4)}`}
                    title={h.text}
                    onClick={() => scrollToHeading(h.id)}>
                    {h.text}
                  </a>
                ))}
              </div>
            </div>
          )}
          <Button
            type='primary'
            shape='circle'
            size='small'
            icon={<MenuOutlined />}
            className={`markdown-toc-float__btn${tocOpen ? ' markdown-toc-float__btn--active' : ''}`}
            onClick={() => setTocOpen(!tocOpen)}
          />
        </div>
      )}
    </div>
  );
});

// ── 文件路径获取 hook ──

function useFilePath(pathType: string | null | undefined, id: string | null | undefined) {
  return useQuery({
    queryKey: ['path', pathType, id],
    queryFn: async () => {
      if (!pathType || !id) return null;
      const res = await fetch(`/api/paths/${pathType}/${id}`);
      const data = (await res.json()) as { path?: string; error?: string };
      return data.path || null;
    },
    enabled: !!pathType && !!id,
    staleTime: 60_000,
  });
}

// ── 文件路径栏组件 ──

function FilePathBar({
  path,
  pathType,
  entityId,
}: {
  path?: string | null;
  pathType?: string | null;
  entityId?: string | null;
}) {
  const { message } = AntdApp.useApp();
  const pathQuery = useFilePath(path ? null : pathType, path ? null : entityId);
  const finalPath = path ?? pathQuery.data ?? null;

  if (!finalPath) return null;

  const handleOpen = async (app: EditorApp) => {
    const adapter = getAdapter();
    const success = await adapter.openPath(finalPath, app);
    if (!success) {
      message.warning(`无法用 ${app} 打开`);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(finalPath).then(() => {
      message.success('已复制路径');
    });
  };

  return (
    <div className='file-path-bar'>
      <span className='mono file-path-bar__text' title={finalPath}>
        {finalPath}
      </span>
      <Button size='small' type='text' icon={<CopyOutlined />} onClick={handleCopy} />
      <Dropdown.Button
        size='small'
        type='text'
        icon={<DownOutlined />}
        onClick={() => handleOpen('finder')}
        menu={{
          items: editorMenuItems,
          onClick: ({ key }) => handleOpen(key as EditorApp),
        }}>
        <FolderOpenOutlined />
      </Dropdown.Button>
    </div>
  );
}

const editorMenuItems = [
  { key: 'finder', label: '系统文件管理器' },
  { key: 'vscode', label: 'VSCode' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'qoder', label: 'Qoder' },
];

// ── 任务详情 ──

function TaskDetail({ task, progress }: { task: TaskMeta; progress: CheckpointEntry[] }) {
  const navigate = useNavigate();
  const statusColor = getTaskStatusColor(task.status);
  const adapter = getAdapter();
  // 获取所有文档内容
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
  // 获取所有项目以查找关联项目名称
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => adapter.getProjects(),
  });
  // 祖先路径
  const lineageQuery = useQuery({
    queryKey: ['lineage', task.id],
    queryFn: () => adapter.getTaskLineage(task.id),
    enabled: !!task.id,
  });
  const lineage = (lineageQuery.data as TaskMeta[] | null) || [];

  const [checkpointOpen, setCheckpointOpen] = useState(false);

  // ── 任务管理操作 ──
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

  // 构建文档 tab 列表
  // 服务端成功返回 { content: string }，文件不存在返回 { error: 'not_found' }
  // adapter 已将成功映射为 string、失败映射为 null
  const isStringContent = (d: unknown): d is string => typeof d === 'string';
  const docTabs = useMemo(() => {
    const tabs: { key: string; label: string; content: string | null; loading: boolean }[] = [];
    // loading 中也显示 tab（展示骨架），内容就绪后切换为 markdown 预览
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

  // 构建详情板块 tabs
  const detailTabs = useMemo(() => {
    const items: { key: string; label: string; children: ReactNode }[] = [];
    if (task.projects && task.projects.length > 0) {
      items.push({
        key: 'projects',
        label: `关联项目 (${task.projects.length})`,
        children: (
          <List
            size='small'
            dataSource={task.projects}
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
        ),
      });
    }
    if (task.referencedSpecs && task.referencedSpecs.length > 0) {
      items.push({
        key: 'specs',
        label: `引用 Spec (${task.referencedSpecs.length})`,
        children: (
          <List
            size='small'
            dataSource={task.referencedSpecs}
            renderItem={(ref: ReferencedSpec) => (
              <List.Item
                className='detail-list-item'
                onClick={() => navigate(getViewPath('spec', ref.id))}>
                <div className='detail-list-item__row'>
                  <Tag color={getEntityColor('spec')} style={{ fontSize: 10, margin: 0 }}>
                    spec
                  </Tag>
                  <span className='mono detail-list-item__id-mono'>{ref.id}</span>
                  <span className='detail-list-item__scope'>{ref.scope}</span>
                </div>
              </List.Item>
            )}
          />
        ),
      });
    }
    if (task.scopePaths && task.scopePaths.length > 0) {
      items.push({
        key: 'scopePaths',
        label: `范围路径 (${task.scopePaths.length})`,
        children: (
          <List
            size='small'
            dataSource={task.scopePaths}
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
                        await adapter.openPath(sp.path, 'finder');
                      }}
                      menu={{
                        items: editorMenuItems,
                        onClick: async ({ key }) => {
                          const adapter = getAdapter();
                          await adapter.openPath(sp.path, key as EditorApp);
                        },
                      }}>
                      <FolderOpenOutlined />
                    </Dropdown.Button>
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
          <Timeline
            items={progress.map((cp: CheckpointEntry) => ({
              color: getCheckpointTimelineColor(cp.type),
              children: (
                <div>
                  <div className='checkpoint-item__title'>{cp.title}</div>
                  <div className='checkpoint-item__meta'>
                    <Tag style={{ fontSize: 10, margin: 0 }}>{cp.type}</Tag> {formatDate(cp.time)}
                  </div>
                  {cp.message && (
                    <div className='checkpoint-item__message'>{truncate(cp.message, 200)}</div>
                  )}
                </div>
              ),
            }))}
          />
        ),
      });
    }
    return items;
  }, [task, progress, docTabs, projectsQuery.data, navigate]);

  return (
    <>
      <div className='detail-component'>
        {/* 固定头部 */}
        <h3 className='detail-component__title'>{task.title}</h3>
        <div className='detail-component__tags'>
          <Tag color={statusColor}>{task.status}</Tag>
          <Dropdown.Button
            size='small'
            type='text'
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
                {
                  key: 'archive',
                  label: '归档',
                  onClick: handleArchive,
                },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  onClick: handleDelete,
                },
              ],
            }}>
            <DownOutlined />
          </Dropdown.Button>
        </div>
        <FilePathBar pathType='task-dir' entityId={task.id} />
        {/* 祖先路径 */}
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

        {/* 板块 Tab 切换 */}
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

function getCheckpointTimelineColor(type: string): string {
  const colors: Record<string, string> = {
    decision: 'gold',
    issue: 'red',
    pivot: 'purple',
    milestone: 'green',
    note: 'gray',
    context: 'blue',
    correction: 'red',
    constraint: 'orange',
    assumption: 'gold',
    followup: 'cyan',
    summary: 'purple',
  };
  return colors[type] || 'gray';
}

// ── 项目详情 ──

function ProjectDetail({
  project,
  gitStatus,
  specs,
  tasks,
  relations,
}: {
  project: ProjectMeta | null;
  gitStatus: GitStatus | null;
  specs: ParsedSpec[];
  tasks: TaskMeta[];
  relations: ProjectRelation[];
}) {
  const navigate = useNavigate();
  if (!project) {
    return <Empty description='项目不存在' image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className='detail-component'>
      <h3 className='detail-component__title'>{project.name}</h3>

      {project.description && (
        <p className='detail-component__meta' style={{ marginBottom: 8 }}>
          {project.description}
        </p>
      )}

      <ProjectPathBar projectId={getProjectId(project)} />

      <div className='detail-component__meta'>
        <div className='mono detail-component__meta-id'>ID: {getProjectId(project)}</div>
        <div>创建: {formatDate(project.created)}</div>
        {project.groups && project.groups.length > 0 && (
          <div>分组: {project.groups.join(', ')}</div>
        )}
        {project.tags && project.tags.length > 0 && <div>标签: {project.tags.join(', ')}</div>}
      </div>

      {/* 板块 Tab 切换 */}
      <div className='detail-component__scroll'>
        <Tabs
          size='small'
          className='detail-component__tabs'
          items={[
            ...(gitStatus
              ? [
                  {
                    key: 'git',
                    label: 'Git 状态',
                    children: (
                      <div className='git-status'>
                        <div>
                          <span className='git-status__label'>分支: </span>
                          <span className='mono'>{gitStatus.branch || '-'}</span>
                          {gitStatus.dirty ? (
                            <Tag color='orange' style={{ marginLeft: 8, fontSize: 10 }}>
                              <WarningOutlined /> {gitStatus.uncommittedCount} 未提交
                            </Tag>
                          ) : (
                            <Tag color='green' style={{ marginLeft: 8, fontSize: 10 }}>
                              <CheckCircleOutlined /> 干净
                            </Tag>
                          )}
                        </div>
                        {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                          <div>
                            <span className='git-status__label'>远程: </span>
                            {gitStatus.ahead > 0 && (
                              <Tag color='green' style={{ fontSize: 10 }}>
                                ↑{gitStatus.ahead}
                              </Tag>
                            )}
                            {gitStatus.behind > 0 && (
                              <Tag color='orange' style={{ fontSize: 10 }}>
                                ↓{gitStatus.behind}
                              </Tag>
                            )}
                          </div>
                        )}
                        {gitStatus.lastCommitMessage && (
                          <Tooltip
                            title={
                              gitStatus.lastCommitTime ? formatDate(gitStatus.lastCommitTime) : ''
                            }>
                            <div className='git-status__commit'>
                              <span className='git-status__label'>最近: </span>
                              {gitStatus.lastCommitMessage}
                            </div>
                          </Tooltip>
                        )}
                      </div>
                    ),
                  },
                ]
              : []),
            ...(tasks && tasks.length > 0
              ? [
                  {
                    key: 'tasks',
                    label: `关联任务 (${tasks.length})`,
                    children: (
                      <List
                        size='small'
                        dataSource={tasks}
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
                    ),
                  },
                ]
              : []),
            ...(relations && relations.length > 0
              ? [
                  {
                    key: 'relations',
                    label: `项目关系 (${relations.length})`,
                    children: (
                      <List
                        size='small'
                        dataSource={relations}
                        renderItem={(r: ProjectRelation) => {
                          const pid = getProjectId(project);
                          const otherId = r.projectA === pid ? r.projectB : r.projectA;
                          return (
                            <List.Item
                              className='detail-list-item'
                              onClick={() => navigate(getViewPath('project', otherId))}>
                              <div className='detail-list-item__row'>
                                <Tag
                                  color={getEntityColor('project')}
                                  style={{ fontSize: 10, margin: 0 }}>
                                  {r.type}
                                </Tag>
                                <span className='mono'>{truncate(otherId, 16)}</span>
                              </div>
                            </List.Item>
                          );
                        }}
                      />
                    ),
                  },
                ]
              : []),
            ...(specs && specs.length > 0
              ? [
                  {
                    key: 'specs',
                    label: `Spec (${specs.length})`,
                    children: (
                      <List
                        size='small'
                        dataSource={specs}
                        renderItem={(s: ParsedSpec) => (
                          <List.Item
                            className='detail-list-item'
                            onClick={() =>
                              navigate(getViewPath('spec', s.frontmatter.id || s.fileName))
                            }>
                            <div>
                              <span>{truncate(s.frontmatter.title || s.fileName, 30)}</span>
                              {s.frontmatter.tags && s.frontmatter.tags.length > 0 && (
                                <div className='spec-tags'>
                                  {s.frontmatter.tags.slice(0, 3).map((tag: string) => (
                                    <Tag key={tag}>{tag}</Tag>
                                  ))}
                                </div>
                              )}
                            </div>
                          </List.Item>
                        )}
                      />
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

// ── Spec 详情（直接从节点 data 渲染，不走 API）──

function SpecDetail({ data }: { data: Record<string, unknown> }) {
  const adapter = getAdapter();
  const title = (data.title as string) || '未知';
  const specId = (data.specId as string) || '';
  const scope = (data.scope as string) || 'project';
  const scopeLabel = scope === 'global' ? '全局级' : scope === 'user' ? '用户级' : '项目级';
  const scopeColor = scope === 'global' ? 'orange' : scope === 'user' ? 'cyan' : 'blue';
  const filePath = (data.filePath as string) || null;
  const specsQuery = useQuery({
    queryKey: queryKeys.specs(),
    queryFn: () => adapter.getSpecs(),
  });
  const allSpecs = [
    ...(specsQuery.data?.project || []),
    ...(specsQuery.data?.user || []),
    ...(specsQuery.data?.global || []),
  ];
  const spec = allSpecs.find((s) => s.fileName === specId || s.frontmatter.id === specId);
  const finalFilePath = filePath || spec?.filePath || null;
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
      {/* Spec 内容 */}
      <div className='detail-component__scroll'>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <EditButton contentType='spec' entityId={finalFilePath || specId} title={title} />
        </div>
        {spec?.content && <MarkdownWithToc content={spec.content} />}
      </div>
    </div>
  );
}

// ── 项目本地路径栏组件 ──

function ProjectPathBar({ projectId }: { projectId: string }) {
  const { message } = AntdApp.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<EditorApp>('finder');

  const pathsQuery = useQuery({
    queryKey: ['project-local-paths', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/local-paths`);
      const data = (await res.json()) as { paths?: string[]; error?: string };
      return data.paths || [];
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const paths = pathsQuery.data || [];
  if (paths.length === 0) return null;

  // 单一路径直接用 FilePathBar
  if (paths.length === 1) {
    return <FilePathBar path={paths[0]} />;
  }

  // 多路径：显示摘要 + 弹窗选择
  const handleOpen = async (path: string, app: EditorApp) => {
    const adapter = getAdapter();
    const success = await adapter.openPath(path, app);
    if (!success) {
      message.warning(`无法用 ${app} 打开`);
    }
    setModalOpen(false);
  };

  return (
    <>
      <div className='project-path-bar'>
        <span className='project-path-bar__text'>{paths.length} 个本地路径</span>
        <Dropdown.Button
          size='small'
          type='text'
          icon={<DownOutlined />}
          onClick={() => {
            setSelectedApp('finder');
            setModalOpen(true);
          }}
          menu={{
            items: editorMenuItems,
            onClick: ({ key }) => {
              setSelectedApp(key as EditorApp);
              setModalOpen(true);
            },
          }}>
          <FolderOpenOutlined /> 打开
        </Dropdown.Button>
      </div>
      <Modal
        title='选择要打开的路径'
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={600}>
        <Radio.Group
          style={{ width: '100%' }}
          onChange={(e) => {
            const path = e.target.value;
            handleOpen(path, selectedApp);
          }}>
          {paths.map((p) => (
            <Radio key={p} value={p} className='path-radio'>
              <span className='mono'>{p}</span>
            </Radio>
          ))}
        </Radio.Group>
      </Modal>
    </>
  );
}

// ── 详情面板头部 ──

function DetailHeader({ entityId }: { entityId?: string | null }) {
  return (
    <div className='detail-header'>
      <span className='detail-header__title'>详情</span>
      <div className='detail-header__actions'>
        {entityId && (
          <Tooltip title='在图中定位'>
            <Button
              size='small'
              type='text'
              icon={<AimOutlined />}
              onClick={() => locateNode(entityId)}
            />
          </Tooltip>
        )}
        <Tooltip title='收起'>
          <Button
            size='small'
            type='text'
            icon={<MenuFoldOutlined />}
            onClick={toggleDetailCollapse}
          />
        </Tooltip>
        <Tooltip title='关闭'>
          <Button size='small' type='text' icon={<CloseOutlined />} onClick={closeDetail} />
        </Tooltip>
      </div>
    </div>
  );
}

// ── 详情面板主组件 ──

export const DetailPanel = memo(function DetailPanel() {
  const { entityId, entityType, entityData } = useSnapshot(detailStore);

  // task/project 才走 API
  const isApiType = entityType === 'task' || entityType === 'project';
  const detailQuery = useEntityDetail(isApiType ? entityId : null, isApiType ? entityType : null);

  // spec 直接从节点 data 渲染
  if (entityType === 'spec' && entityData) {
    return (
      <div className='detail-panel-root'>
        <DetailHeader entityId={entityId} />
        <div className='detail-panel-content'>
          <SpecDetail data={entityData as Record<string, unknown>} />
        </div>
      </div>
    );
  }

  if (!entityId || !entityType) {
    return (
      <div className='detail-empty'>
        <Empty description='选择一个节点查看详情' image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className='detail-loading'>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className='detail-error'>
        <Empty description='加载失败' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        <Button size='small' icon={<ReloadOutlined />} onClick={() => detailQuery.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  const data = detailQuery.data;

  return (
    <div className='detail-panel-root'>
      <DetailHeader entityId={entityId} />

      {/* 内容 */}
      <div className='detail-panel-content'>
        {data.type === 'task' && data.task && (
          <TaskDetail task={data.task} progress={data.progress} />
        )}
        {data.type === 'project' && (
          <ProjectDetail
            project={data.project}
            gitStatus={data.gitStatus}
            specs={data.specs}
            tasks={data.tasks}
            relations={data.relations}
          />
        )}
      </div>
    </div>
  );
});
