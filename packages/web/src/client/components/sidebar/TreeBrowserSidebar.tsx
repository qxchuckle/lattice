import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Input, Button, Skeleton, Empty, Tag, Checkbox, Tooltip } from 'antd';
import {
  RightOutlined,
  DownOutlined,
  FolderOutlined,
  FileTextOutlined,
  AimOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import { useNavigate } from 'react-router';
import {
  canvasStore,
  sidebarStore,
  getViewPath,
  setSidebarWidth,
  closeMobileSidebar,
} from '../../store';
import { useSearch, useUsers } from '../../hooks';
import { getEntityColor, truncate } from '../../lib';
import { useTreeData } from './treeData';
import {
  type TreeNode,
  type CanvasPreset,
  filterTreeByKeywordAndFilters,
  flattenSearch,
  nodeLegendItems,
  edgeLegendItems,
  edgeGroups,
  canvasPresets,
  focusDepthOptions,
  searchTypeOptions,
  taskStatusOptions,
  specScopeOptions,
} from './treeUtils';

// ── 模块级常量 ──

const ENTITY_COLOR_MAP: Record<string, string> = {
  task: getEntityColor('task'),
  project: getEntityColor('project'),
  spec: getEntityColor('spec'),
  relation: getEntityColor('project'),
};

function getTabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    textAlign: 'center' as const,
    padding: '6px 0',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    color: active ? 'var(--brand-color)' : 'var(--text-secondary)',
    borderBottom: active ? '2px solid var(--brand-color)' : '2px solid transparent',
    transition: 'all 0.2s',
  };
}

// ── 可截断标题 ──

const TruncatableTitle = memo(function TruncatableTitle({ title }: { title: string }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    const el = spanRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    timerRef.current = setTimeout(() => setOpen(true), 200);
  };
  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  };

  return (
    <Tooltip title={title} placement='right' open={open}>
      <span
        ref={spanRef}
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}>
        {title}
      </span>
    </Tooltip>
  );
});

// ── 树节点图标 ──

function getNodeIcon(node: TreeNode): React.ReactNode {
  switch (node.type) {
    case 'spec-root':
      return <FileTextOutlined style={{ fontSize: 12, color: '#13C2C2' }} />;
    case 'project-root':
      return <FolderOutlined style={{ fontSize: 12, color: '#FA8C16' }} />;
    case 'task-root':
      return <AimOutlined style={{ fontSize: 12, color: '#1677FF' }} />;
    case 'spec-scope':
      return <FolderOutlined style={{ fontSize: 11, color: 'var(--text-secondary)' }} />;
    case 'spec-item':
      return <FileTextOutlined style={{ fontSize: 11, color: '#13C2C2' }} />;
    case 'project-item':
      return <FolderOutlined style={{ fontSize: 11, color: '#FA8C16' }} />;
    case 'task-item':
      return <AimOutlined style={{ fontSize: 11, color: getEntityColor('task') }} />;
    case 'search-result':
      return <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>●</span>;
    default:
      return null;
  }
}

// ── 递归树节点组件 ──

