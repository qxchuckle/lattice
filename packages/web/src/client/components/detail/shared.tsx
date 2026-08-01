/**
 * DetailPanel 共享组件 + 常量
 *
 * 从 DetailPanel.tsx 拆分：SearchFilterBar、RelatedTasksTab、ProjectRelationsTab、
 * DetailHeader、常量定义等，供各子视图复用。
 */
import { Empty, Tag, Button, Tooltip, List, Input, Spin } from 'antd';
import { CloseOutlined, AimOutlined, MenuFoldOutlined, SearchOutlined } from '@ant-design/icons';
import { useState, useMemo, type ReactNode } from 'react';
import type { TaskMeta, ProjectRelation, SearchResult } from '@qcqx/lattice-core';
import { closeDetail, locateNode, toggleDetailCollapse, getViewPath } from '../../store';
import { useProjectTaskSearch } from '../../hooks';
import { getTaskStatusColor, getEntityColor, truncate } from '../../lib';

// ── 常量 ──

const ENTITY_TYPE_LABELS: Record<string, string> = {
  task: '任务',
  project: '项目',
  spec: 'Spec',
};

const TASK_STATUS_OPTIONS = [
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
];

/** Checkpoint 11 类型的中文 label 映射 */
const CHECKPOINT_TYPE_LABELS: { value: string; label: string }[] = [
  { value: 'context', label: '背景' },
  { value: 'correction', label: '纠错' },
  { value: 'constraint', label: '约束' },
  { value: 'assumption', label: '假设' },
  { value: 'followup', label: '待办' },
  { value: 'note', label: '记录' },
  { value: 'decision', label: '决策' },
  { value: 'pivot', label: '转折' },
  { value: 'milestone', label: '里程碑' },
  { value: 'issue', label: '问题' },
  { value: 'summary', label: '总结' },
];

