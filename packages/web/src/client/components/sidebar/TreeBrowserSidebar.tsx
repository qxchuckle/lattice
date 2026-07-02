import { useState } from 'react';
import { Input, Button, Skeleton, Empty, Tag, Checkbox } from 'antd';
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
import { canvasStore, sidebarStore, getViewPath } from '../../store';
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

/** 树节点图标 */
function getNodeIcon(node: TreeNode): React.ReactNode {
  switch (node.type) {
    case 'spec-root':
      return <FileTextOutlined style={{ fontSize: 12, color: '#13C2C2' }} />;
    case 'project-root':
      return <FolderOutlined style={{ fontSize: 12, color: '#722ED1' }} />;
    case 'task-root':
      return <AimOutlined style={{ fontSize: 12, color: '#1677FF' }} />;
    case 'spec-scope':
      return <FolderOutlined style={{ fontSize: 11, color: 'var(--text-secondary)' }} />;
    case 'spec-item':
      return <FileTextOutlined style={{ fontSize: 11, color: '#13C2C2' }} />;
    case 'project-item':
      return <FolderOutlined style={{ fontSize: 11, color: '#722ED1' }} />;
    case 'task-item':
      return <AimOutlined style={{ fontSize: 11, color: getEntityColor('task') }} />;
    case 'search-result':
      return <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>●</span>;
    default:
      return null;
  }
}

/** 递归树节点组件 */
function TreeItem({
  node,
  depth,
  expandedKeys,
  onToggle,
  onNavigate,
}: {
  node: TreeNode;
  depth: number;
  expandedKeys: Record<string, boolean>;
  onToggle: (key: string) => void;
  onNavigate: (node: TreeNode) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedKeys[node.key];
  const isLeaf =
    node.type === 'task-item' ||
    node.type === 'spec-item' ||
    (node.type === 'project-item' && !hasChildren);
  const isSearchResult = node.type === 'search-result';

  const colorMap: Record<string, string> = {
    task: getEntityColor('task'),
    project: getEntityColor('project'),
    spec: getEntityColor('spec'),
    checkpoint: getEntityColor('checkpoint'),
    relation: getEntityColor('project'),
  };

  return (
    <>
      <div
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
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onClick={() => {
          if (hasChildren && !isLeaf) {
            onToggle(node.key);
          } else if (node.entityId && node.viewMode) {
            onNavigate(node);
          }
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}>
        {hasChildren && !isLeaf ? (
          isExpanded ? (
            <DownOutlined style={{ fontSize: 8, flexShrink: 0 }} />
          ) : (
            <RightOutlined style={{ fontSize: 8, flexShrink: 0 }} />
          )
        ) : (
          <span style={{ width: 8, flexShrink: 0 }} />
        )}
        {getNodeIcon(node)}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
          {truncate(node.title, 32)}
        </span>
        {node.meta?.status && node.type === 'task-item' && (
          <Tag
            color={getEntityColor('task')}
            style={{ fontSize: 9, margin: 0, lineHeight: '14px', padding: '0 3px', flexShrink: 0 }}>
            {node.meta.status}
          </Tag>
        )}
        {isSearchResult && node.meta?.desc && (
          <Tag
            color={colorMap[node.meta.desc] || undefined}
            style={{ fontSize: 9, margin: 0, lineHeight: '14px', padding: '0 3px', flexShrink: 0 }}>
            {node.meta.desc}
          </Tag>
        )}
        {node.meta?.scope && node.type === 'spec-item' && (
          <Tag
            style={{ fontSize: 9, margin: 0, lineHeight: '14px', padding: '0 3px', flexShrink: 0 }}>
            {node.meta.scope}
          </Tag>
        )}
      </div>
      {isExpanded &&
        hasChildren &&
        node.children!.map((child) => (
          <TreeItem
            key={child.key}
            node={child}
            depth={depth + 1}
            expandedKeys={expandedKeys}
            onToggle={onToggle}
            onNavigate={onNavigate}
          />
        ))}
    </>
  );
}

/** 树形浏览器侧栏：顶部 Tab 切换搜索/筛选 */
export function TreeBrowserSidebar() {
  const navigate = useNavigate();
  const { collapsed, searchKeyword, expandedKeys } = useSnapshot(sidebarStore);
  const { visibleTypes, visibleEdgeTypes, focusDepth, selectedNodeId } = useSnapshot(canvasStore);
  const searchResult = useSearch();
  const { tree, loading } = useTreeData();
  const [activeTab, setActiveTab] = useState<'search' | 'filter'>('search');

  const handleToggle = (key: string) => {
    sidebarStore.expandedKeys[key] = !expandedKeys[key];
  };
  const handleNavigate = (node: TreeNode) => {
    if (node.entityId && node.viewMode) navigate(getViewPath(node.viewMode, node.entityId));
  };

  const isSearching = searchKeyword.length > 0;
  const searchItems = isSearching && searchResult.data ? flattenSearch(searchResult.data) : [];
  const filteredTree = isSearching ? filterTree(tree, searchKeyword) : tree;

  const allNodesChecked = nodeLegendItems.every((item) => visibleTypes[item.key]);
  const allEdgesChecked = edgeLegendItems.every((item) => visibleEdgeTypes[item.key]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    textAlign: 'center' as const,
    padding: '6px 0',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    color: active ? 'var(--brand-color)' : 'var(--text-secondary)',
    borderBottom: active ? '2px solid var(--brand-color)' : '2px solid transparent',
    transition: 'all 0.2s',
  });

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          bottom: 12,
          width: 260,
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
          <div style={tabStyle(activeTab === 'search')} onClick={() => setActiveTab('search')}>
            搜索
          </div>
          <div style={tabStyle(activeTab === 'filter')} onClick={() => setActiveTab('filter')}>
            筛选
          </div>
        </div>

        {activeTab === 'search' && (
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
                    <TreeItem
                      key={node.key}
                      node={node}
                      depth={0}
                      expandedKeys={{}}
                      onToggle={() => {}}
                      onNavigate={handleNavigate}
                    />
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
                        <TreeItem
                          key={node.key}
                          node={node}
                          depth={0}
                          expandedKeys={Object.fromEntries(
                            Object.keys(expandedKeys).map((k) => [k, true]),
                          )}
                          onToggle={handleToggle}
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
                  <TreeItem
                    key={node.key}
                    node={node}
                    depth={0}
                    expandedKeys={expandedKeys as Record<string, boolean>}
                    onToggle={handleToggle}
                    onNavigate={handleNavigate}
                  />
                ))}
            </div>
          </>
        )}

        {activeTab === 'filter' && (
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
              indeterminate={
                !allNodesChecked && nodeLegendItems.some((item) => visibleTypes[item.key])
              }
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
        )}
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
}