function TreeItemBase({
  node,
  depth,
  forceExpand = false,
  onNavigate,
}: {
  node: TreeNode;
  depth: number;
  forceExpand?: boolean;
  onNavigate: (node: TreeNode) => void;
}) {
  // useSnapshot 追踪 expandedKeys[node.key] 的访问，仅该 key 变化时重渲染本组件
  const { expandedKeys } = useSnapshot(sidebarStore);
  const isExpanded = forceExpand || !!expandedKeys[node.key];
  const hasChildren = node.children && node.children.length > 0;
  const isLeaf =
    (node.type === 'task-item' && !hasChildren) ||
    (node.type === 'spec-item' && !hasChildren) ||
    (node.type === 'project-item' && !hasChildren);
  const isSearchResult = node.type === 'search-result';

  // 容器节点 sticky 置顶：展开的祖先节点滚动时固定在顶部
  const isStickyHeader =
    !isLeaf &&
    depth < 4 &&
    (node.type === 'spec-root' ||
      node.type === 'project-root' ||
      node.type === 'task-root' ||
      node.type === 'spec-scope' ||
      (node.type === 'project-item' && hasChildren) ||
      (node.type === 'task-item' && hasChildren));

  return (
    <>
      <div
        className={`tree-item${isStickyHeader ? ' tree-item--sticky' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          borderRadius: 4,
          cursor: 'pointer',
          marginLeft: depth * 14,
          fontSize: 12,
          whiteSpace: 'nowrap',
          ...(isStickyHeader
            ? {
                position: 'sticky' as const,
                top: depth * 25,
                zIndex: 20 - depth,
              }
            : {}),
        }}
        onClick={() => {
          if (node.entityId && node.viewMode) {
            onNavigate(node);
          } else if (hasChildren && !isLeaf) {
            sidebarStore.expandedKeys[node.key] = !sidebarStore.expandedKeys[node.key];
          }
        }}>
        {hasChildren && !isLeaf ? (
          <span
            style={{
              flexShrink: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 4,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            onClick={(e) => {
              e.stopPropagation();
              sidebarStore.expandedKeys[node.key] = !sidebarStore.expandedKeys[node.key];
            }}>
            {isExpanded ? (
              <DownOutlined style={{ fontSize: 11 }} />
            ) : (
              <RightOutlined style={{ fontSize: 11 }} />
            )}
          </span>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}
        {getNodeIcon(node)}
        <TruncatableTitle title={truncate(node.title, 32)} />
        {node.meta?.status && node.type === 'task-item' && (
          <Tag
            color={getEntityColor('task')}
            style={{
              fontSize: 9,
              margin: 0,
              lineHeight: '14px',
              padding: '0 3px',
              flexShrink: 0,
            }}>
            {node.meta.status}
          </Tag>
        )}
        {isSearchResult && node.meta?.desc && (
          <Tag
            color={ENTITY_COLOR_MAP[node.meta.desc] || undefined}
            style={{
              fontSize: 9,
              margin: 0,
              lineHeight: '14px',
              padding: '0 3px',
              flexShrink: 0,
            }}>
            {node.meta.desc}
          </Tag>
        )}
        {node.meta?.scope && node.type === 'spec-item' && (
          <Tag
            color={
              node.meta.scope === '全局级'
                ? 'orange'
                : node.meta.scope === '用户级'
                  ? 'cyan'
                  : 'blue'
            }
            style={{
              fontSize: 9,
              margin: 0,
              lineHeight: '14px',
              padding: '0 3px',
              flexShrink: 0,
            }}>
            {node.meta.scope}
          </Tag>
        )}
      </div>
      {isExpanded &&
        hasChildren &&
        node.children!.map((child) => (
          <MemoizedTreeItem
            key={child.key}
            node={child}
            depth={depth + 1}
            forceExpand={forceExpand}
            onNavigate={onNavigate}
          />
        ))}
    </>
  );
}

// memo 默认浅比较：props（node/depth/forceExpand/onNavigate）全部稳定时跳过。
// useSnapshot 触发的重渲染不受 memo 影响（直接调 hook，不经过 props）。
const MemoizedTreeItem = memo(TreeItemBase);

// ── 搜索筛选器 bar ──

const SearchFilterBar = memo(function SearchFilterBar() {
  const { searchFilters } = useSnapshot(sidebarStore);

  const toggleTaskStatus = (value: string) => {
    const current = sidebarStore.searchFilters.taskStatus;
    sidebarStore.searchFilters.taskStatus = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value];
  };

  const toggleSpecScope = (value: string) => {
    const current = sidebarStore.searchFilters.specScope;
    sidebarStore.searchFilters.specScope = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value];
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 8px',
    fontSize: 10,
    cursor: 'pointer',
    borderRadius: 10,
    border: `1px solid ${active ? 'var(--brand-color)' : 'var(--border)'}`,
    background: active ? 'var(--brand-color)' : 'transparent',
    color: active ? '#fff' : 'var(--text-secondary)',
    transition: 'all 0.15s',
    userSelect: 'none',
  });

  return (
    <div style={{ padding: '0 8px 6px' }}>
      {/* 类型 segmented */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
        {searchTypeOptions.map((opt) => {
          const active = searchFilters.type === opt.value;
          return (
            <div
              key={opt.value}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '3px 0',
                fontSize: 10,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                borderRadius: 4,
                background: active ? 'var(--brand-color)' : 'var(--bg-tertiary)',
                color: active ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
              onClick={() => {
                sidebarStore.searchFilters.type = opt.value;
                if (opt.value !== 'task') sidebarStore.searchFilters.taskStatus = [];
                if (opt.value !== 'spec') sidebarStore.searchFilters.specScope = [];
              }}>
              {opt.label}
            </div>
          );
        })}
      </div>
      {/* 任务状态 chips */}
      {searchFilters.type === 'task' && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {taskStatusOptions.map((opt) => (
            <div
              key={opt.value}
              style={chipStyle(searchFilters.taskStatus.includes(opt.value))}
              onClick={() => toggleTaskStatus(opt.value)}>
              {opt.label}
            </div>
          ))}
        </div>
      )}
      {/* Spec 范围 chips */}
      {searchFilters.type === 'spec' && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {specScopeOptions.map((opt) => (
            <div
              key={opt.value}
              style={chipStyle(searchFilters.specScope.includes(opt.value))}
              onClick={() => toggleSpecScope(opt.value)}>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ── 搜索 Tab：仅订阅 sidebarStore，不订阅 canvasStore ──

const SearchTreeTab = memo(function SearchTreeTab() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { searchKeyword, searchFilters } = useSnapshot(sidebarStore);
  const searchResult = useSearch();
  const { tree, loading, tasks, specs } = useTreeData();

  const handleNavigate = useCallback((node: TreeNode) => {
    if (node.entityId && node.viewMode)
      navigateRef.current(getViewPath(node.viewMode, node.entityId));
  }, []);

  const isSearching = searchKeyword.length > 0;
  const hasFilters =
    searchFilters.type !== 'all' ||
    searchFilters.taskStatus.length > 0 ||
    searchFilters.specScope.length > 0;
  const searchItems = useMemo(
    () =>
      isSearching && searchResult.data
        ? flattenSearch(searchResult.data, searchFilters, tasks, specs)
        : [],
    [isSearching, searchResult.data, searchFilters, tasks, specs],
  );
  const filteredTree = useMemo(
    () =>
      isSearching || hasFilters
        ? filterTreeByKeywordAndFilters(tree, searchKeyword, searchFilters)
        : tree,
    [isSearching, hasFilters, tree, searchKeyword, searchFilters],
  );

  return (
    <>
      <div style={{ padding: 8 }}>
        <Input.Search
          id='sidebar-search-input'
          size='small'
          placeholder='搜索 spec/项目/任务...'
          defaultValue=''
          onChange={(e) => {
            sidebarStore.searchKeyword = e.target.value;
          }}
          allowClear
        />
      </div>
      <SearchFilterBar />
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
        {loading && <Skeleton active paragraph={{ rows: 6 }} />}
        {!loading && isSearching && searchResult.isLoading && <Skeleton active />}
        {!loading && isSearching && searchItems.length === 0 && !searchResult.isLoading && (
          <Empty description='无搜索结果' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        {!loading && !isSearching && hasFilters && filteredTree.length === 0 && (
          <Empty description='无匹配数据' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        {!loading && !isSearching && !hasFilters && filteredTree.length === 0 && (
          <Empty description='暂无数据' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        {!loading && isSearching && searchItems.length > 0 && (
          <>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 4,
              }}>
              搜索结果 ({searchItems.length})
            </div>
            {searchItems.map((node) => (
              <MemoizedTreeItem key={node.key} node={node} depth={0} onNavigate={handleNavigate} />
            ))}
            {filteredTree.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    margin: '8px 0 4px',
                  }}>
                  浏览器匹配
                </div>
                {filteredTree.map((node) => (
                  <MemoizedTreeItem
                    key={node.key}
                    node={node}
                    depth={0}
                    forceExpand
                    onNavigate={handleNavigate}
                  />
                ))}
              </>
            )}
          </>
        )}
        {!loading &&
          !isSearching &&
          filteredTree.map((node) => (
            <MemoizedTreeItem key={node.key} node={node} depth={0} onNavigate={handleNavigate} />
          ))}
      </div>
    </>
  );
});

// ── 筛选 Tab：订阅 canvasStore（visibleTypes/visibleEdgeTypes/focusDepth/selectedNodeId）──

const FilterTreeTab = memo(function FilterTreeTab() {
  const {
    visibleTypes,
    visibleEdgeTypes,
    focusDepth,
    selectedNodeId,
    taskStatusFilter,
    specScopeFilter,
    projectFilter,
    canvasKeyword,
    userFilter,
  } = useSnapshot(canvasStore);
  const { tree } = useTreeData();
  const usersQuery = useUsers();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['spec', 'project']));
  const [projectCollapsed, setProjectCollapsed] = useState(false);
  const [projectSearchKeyword, setProjectSearchKeyword] = useState('');
  const [userCollapsed, setUserCollapsed] = useState(false);

  const projects = useMemo(() => {
    const projectRoot = tree.find((n) => n.type === 'project-root');
    return (projectRoot?.children || []).filter((n) => n.type === 'project-item');
  }, [tree]);

  const filteredProjects = useMemo(() => {
    if (!projectSearchKeyword) return projects;
    const lower = projectSearchKeyword.toLowerCase();
    return projects.filter((p) => p.title.toLowerCase().includes(lower));
  }, [projects, projectSearchKeyword]);

  const activePreset = useMemo(() => {
    for (const preset of canvasPresets) {
      const nodesMatch = nodeLegendItems.every(
        (item) => !!visibleTypes[item.key] === preset.nodes[item.key],
      );
      const edgesMatch = edgeLegendItems.every(
        (item) => !!visibleEdgeTypes[item.key] === preset.edges[item.key],
      );
      if (nodesMatch && edgesMatch) return preset.label;
    }
    return null;
  }, [visibleTypes, visibleEdgeTypes]);

  const applyPreset = (preset: CanvasPreset) => {
    nodeLegendItems.forEach((item) => {
      canvasStore.visibleTypes[item.key] = preset.nodes[item.key] ?? false;
    });
    edgeLegendItems.forEach((item) => {
      canvasStore.visibleEdgeTypes[item.key] = preset.edges[item.key] ?? false;
    });
    canvasStore.taskStatusFilter = [];
    canvasStore.specScopeFilter = [];
    canvasStore.projectFilter = [];
    canvasStore.canvasKeyword = '';
    canvasStore.userFilter = [];
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
      {/* 关键字搜索 */}
      <Input
        size='small'
        placeholder='过滤画布节点...'
        value={canvasKeyword}
        onChange={(e) => {
          canvasStore.canvasKeyword = e.target.value;
        }}
        allowClear
        style={{ marginBottom: 8 }}
      />

      {/* 用户筛选 */}
      {usersQuery.data && usersQuery.data.users.length > 1 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
            <span
              style={{
                cursor: 'pointer',
                fontSize: 10,
                width: 16,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => setUserCollapsed(!userCollapsed)}>
              {userCollapsed ? '▸' : '▾'}
            </span>
            用户
            {userFilter.length > 0 && (
              <span style={{ fontSize: 9, color: 'var(--brand-color)' }}>
                ({userFilter.length} 选)
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              <Button
                size='small'
                type='text'
                onClick={() => {
                  canvasStore.userFilter = [];
                  canvasStore.projectFilter = [];
                  canvasStore.canvasKeyword = '';
                }}
                style={{ fontSize: 10, padding: '0 4px', height: 18 }}>
                仅当前
              </Button>
              {userFilter.length < usersQuery.data.users.length && (
                <Button
                  size='small'
                  type='text'
                  onClick={() => {
                    canvasStore.userFilter = [...usersQuery.data!.users];
                    canvasStore.projectFilter = [];
                  }}
                  style={{ fontSize: 10, padding: '0 4px', height: 18 }}>
                  全选
                </Button>
              )}
              {userFilter.length > 0 && (
                <Button
                  size='small'
                  type='text'
                  onClick={() => {
                    canvasStore.userFilter = [];
                    canvasStore.projectFilter = [];
                  }}
                  style={{ fontSize: 10, padding: '0 4px', height: 18 }}>
                  清空
                </Button>
              )}
            </div>
          </div>
          {!userCollapsed && (
            <div style={{ maxHeight: 100, overflow: 'auto', marginBottom: 8 }}>
              {usersQuery.data.users.map((u) => {
                const isCurrent = u === usersQuery.data!.currentUser;
                const isChecked = userFilter.includes(u);
                return (
                  <Checkbox
                    key={u}
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        canvasStore.userFilter = [...userFilter, u];
                      } else {
                        canvasStore.userFilter = userFilter.filter((x) => x !== u);
                      }
                      // 切换用户时清空项目筛选（跨用户 projectId 可能不匹配）
                      canvasStore.projectFilter = [];
                    }}
                    style={{
                      fontSize: 10,
                      display: 'flex',
                      alignItems: 'center',
                      margin: '1px 0',
                    }}>
                    <span style={{ fontWeight: isCurrent ? 600 : 400 }}>
                      {u}
                      {isCurrent && (
                        <Tag
                          color='blue'
                          style={{
                            fontSize: 9,
                            margin: '0 0 0 4px',
                            lineHeight: '14px',
                            padding: '0 3px',
                            flexShrink: 0,
                          }}>
                          当前
                        </Tag>
                      )}
                    </span>
                  </Checkbox>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 节点类型 - 横向 */}
      <div
        style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
        节点类型
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {nodeLegendItems.map((item) => (
          <Checkbox
            key={item.key}
            checked={!!visibleTypes[item.key]}
            onChange={(e) => {
              canvasStore.visibleTypes[item.key] = e.target.checked;
            }}
            style={{ fontSize: 11 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                background: item.color,
                marginRight: 4,
                verticalAlign: 'middle',
              }}
            />
            {item.label}
          </Checkbox>
        ))}
      </div>

      {/* 项目筛选 */}
      {projects.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
            <span
              style={{
                cursor: 'pointer',
                fontSize: 10,
                width: 16,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => setProjectCollapsed(!projectCollapsed)}>
              {projectCollapsed ? '▸' : '▾'}
            </span>
            项目
            {projectFilter.length > 0 && (
              <span style={{ fontSize: 9, color: 'var(--brand-color)' }}>
                ({projectFilter.length}/{projects.length})
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              {projectFilter.length < filteredProjects.length && (
                <Button
                  size='small'
                  type='text'
                  onClick={() => {
                    const ids = filteredProjects.map((p) => p.entityId || '').filter(Boolean);
                    const merged = Array.from(new Set([...projectFilter, ...ids]));
                    canvasStore.projectFilter = merged;
                  }}
                  style={{ fontSize: 10, padding: '0 4px', height: 18 }}>
                  全选
                </Button>
              )}
              {projectFilter.length > 0 && (
                <Button
                  size='small'
                  type='text'
                  onClick={() => {
                    canvasStore.projectFilter = [];
                  }}
                  style={{ fontSize: 10, padding: '0 4px', height: 18 }}>
                  清空
                </Button>
              )}
            </div>
          </div>
          {!projectCollapsed && (
            <>
              {projects.length > 6 && (
                <Input
                  size='small'
                  placeholder='搜索项目...'
                  value={projectSearchKeyword}
                  onChange={(e) => setProjectSearchKeyword(e.target.value)}
                  allowClear
                  style={{ marginBottom: 4, fontSize: 10 }}
                />
              )}
              <div style={{ maxHeight: 120, overflow: 'auto', marginBottom: 8 }}>
                {filteredProjects.map((p) => (
                  <Checkbox
                    key={p.entityId}
                    checked={projectFilter.includes(p.entityId || '')}
                    onChange={(e) => {
                      const pid = p.entityId || '';
                      canvasStore.projectFilter = e.target.checked
                        ? [...projectFilter, pid]
                        : projectFilter.filter((id) => id !== pid);
                    }}
                    style={{
                      fontSize: 10,
                      display: 'flex',
                      alignItems: 'center',
                      margin: '1px 0',
                    }}>
                    <TruncatableTitle title={truncate(p.title, 20)} />
                  </Checkbox>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* 任务状态筛选（当 task 节点可见时） */}
      {visibleTypes.task && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 4,
            }}>
            任务状态
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {taskStatusOptions.map((opt) => {
              const active = taskStatusFilter.includes(opt.value);
              return (
                <div
                  key={opt.value}
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    cursor: 'pointer',
                    borderRadius: 10,
                    border: `1px solid ${active ? 'var(--brand-color)' : 'var(--border)'}`,
                    background: active ? 'var(--brand-color)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                    userSelect: 'none',
                  }}
                  onClick={() => {
                    canvasStore.taskStatusFilter = active
                      ? taskStatusFilter.filter((s) => s !== opt.value)
                      : [...taskStatusFilter, opt.value];
                  }}>
                  {opt.label}
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* Spec 范围筛选（当 spec 节点可见时） */}
      {visibleTypes.spec && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 4,
            }}>
            Spec 范围
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {specScopeOptions.map((opt) => {
              const active = specScopeFilter.includes(opt.value);
              return (
                <div
                  key={opt.value}
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    cursor: 'pointer',
                    borderRadius: 10,
                    border: `1px solid ${active ? 'var(--brand-color)' : 'var(--border)'}`,
                    background: active ? 'var(--brand-color)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                    userSelect: 'none',
                  }}
                  onClick={() => {
                    canvasStore.specScopeFilter = active
                      ? specScopeFilter.filter((s) => s !== opt.value)
                      : [...specScopeFilter, opt.value];
                  }}>
                  {opt.label}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 快捷预设 */}
      <div
        style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
        快捷预设
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {canvasPresets.map((preset) => (
          <Button
            key={preset.label}
            size='small'
            type={activePreset === preset.label ? 'primary' : 'text'}
            onClick={() => applyPreset(preset)}
            style={{ fontSize: 10, padding: '0 8px', height: 22, flex: 1 }}>
            {preset.label}
          </Button>
        ))}
      </div>

      {/* 边类型 - 分组 */}
      <div
        style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
        边类型
      </div>
      {edgeGroups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        const checkedCount = group.items.filter((i) => visibleEdgeTypes[i.key]).length;
        const allGroupChecked = checkedCount === group.items.length;
        const someGroupChecked = checkedCount > 0 && !allGroupChecked;

        return (
          <div key={group.key} style={{ marginBottom: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  cursor: 'pointer',
                  fontSize: 10,
                  width: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={() => {
                  const next = new Set(collapsedGroups);
                  if (collapsed) next.delete(group.key);
                  else next.add(group.key);
                  setCollapsedGroups(next);
                }}>
                {collapsed ? '▸' : '▾'}
              </span>
              <Checkbox
                checked={allGroupChecked}
                indeterminate={someGroupChecked}
                onChange={(e) => {
                  group.items.forEach((item) => {
                    canvasStore.visibleEdgeTypes[item.key] = e.target.checked;
                  });
                }}
                style={{ fontSize: 11, flex: 1 }}>
                {group.label} ({checkedCount}/{group.items.length})
              </Checkbox>
            </div>
            {!collapsed && (
              <div style={{ marginLeft: 20 }}>
                {group.items.map((item) => (
                  <Checkbox
                    key={item.key}
                    checked={!!visibleEdgeTypes[item.key]}
                    onChange={(e) => {
                      canvasStore.visibleEdgeTypes[item.key] = e.target.checked;
                    }}
                    style={{
                      fontSize: 10,
                      display: 'flex',
                      alignItems: 'center',
                      margin: '1px 0',
                    }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 3,
                        borderRadius: 1,
                        background: item.color,
                        marginRight: 4,
                        verticalAlign: 'middle',
                      }}
                    />
                    <span>{item.label}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-secondary)', marginLeft: 4 }}>
                      {item.desc}
                    </span>
                  </Checkbox>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* 聚焦深度 - 始终显示 */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          margin: '10px 0 4px',
        }}>
        聚焦深度{selectedNodeId ? '' : '（未选中节点）'}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {focusDepthOptions.map((opt) => (
          <Button
            key={opt.value}
            size='small'
            type={focusDepth === opt.value ? 'primary' : 'text'}
            onClick={() => {
              canvasStore.focusDepth = opt.value;
            }}
            style={{ fontSize: 10, padding: '0 8px', height: 22 }}>
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
});

// ── 侧栏容器：仅订阅 sidebarStore（collapsed/width），不订阅 canvasStore ──

export const TreeBrowserSidebar = memo(function TreeBrowserSidebar() {
  const { collapsed, width } = useSnapshot(sidebarStore);
  const [activeTab, setActiveTab] = useState<'search' | 'filter'>('search');

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = sidebarStore.width;

    const onMouseMove = (ev: MouseEvent) => {
      setSidebarWidth(startWidth + (ev.clientX - startX));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          bottom: 'calc(12px + var(--terminal-offset, 0px))',
          width: width,
          zIndex: 20,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
        className={`tree-browser-sidebar sidebar-transition${collapsed ? ' sidebar-transition--hidden' : ''}`}>
        {/* 右侧 resize handle */}
        <div className='sidebar-resize-handle' onMouseDown={handleSidebarResizeStart} />
        <Button
          className='sidebar-collapse-btn'
          size='small'
          type='text'
          icon={<MenuFoldOutlined />}
          onClick={() => {
            sidebarStore.collapsed = true;
            closeMobileSidebar(); // 移动端同时关闭 Drawer（桌面端 no-op）
          }}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 30,
            borderRadius: '50%',
          }}
        />
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <div style={getTabStyle(activeTab === 'search')} onClick={() => setActiveTab('search')}>
            搜索
          </div>
          <div style={getTabStyle(activeTab === 'filter')} onClick={() => setActiveTab('filter')}>
            筛选
          </div>
        </div>

        {activeTab === 'search' && <SearchTreeTab />}
        {activeTab === 'filter' && <FilterTreeTab />}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 20,
          width: 32,
          height: 48,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        }}
        className={`sidebar-collapsed-btn${collapsed ? '' : ' sidebar-collapsed-btn--hidden'}`}
        onClick={() => {
          sidebarStore.collapsed = false;
        }}>
        <MenuUnfoldOutlined style={{ fontSize: 14 }} />
      </div>
    </>
  );
});
