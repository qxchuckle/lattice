import { memo, useRef, useEffect } from 'react';
import { Input, Button, Tooltip, Checkbox } from 'antd';
import type { InputRef } from 'antd';
import { UpOutlined, DownOutlined, CloseOutlined } from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import {
  canvasSearchStore,
  canvasStore,
  cyRef,
  themeStore,
  selectNode,
  closeDetail,
  closeCanvasSearch,
  getVisibleCanvasCenter,
} from '../store';
import { applyFocus, clearFocus } from './graph/layout';

/** 执行搜索：从可见节点中筛选匹配项，并添加高亮 class */
function searchNodes(query: string): void {
  const cy = cyRef.current;
  canvasSearchStore.query = query;
  if (!cy || !query.trim()) {
    cy?.nodes().removeClass('search-match search-current');
    canvasSearchStore.matchIds = [];
    canvasSearchStore.matchIndex = -1;
    return;
  }
  const keyword = query.toLowerCase().trim();
  const matchIds: string[] = [];
  cy.batch(() => {
    cy.nodes().removeClass('search-match search-current');
    cy.nodes().forEach((node) => {
      const data = node.data();
      const entityType = data.entityType as string;
      let text = '';
      if (entityType === 'task') {
        text = (data.title as string) || (data.taskId as string) || '';
      } else if (entityType === 'project') {
        text = (data.name as string) || (data.projectId as string) || '';
      } else if (entityType === 'spec') {
        text = (data.title as string) || (data.specId as string) || '';
      }
      if (text.toLowerCase().includes(keyword)) {
        matchIds.push(node.id());
        node.addClass('search-match');
      }
    });
  });
  canvasSearchStore.matchIds = matchIds;
  canvasSearchStore.matchIndex = matchIds.length > 0 ? 0 : -1;
  if (matchIds.length > 0) {
    focusCurrentMatch();
  }
}

/** 聚焦当前匹配节点 */
function focusCurrentMatch(): void {
  const cy = cyRef.current;
  if (!cy) return;
  const { matchIds, matchIndex, autoSelect } = canvasSearchStore;
  if (matchIndex < 0 || matchIndex >= matchIds.length) return;
  const nodeId = matchIds[matchIndex];
  const node = cy.getElementById(nodeId);
  if (node.length === 0) return;
  const data = node.data() as Record<string, unknown>;
  const entityType = data.entityType as 'task' | 'project' | 'spec';

  // 更新当前匹配高亮
  cy.nodes().removeClass('search-current');
  node.addClass('search-current');

  if (autoSelect) {
    // 选中模式：selectNode 自然替换旧选中，applyFocus force=true 确保跳到新节点
    selectNode(nodeId, entityType, data);
    applyFocus(cy, nodeId, canvasStore.focusDepth, false, true);
  } else {
    // 仅聚焦模式：若有选中先取消选中
    if (canvasStore.selectedNodeId) {
      closeDetail();
      clearFocus(cy);
    }
    // 仅移动视角到节点（不选中、不高亮邻域）
    const container = cy.container();
    if (container) {
      const center = getVisibleCanvasCenter(container.clientWidth, container.clientHeight);
      const targetZoom = Math.max(cy.zoom(), 1.0);
      const nodePos = node.position();
      cy.animate({
        pan: {
          x: center.x - nodePos.x * targetZoom,
          y: center.y - nodePos.y * targetZoom,
        },
        zoom: targetZoom,
        duration: 300,
      });
    }
  }
}

function focusNextMatch(): void {
  const { matchIds, matchIndex } = canvasSearchStore;
  if (matchIds.length === 0) return;
  canvasSearchStore.matchIndex = (matchIndex + 1) % matchIds.length;
  focusCurrentMatch();
}

function focusPrevMatch(): void {
  const { matchIds, matchIndex } = canvasSearchStore;
  if (matchIds.length === 0) return;
  canvasSearchStore.matchIndex = (matchIndex - 1 + matchIds.length) % matchIds.length;
  focusCurrentMatch();
}

