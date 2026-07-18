import { memo, useRef, useEffect, useCallback, useState } from 'react';
import { Input, Skeleton, Empty } from 'antd';
import type { InputRef } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import { useNavigate } from 'react-router';
import type cytoscape from 'cytoscape';
import type { SearchResult } from '@qcqx/lattice-core';
import { useIsMobile } from '../hooks';
import {
  globalSearchStore,
  closeGlobalSearch,
  canvasStore,
  cyRef,
  selectNode,
  getViewPath,
  themeStore,
} from '../store';
import { useGlobalSearch } from '../hooks';
import { getEntityColor } from '../lib';
import { applyFocus } from './graph/layout';
import { extractSearchResultInfo, searchTypeOptions } from './sidebar/treeUtils';

/** 构造候选节点 ID 列表，用于在画布上匹配搜索结果对应的节点 */
function buildCandidateIds(entityId: string, entityType: string): string[] {
  const candidates: string[] = [];

  if (entityType === 'spec') {
    candidates.push(`spec-${entityId}`);
  } else {
    candidates.push(entityId);
  }

  // 多用户模式：节点 ID 带 ${username}: 前缀（全局 spec 除外）
  const { userFilter } = canvasStore;
  if (userFilter.length >= 2) {
    for (const u of userFilter) {
      if (entityType === 'spec') {
        candidates.push(`${u}:spec-${entityId}`);
      } else {
        candidates.push(`${u}:${entityId}`);
      }
    }
  }

  return candidates;
}

/** 在当前画布上查找搜索结果对应的节点 */
function findNodeOnCanvas(
  cy: cytoscape.Core,
  entityId: string,
  entityType: string,
): cytoscape.NodeSingular | null {
  // 优先用 getElementById（O(1)）
  for (const cid of buildCandidateIds(entityId, entityType)) {
    const node = cy.getElementById(cid);
    if (node.length > 0) return node;
  }

  // 回退：遍历节点按 data 字段匹配（O(n)）
  const dataField =
    entityType === 'task'
      ? 'taskId'
      : entityType === 'project'
        ? 'projectId'
        : entityType === 'spec'
          ? 'specId'
          : null;
  if (!dataField) return null;

  let found: cytoscape.NodeSingular | null = null;
  cy.nodes().forEach((node) => {
    if (found) return;
    if (node.data('entityType') === entityType && node.data(dataField) === entityId) {
      found = node;
    }
  });
  return found;
}

/** 点击搜索结果：定位画布节点或导航切换视角 */
function handleResultClick(item: SearchResult, navigate: (path: string) => void): void {
  const { id, mode } = extractSearchResultInfo(item);
  const cy = cyRef.current;

  if (cy) {
    const node = findNodeOnCanvas(cy, id, item.type);
    if (node) {
      // 节点在画布上 → 直接定位（不关闭面板，支持多次切换）
      const data = node.data() as Record<string, unknown>;
      const entityType = data.entityType as 'task' | 'project' | 'spec';
      selectNode(node.id(), entityType, data);
      applyFocus(cy, node.id(), canvasStore.focusDepth, false, true);
      return;
    }
  }

  // 节点不在画布上 → 导航到对应视角（不关闭面板）
  navigate(getViewPath(mode, id));
}

// ── 搜索结果项（memo，props 稳定时跳过重渲染）──

interface ResultItemProps {
  item: SearchResult;
  index: number;
  selectedIndex: number;
  isDark: boolean;
  onClick: (item: SearchResult) => void;
  onHover: (index: number) => void;
}

const ENTITY_TYPE_LABEL: Record<string, string> = {
  task: '任务',
  project: '项目',
  spec: 'Spec',
  relation: '关系',
};

const ResultItem = memo(function ResultItem({
  item,
  index,
  selectedIndex,
  isDark,
  onClick,
  onHover,
}: ResultItemProps) {
  const color = getEntityColor(item.type);
  const isSelected = index === selectedIndex;

  return (
    <div
      onMouseEnter={() => onHover(index)}
      onClick={() => onClick(item)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 14px',
        cursor: 'pointer',
        background: isSelected
          ? isDark
            ? 'rgba(64, 150, 255, 0.12)'
            : 'rgba(22, 119, 255, 0.08)'
          : 'transparent',
        borderLeft: isSelected ? '2px solid var(--brand-color)' : '2px solid transparent',
        transition: 'background 0.1s',
      }}>
      <span
        style={{
          flexShrink: 0,
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          marginTop: 5,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {item.title}
        </div>
        {item.snippet && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 1,
            }}>
            {item.snippet}
          </div>
        )}
      </div>
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          color: 'var(--text-secondary)',
          opacity: 0.7,
          marginTop: 2,
        }}>
        {ENTITY_TYPE_LABEL[item.type] || item.type}
      </span>
    </div>
  );
});

