import {
  Skeleton,
  Empty,
  Tag,
  Button,
  Timeline,
  List,
  Divider,
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
  BranchesOutlined,
  CopyOutlined,
  AimOutlined,
  FileTextOutlined,
  FolderOutlined,
  MenuFoldOutlined,
} from '@ant-design/icons';
import type { ReferencedSpec, ScopePath } from '@qcqx/lattice-core';
import { useState, useRef as useReactRef, useEffect, useCallback } from 'react';
import { useSnapshot } from 'valtio';
import { useNavigate } from 'react-router';
import { detailStore, closeDetail, getViewPath, locateNode, toggleDetailCollapse } from '../store';
import { useEntityDetail } from '../hooks';
import { getAdapter } from '../adapters';
import {
  formatDate,
  formatRelative,
  getTaskStatusColor,
  getEntityColor,
  getCheckpointTypeColor,
  truncate,
  queryKeys,
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
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';

// ── ScrollSpyBar：滚动时固定在顶部显示当前 section，点击回到 section 开头 ──

interface SpySection {
  key: string;
  label: string;
  el: HTMLDivElement | null;
}

function ScrollSpyBar({
  scrollRef,
  sections,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sections: SpySection[];
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const handleScroll = () => {
      let current: string | null = null;
      for (const s of sections) {
        if (!s.el) continue;
        if (s.el.offsetTop <= container.scrollTop + 20) {
          current = s.key;
        }
      }
      setActiveKey(current);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollRef, sections]);

  const active = sections.find((s) => s.key === activeKey);
  if (!active || !active.el) return null;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        padding: '4px 12px',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        transition: 'background 0.2s',
      }}
      onClick={() => active.el?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-tertiary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-secondary)';
      }}>
      <span style={{ color: 'var(--brand-color)', fontSize: 10 }}>●</span>
      {active.label}
    </div>
  );
}

// ── 构建 sections 数组的辅助 hook ──