/** 画布搜索框：类似浏览器 Cmd+F 搜索 */
export const CanvasSearchBar = memo(function CanvasSearchBar() {
  const { open, query, matchIds, matchIndex, autoSelect } = useSnapshot(canvasSearchStore);
  const { mode } = useSnapshot(themeStore);
  const inputRef = useRef<InputRef>(null);
  const isComposingRef = useRef(false);
  const isDark = mode === 'dark';

  // 打开时自动聚焦输入框
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  if (!open) return null;

  const hasMatches = matchIds.length > 0;
  const current = matchIndex >= 0 ? matchIndex + 1 : 0;
  const total = matchIds.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // IME composition 期间 Enter 确认输入，不触发搜索
      if (isComposingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        focusPrevMatch();
      } else if (canvasSearchStore.matchIds.length === 0) {
        // 没有匹配结果，执行搜索
        searchNodes(canvasSearchStore.query);
      } else {
        focusNextMatch();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (hasMatches) focusNextMatch();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (hasMatches) focusPrevMatch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeCanvasSearch();
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 21,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        background: isDark ? '#1D1D26' : '#FFFFFF',
        border: `1px solid ${isDark ? '#3D3D48' : '#E0E0E0'}`,
        borderRadius: 20,
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        fontSize: 12,
      }}>
      <Input
        ref={inputRef}
        id='canvas-search-input'
        size='small'
        variant='borderless'
        placeholder='搜索画布节点...'
        value={query}
        onChange={(e) => {
          // 仅更新 query，不立即搜索（等待 Enter），避免中文输入被打断
          canvasSearchStore.query = e.target.value;
          // 清除之前的匹配结果和高亮
          if (canvasSearchStore.matchIds.length > 0) {
            const cy = cyRef.current;
            cy?.nodes().removeClass('search-match search-current');
            canvasSearchStore.matchIds = [];
            canvasSearchStore.matchIndex = -1;
          }
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
        }}
        onKeyDown={handleKeyDown}
        style={{ width: 150, fontSize: 12, padding: '0 4px' }}
      />
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          opacity: hasMatches ? 1 : 0.4,
          whiteSpace: 'nowrap',
          minWidth: 28,
          textAlign: 'center',
        }}>
        {hasMatches ? `${current}/${total}` : '0/0'}
      </span>
      <Tooltip title='上一个 (Shift+Enter)'>
        <Button
          size='small'
          type='text'
          icon={<UpOutlined style={{ fontSize: 11 }} />}
          disabled={!hasMatches}
          onClick={focusPrevMatch}
          style={{ borderRadius: '50%', minWidth: 24, width: 24, height: 24, padding: 0 }}
        />
      </Tooltip>
      <Tooltip title='下一个 (Enter)'>
        <Button
          size='small'
          type='text'
          icon={<DownOutlined style={{ fontSize: 11 }} />}
          disabled={!hasMatches}
          onClick={focusNextMatch}
          style={{ borderRadius: '50%', minWidth: 24, width: 24, height: 24, padding: 0 }}
        />
      </Tooltip>
      <Checkbox
        checked={!autoSelect}
        onChange={(e) => {
          const val = !e.target.checked;
          canvasSearchStore.autoSelect = val;
          localStorage.setItem('lattice-canvas-search-autoselect', String(val));
          if (hasMatches) focusCurrentMatch();
        }}
        style={{ fontSize: 11, marginLeft: 2 }}>
        <span style={{ fontSize: 11 }}>仅聚焦</span>
      </Checkbox>
      <Tooltip title='关闭 (Esc)'>
        <Button
          size='small'
          type='text'
          icon={<CloseOutlined style={{ fontSize: 11 }} />}
          onClick={closeCanvasSearch}
          style={{ borderRadius: '50%', minWidth: 24, width: 24, height: 24, padding: 0 }}
        />
      </Tooltip>
    </div>
  );
});