// ── 全局搜索面板 ──

export const GlobalSearchPanel = memo(function GlobalSearchPanel() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const { open, searchType } = useSnapshot(globalSearchStore);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const { mode } = useSnapshot(themeStore);
  const isDark = mode === 'dark';
  const isMobile = useIsMobile();
  const searchResult = useGlobalSearch(query);
  const inputRef = useRef<InputRef>(null);
  const isComposingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时自动聚焦输入框
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  // 打开时重置局部状态
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(-1);
    }
  }, [open]);

  // 搜索结果变化时重置选中项
  const results = searchResult.data || [];
  const isLoading = searchResult.isLoading && query.length > 0;

  useEffect(() => {
    setSelectedIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  const handleClick = useCallback((item: SearchResult) => {
    handleResultClick(item, navigateRef.current);
  }, []);

  const handleHover = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME composition 期间不处理任何快捷键，让浏览器/IME 处理候选导航
    if (isComposingRef.current) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        handleClick(results[selectedIndex] as SearchResult);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeGlobalSearch();
    }
  };

  // 滚动选中项到可视区域
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const container = listRef.current;
    const item = container.children[selectedIndex] as HTMLElement;
    if (item) {
      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;
      if (itemTop < container.scrollTop) {
        container.scrollTop = itemTop;
      } else if (itemBottom > container.scrollTop + container.clientHeight) {
        container.scrollTop = itemBottom - container.clientHeight;
      }
    }
  }, [selectedIndex]);

  if (!open) return null;

  const hasQuery = query.length > 0;
  const hasResults = results.length > 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: isMobile ? 56 : 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        width: isMobile ? 'calc(100vw - 24px)' : 480,
        maxWidth: '90vw',
        background: isDark ? '#1D1D26' : '#FFFFFF',
        border: `1px solid var(--border)`,
        borderRadius: 12,
        boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.32)' : '0 8px 32px rgba(0,0,0,0.16)',
        overflow: 'hidden',
      }}>
      {/* 搜索输入 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
        <SearchOutlined style={{ color: 'var(--text-secondary)', fontSize: 14 }} />
        <Input
          ref={inputRef}
          variant='borderless'
          placeholder='搜索任务、项目、Spec... (⌘P)'
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={handleKeyDown}
          style={{ fontSize: 13, padding: 0, color: 'var(--text)' }}
        />
      </div>

      {/* 类型筛选条 */}
      <div style={{ display: 'flex', gap: 2, padding: '0 14px 6px' }}>
        {searchTypeOptions.map((opt) => {
          const active = searchType === opt.value;
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
                userSelect: 'none',
              }}
              onClick={() => {
                globalSearchStore.searchType = opt.value;
              }}>
              {opt.label}
            </div>
          );
        })}
      </div>

      {/* 结果区域 */}
      {hasQuery && (
        <div
          ref={listRef}
          style={{
            maxHeight: 360,
            overflowY: 'auto',
            borderTop: '1px solid var(--border)',
          }}>
          {isLoading && (
            <div style={{ padding: '12px 14px' }}>
              <Skeleton active paragraph={{ rows: 3 }} />
            </div>
          )}
          {!isLoading && !hasResults && (
            <Empty
              description='无搜索结果'
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ padding: '20px 0' }}
            />
          )}
          {!isLoading && hasResults && (
            <>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  padding: '4px 14px',
                }}>
                搜索结果 ({results.length})
              </div>
              {results.map((item, i) => (
                <ResultItem
                  key={`${item.type}-${i}-${item.title}`}
                  item={item as SearchResult}
                  index={i}
                  selectedIndex={selectedIndex}
                  isDark={isDark}
                  onClick={handleClick}
                  onHover={handleHover}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* 底部提示 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '4px 14px',
          borderTop: '1px solid var(--border)',
          fontSize: 10,
          color: 'var(--text-secondary)',
          opacity: 0.7,
        }}>
        <span>↑↓ 导航 · Enter 定位 · Esc 关闭</span>
        <span>hybridSearch</span>
      </div>
    </div>
  );
});