function useScrollSections(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>,
  labels: Record<string, string>,
): SpySection[] {
  return useCallback(() => {
    return Object.entries(labels)
      .filter(([key]) => sectionRefs.current[key] != null)
      .map(([key, label]) => ({ key, label, el: sectionRefs.current[key] }));
  }, [sectionRefs, labels])();
}

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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: 'var(--bg-tertiary)',
        borderRadius: 4,
        fontSize: 11,
        marginBottom: 8,
      }}>
      <span
        className='mono'
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--text-secondary)',
        }}
        title={finalPath}>
        {finalPath}
      </span>
      <Button
        size='small'
        type='text'
        icon={<CopyOutlined />}
        onClick={handleCopy}
        style={{ fontSize: 11 }}
      />
      <Dropdown.Button
        size='small'
        type='text'
        icon={<DownOutlined />}
        onClick={() => handleOpen('finder')}
        menu={{
          items: editorMenuItems,
          onClick: ({ key }) => handleOpen(key as EditorApp),
        }}
        style={{ fontSize: 11 }}>
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
  const sectionRefs = useReactRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useReactRef<HTMLDivElement>(null);
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

  // 构建文档 tab 列表
  // 注意：API 在文件不存在时返回 { error: 'not_found' } 对象而非字符串，需过滤
  const isStringContent = (d: unknown): d is string => typeof d === 'string';
  const docTabs: { key: string; label: string; content: string | null; loading: boolean }[] = [];
  if (isStringContent(prdQuery.data))
    docTabs.push({ key: 'prd', label: 'PRD', content: prdQuery.data, loading: prdQuery.isLoading });
  if (isStringContent(designQuery.data))
    docTabs.push({
      key: 'design',
      label: '设计文档',
      content: designQuery.data,
      loading: designQuery.isLoading,
    });
  if (isStringContent(progressContentQuery.data))
    docTabs.push({
      key: 'progress',
      label: '进度文件',
      content: progressContentQuery.data,
      loading: progressContentQuery.isLoading,
    });
  // loading 中也显示 tab（展示骨架）
  if (prdQuery.isLoading && docTabs.length === 0)
    docTabs.push({ key: 'prd', label: 'PRD', content: null, loading: true });

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      {/* 固定头部 */}
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{task.title}</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Tag color={statusColor}>{task.status}</Tag>
      </div>
      <FilePathBar pathType='task-dir' entityId={task.id} />
      {/* 祖先路径 */}
      {lineage.length > 1 && (
        <div
          style={{
            fontSize: 12,
            marginBottom: 8,
            color: 'var(--text-secondary)',
            lineHeight: 1.8,
          }}>
          <span style={{ fontWeight: 500 }}>祖先路径: </span>
          {lineage.slice(0, -1).map((ancestor: TaskMeta, i: number) => (
            <span key={ancestor.id}>
              <span
                style={{ cursor: 'pointer', color: 'var(--brand-color)' }}
                onClick={() => navigate(getViewPath('task', ancestor.id))}>
                {truncate(ancestor.title, 20)}
              </span>
              {i < lineage.length - 2 && <span style={{ margin: '0 4px' }}>›</span>}
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <div className='mono' style={{ fontSize: 11 }}>
          ID: {task.id}
        </div>
        <div>创建: {formatDate(task.created)}</div>
        {task.updated && <div>更新: {formatRelative(task.updated)}</div>}
      </div>

      {/* 导航目录 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        {task.projects && task.projects.length > 0 && (
          <a
            style={{ fontSize: 11, cursor: 'pointer', color: 'var(--brand-color)' }}
            onClick={() =>
              sectionRefs.current.projects?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            关联项目 ({task.projects.length})
          </a>
        )}
        {task.referencedSpecs && task.referencedSpecs.length > 0 && (
          <a
            style={{ fontSize: 11, cursor: 'pointer', color: 'var(--brand-color)' }}
            onClick={() =>
              sectionRefs.current.specs?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            引用 Spec ({task.referencedSpecs.length})
          </a>
        )}
        {task.scopePaths && task.scopePaths.length > 0 && (
          <a
            style={{ fontSize: 11, cursor: 'pointer', color: 'var(--brand-color)' }}
            onClick={() =>
              sectionRefs.current.scopePaths?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            范围路径 ({task.scopePaths.length})
          </a>
        )}
        {docTabs.length > 0 && (
          <a
            style={{ fontSize: 11, cursor: 'pointer', color: 'var(--brand-color)' }}
            onClick={() =>
              sectionRefs.current.docs?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            文档 ({docTabs.length})
          </a>
        )}
        {progress && progress.length > 0 && (
          <a
            style={{ fontSize: 11, cursor: 'pointer', color: 'var(--brand-color)' }}
            onClick={() =>
              sectionRefs.current.checkpoints?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }>
            Checkpoint ({progress.length})
          </a>
        )}
      </div>

      {/* 可滚动内容区：所有内容平铺，导航目录点击跳转 */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <ScrollSpyBar
          scrollRef={scrollRef}
          sections={useScrollSections(scrollRef, sectionRefs, {
            projects: '关联项目',
            specs: '引用 Spec',
            scopePaths: '范围路径',
            docs: '文档预览',
            checkpoints: 'Checkpoint 时间线',
          })}
        />
        {task.projects && task.projects.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.projects = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>关联项目</div>
            <List
              size='small'
              dataSource={task.projects}
              renderItem={(pid: string) => {
                const project = projectsQuery.data?.find((p) => p.id === pid);
                return (
                  <List.Item
                    style={{
                      padding: '4px 0',
                      fontSize: 12,
                      cursor: 'pointer',
                      borderRadius: 4,
                    }}
                    onClick={() => navigate(getViewPath('project', pid))}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-tertiary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{project?.name || pid.slice(0, 12)}</div>
                      <div
                        className='mono'
                        style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {pid}
                      </div>
                      {project?.description && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-secondary)',
                            marginTop: 2,
                          }}>
                          {project.description}
                        </div>
                      )}
                    </div>
                  </List.Item>
                );
              }}
            />
          </div>
        )}

        {task.referencedSpecs && task.referencedSpecs.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.specs = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>引用 Spec</div>
            <List
              size='small'
              dataSource={task.referencedSpecs}
              renderItem={(ref: ReferencedSpec) => (
                <List.Item
                  style={{
                    padding: '4px 0',
                    fontSize: 12,
                    cursor: 'pointer',
                    borderRadius: 4,
                  }}
                  onClick={() => navigate(getViewPath('spec', ref.id))}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag color={getEntityColor('spec')} style={{ fontSize: 10, margin: 0 }}>
                      spec
                    </Tag>
                    <span className='mono' style={{ fontSize: 11 }}>
                      {ref.id}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {ref.scope}
                    </span>
                  </div>
                </List.Item>
              )}
            />
          </div>
        )}

        {task.scopePaths && task.scopePaths.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.scopePaths = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>范围路径</div>
            <List
              size='small'
              dataSource={task.scopePaths}
              renderItem={(sp: ScopePath) => (
                <List.Item style={{ padding: '4px 0', fontSize: 12 }}>
                  <div style={{ width: '100%' }}>
                    <div
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                      <span
                        className='mono'
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          wordBreak: 'break-all',
                          lineHeight: 1.4,
                        }}
                        title={sp.path}>
                        {sp.path}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
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
                        }}
                        style={{ fontSize: 11 }}>
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
          </div>
        )}

        {docTabs.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.docs = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>文档预览</div>
            <Tabs
              size='small'
              items={docTabs.map((tab) => ({
                key: tab.key,
                label: tab.label,
                children: (
                  <div
                    className='markdown-body'
                    style={{
                      fontSize: 12,
                      lineHeight: 1.6,
                      paddingBottom: 12,
                    }}>
                    {tab.loading ? (
                      <Skeleton active paragraph={{ rows: 4 }} />
                    ) : tab.content ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw, rehypeHighlight]}>
                        {tab.content}
                      </ReactMarkdown>
                    ) : (
                      <Empty description='文件为空' image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )}
                  </div>
                ),
              }))}
            />
          </div>
        )}

        {progress && progress.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.checkpoints = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>Checkpoint 时间线</div>
            <Timeline
              items={progress.map((cp: CheckpointEntry) => ({
                color: getCheckpointTimelineColor(cp.type),
                children: (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{cp.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      <Tag style={{ fontSize: 10, margin: 0 }}>{cp.type}</Tag>{' '}
                      {formatRelative(cp.time)}
                    </div>
                    {cp.message && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          marginTop: 2,
                        }}>
                        {truncate(cp.message, 200)}
                      </div>
                    )}
                  </div>
                ),
              }))}
            />
          </div>
        )}
      </div>
    </div>
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
  const sectionRefs = useReactRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useReactRef<HTMLDivElement>(null);
  if (!project) {
    return <Empty description='项目不存在' image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const navLinkStyle: React.CSSProperties = {
    fontSize: 11,
    cursor: 'pointer',
    color: 'var(--brand-color)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{project.name}</h3>

      {project.description && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
          {project.description}
        </p>
      )}

      <ProjectPathBar projectId={project.id} />

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <div className='mono' style={{ fontSize: 11 }}>
          ID: {project.id}
        </div>
        <div>创建: {formatDate(project.created)}</div>
        {project.groups && project.groups.length > 0 && (
          <div>分组: {project.groups.join(', ')}</div>
        )}
        {project.tags && project.tags.length > 0 && <div>标签: {project.tags.join(', ')}</div>}
      </div>

      {/* 导航目录 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        {gitStatus && (
          <a
            style={navLinkStyle}
            onClick={() =>
              sectionRefs.current.git?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            Git 状态
          </a>
        )}
        {tasks && tasks.length > 0 && (
          <a
            style={navLinkStyle}
            onClick={() =>
              sectionRefs.current.tasks?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            关联任务 ({tasks.length})
          </a>
        )}
        {relations && relations.length > 0 && (
          <a
            style={navLinkStyle}
            onClick={() =>
              sectionRefs.current.relations?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            项目关系 ({relations.length})
          </a>
        )}
        {specs && specs.length > 0 && (
          <a
            style={navLinkStyle}
            onClick={() =>
              sectionRefs.current.specs?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            Spec ({specs.length})
          </a>
        )}
      </div>

      {/* 可滚动内容区 */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <ScrollSpyBar
          scrollRef={scrollRef}
          sections={useScrollSections(scrollRef, sectionRefs, {
            git: 'Git 状态',
            tasks: '关联任务',
            relations: '项目关系',
            specs: 'Spec',
          })}
        />
        {/* Git 状态 */}
        {gitStatus && (
          <div
            ref={(el) => {
              sectionRefs.current.git = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
              <BranchesOutlined /> Git 状态
            </div>
            <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>分支: </span>
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
                  <span style={{ color: 'var(--text-secondary)' }}>远程: </span>
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
                  title={gitStatus.lastCommitTime ? formatDate(gitStatus.lastCommitTime) : ''}>
                  <div style={{ wordBreak: 'break-word' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>最近: </span>
                    {gitStatus.lastCommitMessage}
                  </div>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {/* 关联任务 */}
        {tasks && tasks.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.tasks = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
              关联任务 ({tasks.length})
            </div>
            <List
              size='small'
              dataSource={tasks}
              renderItem={(t: TaskMeta) => (
                <List.Item
                  style={{ padding: '4px 0', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}
                  onClick={() => navigate(getViewPath('task', t.id))}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag color={getTaskStatusColor(t.status)} style={{ fontSize: 10, margin: 0 }}>
                      {t.status}
                    </Tag>
                    <span>{truncate(t.title, 30)}</span>
                  </div>
                </List.Item>
              )}
            />
          </div>
        )}

        {/* 项目关系 */}
        {relations && relations.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.relations = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
              项目关系 ({relations.length})
            </div>
            <List
              size='small'
              dataSource={relations}
              renderItem={(r: ProjectRelation) => {
                const otherId = r.projectA === project.id ? r.projectB : r.projectA;
                return (
                  <List.Item
                    style={{ padding: '4px 0', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}
                    onClick={() => navigate(getViewPath('project', otherId))}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-tertiary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Tag color={getEntityColor('project')} style={{ fontSize: 10, margin: 0 }}>
                        {r.type}
                      </Tag>
                      <span className='mono'>{truncate(otherId, 16)}</span>
                    </div>
                  </List.Item>
                );
              }}
            />
          </div>
        )}

        {/* Spec */}
        {specs && specs.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.specs = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
              Spec ({specs.length})
            </div>
            <List
              size='small'
              dataSource={specs}
              renderItem={(s: ParsedSpec) => (
                <List.Item
                  style={{ padding: '4px 0', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}
                  onClick={() => navigate(getViewPath('spec', s.frontmatter.id || s.fileName))}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}>
                  <div>
                    <span>{truncate(s.frontmatter.title || s.fileName, 30)}</span>
                    {s.frontmatter.tags && s.frontmatter.tags.length > 0 && (
                      <div style={{ marginTop: 2 }}>
                        {s.frontmatter.tags.slice(0, 3).map((tag: string) => (
                          <Tag key={tag} style={{ fontSize: 10, margin: '0 4px 0 0' }}>
                            {tag}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </div>
                </List.Item>
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Checkpoint 详情（直接从节点 data 渲染，不走 API）──

function CheckpointDetail({ data }: { data: Record<string, unknown> }) {
  const navigate = useNavigate();
  const sectionRefs = useReactRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useReactRef<HTMLDivElement>(null);
  const title = (data.title as string) || '未知';
  const type = (data.checkpointType as string) || 'note';
  const checkpointId = (data.checkpointId as string) || '';
  const taskId = (data.taskId as string) || '';
  const message = (data.message as string) || '';
  const time = (data.time as string) || '';
  const navLinkStyle: React.CSSProperties = {
    fontSize: 11,
    cursor: 'pointer',
    color: 'var(--brand-color)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Tag color={getCheckpointTypeColor(type)}>{type}</Tag>
      </div>
      {taskId && <FilePathBar pathType='progress' entityId={taskId} />}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <div className='mono' style={{ fontSize: 11 }}>
          ID: {checkpointId}
        </div>
        {time && (
          <div>
            时间: {formatDate(time)} ({formatRelative(time)})
          </div>
        )}
        {taskId && (
          <div>
            所属任务:{' '}
            <span
              className='mono'
              style={{ cursor: 'pointer', color: 'var(--brand-color)' }}
              onClick={() => navigate(getViewPath('task', taskId))}>
              {taskId}
            </span>
          </div>
        )}
      </div>
      {/* 导航目录 */}
      {message && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <a
            style={navLinkStyle}
            onClick={() =>
              sectionRefs.current.content?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            详情内容
          </a>
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <ScrollSpyBar
          scrollRef={scrollRef}
          sections={useScrollSections(scrollRef, sectionRefs, { content: '详情内容' })}
        />
        {message && (
          <div
            ref={(el) => {
              sectionRefs.current.content = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div
              className='markdown-body'
              style={{ fontSize: 12, lineHeight: 1.6, paddingBottom: 12 }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeHighlight]}>
                {message}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Spec 详情（直接从节点 data 渲染，不走 API）──

function SpecDetail({ data }: { data: Record<string, unknown> }) {
  const adapter = getAdapter();
  const sectionRefs = useReactRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useReactRef<HTMLDivElement>(null);
  const title = (data.title as string) || '未知';
  const specId = (data.specId as string) || '';
  const scope = (data.scope as string) || 'project';
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
  const navLinkStyle: React.CSSProperties = {
    fontSize: 11,
    cursor: 'pointer',
    color: 'var(--brand-color)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Tag color={scope === 'project' ? 'blue' : scope === 'user' ? 'green' : 'default'}>
          {scope}
        </Tag>
      </div>
      {finalFilePath && <FilePathBar path={finalFilePath} />}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <div className='mono' style={{ fontSize: 11 }}>
          文件: {specId}
        </div>
      </div>
      {/* 导航目录 */}
      {spec?.content && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <a
            style={navLinkStyle}
            onClick={() =>
              sectionRefs.current.content?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            Spec 内容
          </a>
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <ScrollSpyBar
          scrollRef={scrollRef}
          sections={useScrollSections(scrollRef, sectionRefs, { content: 'Spec 内容' })}
        />
        {spec?.content && (
          <div
            ref={(el) => {
              sectionRefs.current.content = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div
              className='markdown-body'
              style={{ fontSize: 12, lineHeight: 1.6, paddingBottom: 12 }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeHighlight]}>
                {spec.content}
              </ReactMarkdown>
            </div>
          </div>
        )}
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          background: 'var(--bg-tertiary)',
          borderRadius: 4,
          fontSize: 11,
          marginBottom: 8,
        }}>
        <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{paths.length} 个本地路径</span>
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
          }}
          style={{ fontSize: 11 }}>
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
            <Radio
              key={p}
              value={p}
              style={{
                display: 'block',
                marginBottom: 8,
                wordBreak: 'break-all',
                fontSize: 12,
              }}>
              <span className='mono' style={{ fontSize: 11 }}>
                {p}
              </span>
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
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>详情</span>
      <div style={{ display: 'flex', gap: 4 }}>
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

// ── 文档详情（PRD/设计文档等，直接从节点 data 渲染 + API 获取内容）──

const docLabels: Record<string, string> = {
  prd: 'PRD 文档',
  design: '设计文档',
  progress: '进度文件',
};

function DocumentDetail({ data }: { data: Record<string, unknown> }) {
  const adapter = getAdapter();
  const sectionRefs = useReactRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useReactRef<HTMLDivElement>(null);
  const title = (data.title as string) || '文档';
  const docType = (data.docType as string) || 'prd';
  const taskId = (data.taskId as string) || '';
  const label = docLabels[docType] || title;
  const contentQuery = useQuery({
    queryKey: ['content', docType, taskId],
    queryFn: () => adapter.getContent(docType, taskId),
    enabled: !!taskId,
  });
  const content = contentQuery.data;
  const isError = content != null && typeof content !== 'string';
  const navLinkStyle: React.CSSProperties = {
    fontSize: 11,
    cursor: 'pointer',
    color: 'var(--brand-color)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
        <FileTextOutlined style={{ marginRight: 6 }} />
        {label}
      </h3>
      <FilePathBar pathType={docType} entityId={taskId} />
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <div className='mono' style={{ fontSize: 11 }}>
          类型: {docType} | 任务: {taskId}
        </div>
      </div>
      {/* 导航目录 */}
      {!contentQuery.isLoading && !isError && content && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <a
            style={navLinkStyle}
            onClick={() =>
              sectionRefs.current.content?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            文档内容
          </a>
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <ScrollSpyBar
          scrollRef={scrollRef}
          sections={useScrollSections(scrollRef, sectionRefs, { content: '文档内容' })}
        />
        {contentQuery.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}
        {!contentQuery.isLoading && isError && (
          <Empty description='文件不存在' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        {!contentQuery.isLoading && !isError && content && (
          <div
            ref={(el) => {
              sectionRefs.current.content = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div
              className='markdown-body'
              style={{ fontSize: 12, lineHeight: 1.6, paddingBottom: 12 }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeHighlight]}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
        )}
        {!contentQuery.isLoading && !isError && !content && (
          <Empty description='文件为空' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
}

// ── 详情面板主组件 ──

export function DetailPanel() {
  const { entityId, entityType, entityData } = useSnapshot(detailStore);

  // task/project 才走 API
  const isApiType = entityType === 'task' || entityType === 'project';
  const detailQuery = useEntityDetail(isApiType ? entityId : null, isApiType ? entityType : null);

  // checkpoint 直接从节点 data 渲染
  if (entityType === 'checkpoint' && entityData) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <DetailHeader entityId={entityId} />
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, padding: '12px 16px' }}>
          <CheckpointDetail data={entityData as Record<string, unknown>} />
        </div>
      </div>
    );
  }

  // spec 直接从节点 data 渲染
  if (entityType === 'spec' && entityData) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <DetailHeader entityId={entityId} />
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, padding: '12px 16px' }}>
          <SpecDetail data={entityData as Record<string, unknown>} />
        </div>
      </div>
    );
  }

  // document 直接从节点 data 渲染
  if (entityType === 'document' && entityData) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <DetailHeader entityId={entityId} />
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, padding: '12px 16px' }}>
          <DocumentDetail data={entityData as Record<string, unknown>} />
        </div>
      </div>
    );
  }

  if (!entityId || !entityType) {
    return (
      <div
        style={{
          padding: 24,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Empty description='选择一个节点查看详情' image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div style={{ padding: 16 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div style={{ padding: 16 }}>
        <Empty description='加载失败' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        <Button
          size='small'
          icon={<ReloadOutlined />}
          onClick={() => detailQuery.refetch()}
          style={{ marginTop: 8 }}>
          重试
        </Button>
      </div>
    );
  }

  const data = detailQuery.data;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <DetailHeader entityId={entityId} />

      {/* 内容 */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, padding: '12px 16px' }}>
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
}
