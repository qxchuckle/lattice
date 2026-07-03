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
import { canvasStore, sidebarStore, getViewPath, setSidebarWidth } from '../../store';
import { useSearch } from '../../hooks';
import { getEntityColor, truncate } from '../../lib';
import { useTreeData } from './treeData';
import {
  type TreeNode,
  filterTree,
  flattenSearch,
  nodeLegendItems,
  edgeLegendItems,
  focusDepthOptions,
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

// ── 搜索 Tab：仅订阅 sidebarStore，不订阅 canvasStore ──

const SearchTreeTab = memo(function SearchTreeTab() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { searchKeyword } = useSnapshot(sidebarStore);
  const searchResult = useSearch();
  const { tree, loading } = useTreeData();

  const handleNavigate = useCallback((node: TreeNode) => {
    if (node.entityId && node.viewMode)
      navigateRef.current(getViewPath(node.viewMode, node.entityId));
  }, []);

  const isSearching = searchKeyword.length > 0;
  const searchItems = useMemo(
    () => (isSearching && searchResult.data ? flattenSearch(searchResult.data) : []),
    [isSearching, searchResult.data],
  );
  const filteredTree = useMemo(
    () => (isSearching ? filterTree(tree, searchKeyword) : tree),
    [isSearching, tree, searchKeyword],
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
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
        {loading && <Skeleton active paragraph={{ rows: 6 }} />}
        {!loading && isSearching && searchResult.isLoading && <Skeleton active />}
        {!loading && isSearching && searchItems.length === 0 && !searchResult.isLoading && (
          <Empty description='无搜索结果' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        {!loading && !isSearching && filteredTree.length === 0 && (
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
  const { visibleTypes, visibleEdgeTypes, focusDepth, selectedNodeId } = useSnapshot(canvasStore);

  const allNodesChecked = useMemo(
    () => nodeLegendItems.every((item) => visibleTypes[item.key]),
    [visibleTypes],
  );
  const allEdgesChecked = useMemo(
    () => edgeLegendItems.every((item) => visibleEdgeTypes[item.key]),
    [visibleEdgeTypes],
  );

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}>
        节点类型
      </div>
      <Checkbox
        checked={allNodesChecked}
        indeterminate={!allNodesChecked && nodeLegendItems.some((item) => visibleTypes[item.key])}
        onChange={(e) =>
          nodeLegendItems.forEach((item) => {
            canvasStore.visibleTypes[item.key] = e.target.checked;
          })
        }
        style={{ fontSize: 11, marginBottom: 2 }}>
        全选
      </Checkbox>
      {nodeLegendItems.map((item) => (
        <Checkbox
          key={item.key}
          checked={!!visibleTypes[item.key]}
          onChange={(e) => {
            canvasStore.visibleTypes[item.key] = e.target.checked;
          }}
          style={{ fontSize: 11, marginLeft: 8 }}>
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
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          margin: '10px 0 4px',
        }}>
        边类型
      </div>
      <Checkbox
        checked={allEdgesChecked}
        indeterminate={
          !allEdgesChecked && edgeLegendItems.some((item) => visibleEdgeTypes[item.key])
        }
        onChange={(e) =>
          edgeLegendItems.forEach((item) => {
            canvasStore.visibleEdgeTypes[item.key] = e.target.checked;
          })
        }
        style={{ fontSize: 11, marginBottom: 2 }}>
        全选
      </Checkbox>
      {edgeLegendItems.map((item) => (
        <Checkbox
          key={item.key}
          checked={!!visibleEdgeTypes[item.key]}
          onChange={(e) => {
            canvasStore.visibleEdgeTypes[item.key] = e.target.checked;
          }}
          style={{ fontSize: 11, marginLeft: 8 }}>
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
      {selectedNodeId && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              margin: '10px 0 4px',
            }}>
            聚焦深度
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
        </>
      )}
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
          bottom: 12,
          width: width,
          zIndex: 20,
          background: 'var(--bg-secondary)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
        className={`sidebar-transition${collapsed ? ' sidebar-transition--hidden' : ''}`}>
        {/* 右侧 resize handle */}
        <div className='sidebar-resize-handle' onMouseDown={handleSidebarResizeStart} />
        <Button
          size='small'
          type='text'
          icon={<MenuFoldOutlined />}
          onClick={() => {
            sidebarStore.collapsed = true;
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
          backdropFilter: 'blur(12px)',
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
