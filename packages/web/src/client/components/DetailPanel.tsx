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
  MenuFoldOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import type { ReferencedSpec, ScopePath } from '@qcqx/lattice-core';
import {
  useState,
  useRef as useReactRef,
  useEffect,
  useCallback,
  useMemo,
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

function MarkdownWithToc({ content }: { content: string }) {
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
}

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
      className='scroll-spy-bar'
      onClick={() => active.el?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
      <span className='scroll-spy-bar__dot'>●</span>
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
  // 服务端成功返回 { content: string }，文件不存在返回 { error: 'not_found' }
  // adapter 已将成功映射为 string、失败映射为 null
  const isStringContent = (d: unknown): d is string => typeof d === 'string';
  const docTabs: { key: string; label: string; content: string | null; loading: boolean }[] = [];
  // loading 中也显示 tab（展示骨架），内容就绪后切换为 markdown 预览
  if (prdQuery.isLoading || isStringContent(prdQuery.data))
    docTabs.push({
      key: 'prd',
      label: 'PRD',
      content: isStringContent(prdQuery.data) ? prdQuery.data : null,
      loading: prdQuery.isLoading,
    });
  if (designQuery.isLoading || isStringContent(designQuery.data))
    docTabs.push({
      key: 'design',
      label: '设计文档',
      content: isStringContent(designQuery.data) ? designQuery.data : null,
      loading: designQuery.isLoading,
    });
  if (progressContentQuery.isLoading || isStringContent(progressContentQuery.data))
    docTabs.push({
      key: 'progress',
      label: '进度文件',
      content: isStringContent(progressContentQuery.data) ? progressContentQuery.data : null,
      loading: progressContentQuery.isLoading,
    });

  return (
    <div className='detail-component'>
      {/* 固定头部 */}
      <h3 className='detail-component__title'>{task.title}</h3>
      <div className='detail-component__tags'>
        <Tag color={statusColor}>{task.status}</Tag>
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
        {task.updated && <div>更新: {formatRelative(task.updated)}</div>}
      </div>

      {/* 导航目录 */}
      <div className='detail-component__nav'>
        {task.projects && task.projects.length > 0 && (
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.projects?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            关联项目 ({task.projects.length})
          </a>
        )}
        {task.referencedSpecs && task.referencedSpecs.length > 0 && (
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.specs?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            引用 Spec ({task.referencedSpecs.length})
          </a>
        )}
        {task.scopePaths && task.scopePaths.length > 0 && (
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.scopePaths?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            范围路径 ({task.scopePaths.length})
          </a>
        )}
        {docTabs.length > 0 && (
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.docs?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            文档 ({docTabs.length})
          </a>
        )}
        {progress && progress.length > 0 && (
          <a
            className='nav-link'
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
      <div ref={scrollRef} className='detail-component__scroll'>
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
            <div className='detail-component__section-title'>关联项目</div>
            <List
              size='small'
              dataSource={task.projects}
              renderItem={(pid: string) => {
                const project = projectsQuery.data?.find((p) => p.id === pid);
                return (
                  <List.Item
                    className='detail-list-item'
                    onClick={() => navigate(getViewPath('project', pid))}>
                    <div>
                      <div className='detail-list-item__name'>
                        {project?.name || pid.slice(0, 12)}
                      </div>
                      <div className='mono detail-list-item__id'>{pid}</div>
                      {project?.description && (
                        <div className='detail-list-item__desc'>{project.description}</div>
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
            <div className='detail-component__section-title'>引用 Spec</div>
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
          </div>
        )}

        {task.scopePaths && task.scopePaths.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.scopePaths = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div className='detail-component__section-title'>范围路径</div>
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
          </div>
        )}

        {docTabs.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.docs = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div className='detail-component__section-title'>文档预览</div>
            <Tabs
              size='small'
              items={docTabs.map((tab) => ({
                key: tab.key,
                label: tab.label,
                children: (
                  <>
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
          </div>
        )}

        {progress && progress.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.checkpoints = el;
            }}>
            <Divider style={{ margin: '8px 0' }} />
            <div className='detail-component__section-title' style={{ marginBottom: 8 }}>
              Checkpoint 时间线
            </div>
            <Timeline
              items={progress.map((cp: CheckpointEntry) => ({
                color: getCheckpointTimelineColor(cp.type),
                children: (
                  <div>
                    <div className='checkpoint-item__title'>{cp.title}</div>
                    <div className='checkpoint-item__meta'>
                      <Tag style={{ fontSize: 10, margin: 0 }}>{cp.type}</Tag>{' '}
                      {formatRelative(cp.time)}
                    </div>
                    {cp.message && (
                      <div className='checkpoint-item__message'>{truncate(cp.message, 200)}</div>
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

  return (
    <div className='detail-component'>
      <h3 className='detail-component__title'>{project.name}</h3>

      {project.description && (
        <p className='detail-component__meta' style={{ marginBottom: 8 }}>
          {project.description}
        </p>
      )}

      <ProjectPathBar projectId={project.id} />

      <div className='detail-component__meta'>
        <div className='mono detail-component__meta-id'>ID: {project.id}</div>
        <div>创建: {formatDate(project.created)}</div>
        {project.groups && project.groups.length > 0 && (
          <div>分组: {project.groups.join(', ')}</div>
        )}
        {project.tags && project.tags.length > 0 && <div>标签: {project.tags.join(', ')}</div>}
      </div>

      {/* 导航目录 */}
      <div className='detail-component__nav'>
        {gitStatus && (
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.git?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            Git 状态
          </a>
        )}
        {tasks && tasks.length > 0 && (
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.tasks?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            关联任务 ({tasks.length})
          </a>
        )}
        {relations && relations.length > 0 && (
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.relations?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            项目关系 ({relations.length})
          </a>
        )}
        {specs && specs.length > 0 && (
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.specs?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            Spec ({specs.length})
          </a>
        )}
      </div>

      {/* 可滚动内容区 */}
      <div ref={scrollRef} className='detail-component__scroll'>
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
            <div className='detail-component__section-title'>
              <BranchesOutlined /> Git 状态
            </div>
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
                  title={gitStatus.lastCommitTime ? formatDate(gitStatus.lastCommitTime) : ''}>
                  <div className='git-status__commit'>
                    <span className='git-status__label'>最近: </span>
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
            <div className='detail-component__section-title'>关联任务 ({tasks.length})</div>
            <List
              size='small'
              dataSource={tasks}
              renderItem={(t: TaskMeta) => (
                <List.Item
                  className='detail-list-item'
                  onClick={() => navigate(getViewPath('task', t.id))}>
                  <div className='detail-list-item__row'>
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
            <div className='detail-component__section-title'>项目关系 ({relations.length})</div>
            <List
              size='small'
              dataSource={relations}
              renderItem={(r: ProjectRelation) => {
                const otherId = r.projectA === project.id ? r.projectB : r.projectA;
                return (
                  <List.Item
                    className='detail-list-item'
                    onClick={() => navigate(getViewPath('project', otherId))}>
                    <div className='detail-list-item__row'>
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
            <div className='detail-component__section-title'>Spec ({specs.length})</div>
            <List
              size='small'
              dataSource={specs}
              renderItem={(s: ParsedSpec) => (
                <List.Item
                  className='detail-list-item'
                  onClick={() => navigate(getViewPath('spec', s.frontmatter.id || s.fileName))}>
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
  return (
    <div className='detail-component'>
      <h3 className='detail-component__title'>{title}</h3>
      <div className='detail-component__tags'>
        <Tag color={getCheckpointTypeColor(type)}>{type}</Tag>
      </div>
      {taskId && <FilePathBar pathType='progress' entityId={taskId} />}
      <div className='detail-component__meta'>
        <div className='mono detail-component__meta-id'>ID: {checkpointId}</div>
        {time && (
          <div>
            时间: {formatDate(time)} ({formatRelative(time)})
          </div>
        )}
        {taskId && (
          <div>
            所属任务:{' '}
            <span
              className='mono detail-ancestor__link'
              onClick={() => navigate(getViewPath('task', taskId))}>
              {taskId}
            </span>
          </div>
        )}
      </div>
      {/* 导航目录 */}
      {message && (
        <div className='detail-component__nav'>
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.content?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            详情内容
          </a>
        </div>
      )}
      <div ref={scrollRef} className='detail-component__scroll'>
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
            <MarkdownWithToc content={message} />
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
      {/* 导航目录 */}
      {spec?.content && (
        <div className='detail-component__nav'>
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.content?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            Spec 内容
          </a>
        </div>
      )}
      <div ref={scrollRef} className='detail-component__scroll'>
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
            <MarkdownWithToc content={spec.content} />
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
  return (
    <div className='detail-component'>
      <h3 className='detail-component__title'>
        <FileTextOutlined style={{ marginRight: 6 }} />
        {label}
      </h3>
      <FilePathBar pathType={docType} entityId={taskId} />
      <div className='detail-component__meta'>
        <div className='mono detail-component__meta-id'>
          类型: {docType} | 任务: {taskId}
        </div>
      </div>
      {/* 导航目录 */}
      {!contentQuery.isLoading && !isError && content && (
        <div className='detail-component__nav'>
          <a
            className='nav-link'
            onClick={() =>
              sectionRefs.current.content?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }>
            文档内容
          </a>
        </div>
      )}
      <div ref={scrollRef} className='detail-component__scroll'>
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
            <MarkdownWithToc content={content} />
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
      <div className='detail-panel-root'>
        <DetailHeader entityId={entityId} />
        <div className='detail-panel-content'>
          <CheckpointDetail data={entityData as Record<string, unknown>} />
        </div>
      </div>
    );
  }

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

  // document 直接从节点 data 渲染
  if (entityType === 'document' && entityData) {
    return (
      <div className='detail-panel-root'>
        <DetailHeader entityId={entityId} />
        <div className='detail-panel-content'>
          <DocumentDetail data={entityData as Record<string, unknown>} />
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
}