export function getCheckpointTimelineColor(type: string): string {
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

export { TASK_STATUS_OPTIONS, CHECKPOINT_TYPE_LABELS, ENTITY_TYPE_LABELS };

// ── 通用搜索 + 筛选容器 ──

interface SearchItem {
  id: string;
  title: string;
  snippet?: string;
  status?: string;
}

/** 通用搜索 + 筛选容器（render props，调用方用 filtered 渲染 List/Timeline） */
export function SearchFilterBar<T>({
  items,
  placeholder,
  getSearchText,
  filterOptions,
  getFilterValue,
  children,
}: {
  items: T[];
  placeholder: string;
  getSearchText: (item: T) => string;
  filterOptions?: { value: string; label: string }[];
  getFilterValue?: (item: T) => string;
  children: (filtered: T[]) => ReactNode;
}) {
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<string[]>([]);
  const filtered = useMemo(() => {
    let result = items;
    if (filter.length > 0 && getFilterValue) {
      result = result.filter((item) => filter.includes(getFilterValue(item)));
    }
    if (keyword) {
      const lower = keyword.toLowerCase();
      result = result.filter((item) => getSearchText(item).toLowerCase().includes(lower));
    }
    return result;
  }, [items, keyword, filter, getSearchText, getFilterValue]);

  return (
    <div className='search-filter-bar'>
      <Input
        placeholder={placeholder}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        allowClear
        size='small'
        prefix={<SearchOutlined />}
        style={{ marginBottom: 8 }}
      />
      {filterOptions && filterOptions.length > 1 && (
        <div className='search-filter-bar__filters' style={{ marginBottom: 8 }}>
          {filterOptions.map((opt) => (
            <Tag.CheckableTag
              key={opt.value}
              checked={filter.includes(opt.value)}
              onChange={(checked) => {
                setFilter((prev) =>
                  checked ? [...prev, opt.value] : prev.filter((v) => v !== opt.value),
                );
              }}>
              {opt.label}
            </Tag.CheckableTag>
          ))}
        </div>
      )}
      {children(filtered)}
    </div>
  );
}

/** 从 task 类型搜索结果提取 taskId（filePath 格式 user/<u>/task/<taskId>/prd.md） */
export function extractTaskIdFromSearchResult(r: SearchResult): string | null {
  const meta = r.meta;
  const directId = (meta.id as string) || meta.taskId;
  if (directId) return directId;
  const filePath = meta.filePath || '';
  const match = filePath.match(/\/task\/([^/]+)\//);
  return match ? match[1] : null;
}

// ── 关联任务 Tab：RAG 搜索 + 状态筛选 ──

export function RelatedTasksTab({
  tasks,
  projectId,
  navigate,
}: {
  tasks: TaskMeta[];
  projectId: string;
  navigate: (path: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const searchQuery = useProjectTaskSearch(projectId, keyword);

  const taskMap = useMemo(() => {
    const map = new Map<string, TaskMeta>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  const isSearching = keyword.length > 0;

  const searchItems = useMemo((): SearchItem[] | null => {
    if (!searchQuery.data || !isSearching) return null;
    return searchQuery.data
      .map((r): SearchItem | null => {
        const taskId = extractTaskIdFromSearchResult(r);
        if (!taskId) return null;
        const task = taskMap.get(taskId);
        return {
          id: taskId,
          title: r.title || task?.title || taskId,
          snippet: r.snippet,
          status: task?.status,
        };
      })
      .filter((x): x is SearchItem => x !== null);
  }, [searchQuery.data, isSearching, taskMap]);

  const filteredSearchItems = useMemo(() => {
    if (!searchItems) return null;
    if (statusFilter.length === 0) return searchItems;
    return searchItems.filter((s) => s.status && statusFilter.includes(s.status));
  }, [searchItems, statusFilter]);

  const filteredTasks = useMemo(() => {
    if (statusFilter.length === 0) return tasks;
    return tasks.filter((t) => statusFilter.includes(t.status));
  }, [tasks, statusFilter]);

  return (
    <div className='related-tasks-tab'>
      <Input
        placeholder='RAG 搜索关联任务...'
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        allowClear
        size='small'
        prefix={<SearchOutlined />}
        style={{ marginBottom: 8 }}
      />
      <div className='related-tasks-tab__filters' style={{ marginBottom: 8 }}>
        {TASK_STATUS_OPTIONS.map((opt) => (
          <Tag.CheckableTag
            key={opt.value}
            checked={statusFilter.includes(opt.value)}
            onChange={(checked) => {
              setStatusFilter((prev) =>
                checked ? [...prev, opt.value] : prev.filter((v) => v !== opt.value),
              );
            }}>
            {opt.label}
          </Tag.CheckableTag>
        ))}
      </div>
      {isSearching && searchQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 12 }}>
          <Spin size='small' />
        </div>
      ) : isSearching ? (
        filteredSearchItems && filteredSearchItems.length > 0 ? (
          <List
            size='small'
            dataSource={filteredSearchItems}
            renderItem={(item) => (
              <List.Item
                className='detail-list-item'
                onClick={() => navigate(getViewPath('task', item.id))}>
                <div className='detail-list-item__relation'>
                  <div className='detail-list-item__row'>
                    {item.status && (
                      <Tag
                        color={getTaskStatusColor(item.status)}
                        style={{ fontSize: 10, margin: 0 }}>
                        {item.status}
                      </Tag>
                    )}
                    <span>{truncate(item.title, 30)}</span>
                  </div>
                  {item.snippet && (
                    <span className='detail-list-item__snippet'>{truncate(item.snippet, 80)}</span>
                  )}
                </div>
              </List.Item>
            )}
          />
        ) : (
          <Empty description='未找到匹配的关联任务' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )
      ) : filteredTasks.length > 0 ? (
        <List
          size='small'
          dataSource={filteredTasks}
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
      ) : (
        <Empty description='无符合条件的关联任务' image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
}

// ── 项目关系 Tab ──

export function ProjectRelationsTab({
  relations,
  currentProjectId,
  projectNameMap,
  navigate,
}: {
  relations: ProjectRelation[];
  currentProjectId: string;
  projectNameMap: Map<string, string>;
  navigate: (path: string) => void;
}) {
  const [keyword, setKeyword] = useState('');

  const items = useMemo(() => {
    return relations.map((r) => {
      const otherId = r.projectA === currentProjectId ? r.projectB : r.projectA;
      const name = projectNameMap.get(otherId);
      return { r, otherId, name };
    });
  }, [relations, currentProjectId, projectNameMap]);

  const filtered = useMemo(() => {
    if (!keyword) return items;
    const lower = keyword.toLowerCase();
    return items.filter(
      ({ r, otherId, name }) =>
        r.type.toLowerCase().includes(lower) ||
        otherId.toLowerCase().includes(lower) ||
        (name && name.toLowerCase().includes(lower)),
    );
  }, [items, keyword]);

  return (
    <div className='project-relations-tab'>
      <Input
        placeholder='搜索项目关系...'
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        allowClear
        size='small'
        prefix={<SearchOutlined />}
        style={{ marginBottom: 8 }}
      />
      {filtered.length > 0 ? (
        <List
          size='small'
          dataSource={filtered}
          renderItem={({ r, otherId, name }) => (
            <List.Item
              className='detail-list-item'
              onClick={() => navigate(getViewPath('project', otherId))}>
              <div className='detail-list-item__relation'>
                <div className='detail-list-item__row'>
                  <Tag color={getEntityColor('project')} style={{ fontSize: 10, margin: 0 }}>
                    {r.type}
                  </Tag>
                  <span>{name || truncate(otherId, 16)}</span>
                </div>
                <span className='detail-list-item__relation-id mono'>{truncate(otherId, 24)}</span>
              </div>
            </List.Item>
          )}
        />
      ) : (
        <Empty description='无匹配的项目关系' image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
}

// ── 详情面板头部 ──

export function DetailHeader({
  entityId,
  entityType,
}: {
  entityId?: string | null;
  entityType?: string | null;
}) {
  const typeLabel = entityType ? ENTITY_TYPE_LABELS[entityType] || entityType : '';
  return (
    <div className='detail-header'>
      <span className='detail-header__title'>{typeLabel ? `详情-${typeLabel}` : '详情'}</span>
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
