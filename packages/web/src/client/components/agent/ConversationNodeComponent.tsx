/**
 * ConversationNodeComponent — 一轮对话节点（用户问题 + AI 回复合体）
 * 上部：用户问题  中部：AI 块流  底部：输入框（追问 = 创建子节点）
 */
import { useState, useCallback, useRef, useLayoutEffect, useEffect, memo } from 'react';
import { Handle, Position, NodeResizer, useStoreApi, type NodeProps } from '@xyflow/react';
import { useSnapshot } from 'valtio';
import {
  agentStore,
  submitFromNode,
  abortStream,
  getChildIds,
  getSiblings,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  type TurnNode,
  type NodeUiState,
} from './agentStore';
import { useNodeResize } from './useNodeResize';
import { StreamingBlockRenderer, UsageFooter } from './blocks';

interface NodeData {
  turnId: string;
  [key: string]: unknown;
}

function ConversationNodeInner({ data }: NodeProps) {
  const { turnId } = data as NodeData;
  const snap = useSnapshot(agentStore);
  const turn = snap.turns.get(turnId) as TurnNode | undefined;
  const ui = snap.ui.get(turnId) as NodeUiState | undefined;
  const store = useStoreApi();
  const nodeElRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [hovered, setHovered] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { onResize, onResizeEnd } = useNodeResize(turnId);

  const width = ui?.width ?? 340;
  const height = ui?.height ?? 260;
  const isStreaming = turn?.status === 'streaming';
  const isError = turn?.status === 'error';

  // 流式自动滚动
  useEffect(() => {
    if (isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [isStreaming, turn?.blocks.length, turn?.blocks[turn.blocks.length - 1]]);

  useLayoutEffect(() => {
    const el = nodeElRef.current;
    if (!el) return;
    store
      .getState()
      .updateNodeInternals(new Map([[turnId, { id: turnId, nodeElement: el, force: true }]]));
  }, [width, height, turnId, store]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    submitFromNode(turnId, text);
    setInput('');
  }, [input, turnId]);

  const handleRetry = useCallback(() => {
    if (!turn) return;
    // 重试 = 用相同的 userMessage 创建新子节点
    submitFromNode(turn.parentTurnId, turn.userMessage);
  }, [turn]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (!turn) return null;

  const childIds = getChildIds(turnId);
  const siblings = getSiblings(turnId);
  const siblingIndex = siblings.indexOf(turnId);
  const isCollapsed = ui?.collapsed ?? false;
  const showBottom = hovered || inputFocused || input.trim().length > 0;

  const toggleCollapse = useCallback(() => {
    const u = agentStore.ui.get(turnId);
    if (u) {
      u.collapsed = !u.collapsed;
      u.height = u.collapsed ? 60 : 260;
      agentStore.version++;
    }
  }, [turnId]);

  return (
    <div
      ref={nodeElRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: '100%', height: '100%' }}>
      <NodeResizer
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        isVisible={hovered}
        color='var(--brand-color)'
        handleStyle={{
          background: 'var(--brand-color)',
          width: 10,
          height: 10,
          borderRadius: 2,
          border: '1.5px solid var(--bg-secondary)',
        }}
        lineStyle={{ borderColor: 'var(--brand-color)', borderRadius: 10 }}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />
      <div
        className='nowheel conversation-node'
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 10,
          border: `1.5px solid ${isStreaming ? 'var(--brand-color)' : isError ? '#ff4d4f' : 'var(--border)'}`,
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: isStreaming ? '0 0 12px rgba(22,119,255,0.25)' : 'var(--shadow)',
          color: 'var(--text)',
        }}>
        <Handle
          type='target'
          position={Position.Top}
          style={{ background: 'var(--brand-color)', width: 6, height: 6 }}
        />
        <Handle
          type='source'
          position={Position.Bottom}
          style={{ background: 'var(--brand-color)', width: 6, height: 6 }}
        />

        {/* ── 折叠态：只显示用户问题一行 ── */}
        {isCollapsed ? (
          <div
            style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <span style={{ fontSize: 10 }}>👤</span>
            <span
              style={{
                fontSize: 11,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
              {turn.userMessage}
            </span>
            <button
              onClick={toggleCollapse}
              style={{
                fontSize: 9,
                border: 'none',
                background: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              title='展开'>
              ▼
            </button>
          </div>
        ) : (
          <>
            {/* ── 用户问题 ── */}
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 10 }}>👤</span>
                <span style={{ fontSize: 10, color: 'var(--brand-color)', fontWeight: 600 }}>
                  User
                </span>
                {/* 兄弟分支切换 */}
                {siblings.length > 1 && (
                  <span style={{ fontSize: 9, color: 'var(--text-secondary)', marginLeft: 4 }}>
                    ◀ {siblingIndex + 1}/{siblings.length} ▶
                  </span>
                )}
                {childIds.length > 0 && (
                  <span style={{ fontSize: 9, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                    ⑂ {childIds.length}
                  </span>
                )}
                {/* Fork 按钮（hover 时显示） */}
                {hovered && !isStreaming && (
                  <>
                    <button
                      onClick={() => submitFromNode(turn.parentTurnId, turn.userMessage)}
                      style={{
                        marginLeft: childIds.length > 0 ? 4 : 'auto',
                        padding: '0 4px',
                        fontSize: 9,
                        borderRadius: 3,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                      title='分支：从同一父节点重新提问'>
                      ⑂ 分支
                    </button>
                    <button
                      onClick={toggleCollapse}
                      style={{
                        padding: '0 4px',
                        fontSize: 9,
                        borderRadius: 3,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                      title='折叠节点'>
                      ▲
                    </button>
                  </>
                )}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.3, wordBreak: 'break-word' }}>
                {turn.userMessage}
              </div>
            </div>

            {/* ── AI 回复（块流） ── */}
            <div ref={contentRef} style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 10 }}>🤖</span>
                <span style={{ fontSize: 10, color: '#722ed1', fontWeight: 600 }}>Agent</span>
                <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                  · {turn.sourceId}
                </span>
                {isStreaming && (
                  <span style={{ fontSize: 9, color: 'var(--brand-color)', marginLeft: 'auto' }}>
                    ● 生成中
                  </span>
                )}
                {/* 中止按钮 */}
                {isStreaming && (
                  <button
                    onClick={() => abortStream(turnId)}
                    style={{
                      marginLeft: 4,
                      padding: '1px 6px',
                      fontSize: 9,
                      borderRadius: 4,
                      border: '1px solid #ff4d4f',
                      background: 'transparent',
                      color: '#ff4d4f',
                      cursor: 'pointer',
                    }}
                    title='中止生成'>
                    ⏹ 停止
                  </button>
                )}
              </div>

              {turn.blocks.map((block, i) => (
                <StreamingBlockRenderer
                  key={i}
                  block={block}
                  isLast={isStreaming && i === turn.blocks.length - 1}
                />
              ))}

              {turn.blocks.length === 0 && isStreaming && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>...</div>
              )}

              <UsageFooter usage={turn.usage} model={turn.modelId || undefined} />

              {/* 错误时显示重试按钮 */}
              {isError && (
                <button
                  onClick={handleRetry}
                  style={{
                    marginTop: 6,
                    padding: '3px 10px',
                    fontSize: 10,
                    borderRadius: 4,
                    border: '1px solid var(--brand-color)',
                    background: 'transparent',
                    color: 'var(--brand-color)',
                    cursor: 'pointer',
                  }}>
                  ↻ 重试
                </button>
              )}
            </div>

            {/* ── 底部输入框（追问） ── */}
            {showBottom && (
              <div
                style={{
                  flexShrink: 0,
                  borderTop: '1px solid var(--border)',
                  padding: '4px 8px 6px',
                }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    placeholder='继续追问...'
                    rows={1}
                    className='nowheel'
                    style={{
                      flex: 1,
                      resize: 'none',
                      padding: '5px 8px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      borderRadius: 5,
                      color: 'var(--text)',
                      fontSize: 11,
                      lineHeight: 1.3,
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!input.trim() || isStreaming}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: 'none',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background:
                        input.trim() && !isStreaming ? 'var(--brand-color)' : 'var(--bg-tertiary)',
                      color: input.trim() && !isStreaming ? '#fff' : 'var(--text-secondary)',
                      cursor: input.trim() && !isStreaming ? 'pointer' : 'default',
                    }}>
                    ↑
                  </button>
                </div>
              </div>
            )}
            {/* 展开态内容结束后关闭 fragment */}
          </>
        )}
      </div>
    </div>
  );
}

export const ConversationNodeComponent = memo(ConversationNodeInner);
