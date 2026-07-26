/**
 * AgentPanel — Agent 对话树画布容器
 * 左侧边栏：Activity Bar（图标条）+ 历史面板（可收起/展开，不自动消失）
 * 顶栏：标题 + 状态 + 关闭
 */
import { useEffect, useCallback } from 'react';
import { useSnapshot } from 'valtio';
import { AgentCanvas } from './AgentCanvas';
import {
  agentStore,
  loadConversations,
  switchConversation,
  newConversation,
  deleteConversation,
  abortStream,
  getTotalUsage,
} from './agentStore';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

const ACTIVITY_BAR_WIDTH = 40;

export function AgentPanel() {
  const snap = useSnapshot(agentStore);

  useEffect(() => {
    if (snap.visible) loadConversations();
  }, [snap.visible]);

  // Esc 中止流式
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') abortStream();
  }, []);

  useEffect(() => {
    if (snap.visible) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [snap.visible, handleKeyDown]);

  if (!snap.visible) return null;

  const usage = getTotalUsage();
  const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 800,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--canvas-bg)',
      }}>
      {/* 顶栏 */}
      <div
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          gap: 8,
          background: 'var(--bg-secondary)',
        }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Agent 对话树</span>

        {/* 连接状态 */}
        <span
          style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 8,
            marginLeft: 'auto',
            background: snap.connected ? '#f6ffed' : '#fff2f0',
            color: snap.connected ? '#52c41a' : '#ff4d4f',
            border: `1px solid ${snap.connected ? '#b7eb8f' : '#ffccc7'}`,
          }}>
          {snap.connected ? '● 在线' : '○ 离线'}
        </span>

        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{snap.turns.size} 节点</span>

        {(usage.input > 0 || usage.output > 0) && (
          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }} title='会话累计 token'>
            ↑{fmtTok(usage.input)} ↓{fmtTok(usage.output)}
          </span>
        )}

        <button
          onClick={() => {
            agentStore.visible = false;
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 14,
          }}
          title='收起'>
          ✕
        </button>
      </div>

      {/* 主体：左侧边栏 + 画布 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Activity Bar（图标条） */}
        <div
          style={{
            width: ACTIVITY_BAR_WIDTH,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 8,
            gap: 4,
            background: 'var(--bg-tertiary)',
            borderRight: '1px solid var(--border)',
          }}>
          {/* 历史按钮 */}
          <button
            onClick={() => {
              agentStore.historyOpen = !agentStore.historyOpen;
              if (!agentStore.historyOpen) loadConversations();
            }}
            title='历史会话'
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              background: snap.historyOpen ? 'rgba(22,119,255,0.15)' : 'transparent',
              color: snap.historyOpen ? 'var(--brand-color)' : 'var(--text-secondary)',
              borderLeft: snap.historyOpen
                ? '2px solid var(--brand-color)'
                : '2px solid transparent',
            }}>
            📋
          </button>
        </div>

        {/* 历史面板（展开时） */}
        {snap.historyOpen && (
          <div
            style={{
              width: 220,
              flexShrink: 0,
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
            <div
              style={{
                padding: '10px 12px 6px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
              }}>
              <span>历史会话</span>
              <button
                onClick={newConversation}
                style={{
                  marginLeft: 'auto',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 10,
                  background: 'rgba(22,119,255,0.1)',
                  color: 'var(--brand-color)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontWeight: 500,
                }}>
                + 新建对话
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {snap.conversations.map((c) => (
                <div
                  key={c.treeId}
                  onClick={() => switchConversation(c.treeId)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: 11,
                    borderBottom: '1px solid var(--border)',
                    background: c.treeId === snap.treeId ? 'rgba(22,119,255,0.08)' : 'transparent',
                    borderLeft:
                      c.treeId === snap.treeId
                        ? '2px solid var(--brand-color)'
                        : '2px solid transparent',
                  }}>
                  <div
                    style={{
                      color: 'var(--text)',
                      marginBottom: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                    {c.title || `对话 ${c.treeId.slice(0, 8)}`}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}>
                    <span>
                      {c.nodeCount} 节点 · {timeAgo(c.updatedAt)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(c.treeId);
                      }}
                      style={{
                        marginLeft: 'auto',
                        border: 'none',
                        background: 'none',
                        color: '#ff4d4f',
                        cursor: 'pointer',
                        fontSize: 9,
                        opacity: 0.6,
                      }}
                      title='删除'>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {snap.conversations.length === 0 && (
                <div
                  style={{
                    padding: '16px 12px',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                  }}>
                  暂无历史对话
                </div>
              )}
            </div>
          </div>
        )}

        {/* 画布 */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <AgentCanvas />
        </div>
      </div>
    </div>
  );
}
