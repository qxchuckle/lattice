/**
 * QueuedMessagesPanel — 排队面板（streaming 期间提交、等待发送的消息）
 *
 * 数据驱动：只读镜像 agentStore.queue（server queue.state 广播驱动），
 * 按 anchorTurnId 分组渲染在锚定 turn 节点内。交互全部发命令给 server（单写权威），
 * server 处理后广播最新队列——client 不做乐观更新，保持多端一致的单一真相：
 *   - 拖拽排序 / ↑↓ 按钮 → queue.update { action:'reorder' }
 *   - 内联编辑 → queue.update { action:'edit' }
 *   - 删除 → queue.update { action:'remove' }
 */
import { useState } from 'react';
import { useSnapshot } from 'valtio';
import { agentStore } from './store';
import {
  removeQueuedMessage,
  reorderQueuedMessage,
  editQueuedMessage,
  steerQueuedMessage,
  computeReorderIndex,
} from './agentStore';

export function QueuedMessagesPanel(props: { anchorTurnId: string }) {
  const snap = useSnapshot(agentStore);
  // 拖拽状态（纯前端视觉反馈；落点确定后才发 reorder 命令）
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // 内联编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  // 引导（steer）loading 态：点击后等待 server abort+dispatch（消息随即离开队列）
  const [steeringId, setSteeringId] = useState<string | null>(null);

  const queued = snap.queue
    .filter((m) => m.anchorTurnId === props.anchorTurnId)
    .sort((a, b) => a.order - b.order);
  if (queued.length === 0) return null;

  /** 组内移动到 targetGroupIndex（映射扁平索引后发命令） */
  const moveTo = (messageId: string, targetGroupIndex: number): void => {
    const newIndex = computeReorderIndex(messageId, targetGroupIndex, props.anchorTurnId);
    if (newIndex >= 0) reorderQueuedMessage(messageId, newIndex);
  };

  const commitEdit = (messageId: string): void => {
    editQueuedMessage(messageId, editText);
    setEditingId(null);
  };

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid var(--border)',
        padding: '6px 8px',
        background: 'var(--bg-tertiary)',
      }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
        ⏳ 等待发送 ({queued.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {queued.map((m, i) => {
          const dispatching = snap.queueDispatching === m.id;
          const editing = editingId === m.id;
          const isDragOver = dragOverIndex === i && dragId !== null && dragId !== m.id;
          return (
            <div
              key={m.id}
              draggable={!editing && !dispatching}
              onDragStart={(e) => {
                e.stopPropagation(); // 防 ReactFlow 劫持拖拽移动节点
                setDragId(m.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragId && dragId !== m.id) setDragOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragId && dragId !== m.id) moveTo(dragId, i);
                setDragId(null);
                setDragOverIndex(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDragOverIndex(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px',
                borderRadius: 6,
                border: `1px solid ${isDragOver ? 'var(--brand-color)' : 'var(--border)'}`,
                background: 'var(--bg-secondary)',
                opacity: dispatching ? 0.6 : dragId === m.id ? 0.4 : 1,
                cursor: editing || dispatching ? 'default' : 'grab',
              }}>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-secondary)',
                  flexShrink: 0,
                  cursor: 'grab',
                }}
                title='拖动排序'>
                ⠿ {i + 1}.
              </span>

              {editing ? (
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitEdit(m.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={() => commitEdit(m.id)}
                  className='nowheel'
                  style={{
                    flex: 1,
                    fontSize: 11,
                    color: 'var(--text)',
                    background: 'var(--bg)',
                    border: '1px solid var(--brand-color)',
                    borderRadius: 4,
                    padding: '2px 4px',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    fontSize: 11,
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={m.content}>
                  {m.content}
                </span>
              )}

              {dispatching ? (
                <span style={{ fontSize: 9, color: 'var(--brand-color)', flexShrink: 0 }}>
                  发送中…
                </span>
              ) : (
                !editing && (
                  <span style={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
                    {/* 上移/下移（拖拽的可靠替代） */}
                    <button
                      type='button'
                      onClick={() => moveTo(m.id, i - 1)}
                      disabled={i === 0}
                      title='上移'
                      style={miniBtn(i === 0)}>
                      ↑
                    </button>
                    <button
                      type='button'
                      onClick={() => moveTo(m.id, i + 1)}
                      disabled={i === queued.length - 1}
                      title='下移'
                      style={miniBtn(i === queued.length - 1)}>
                      ↓
                    </button>
                    <button
                      type='button'
                      onClick={() => {
                        setSteeringId(m.id);
                        steerQueuedMessage(m.id);
                      }}
                      title='引导：中止当前回复，立即发送这条'
                      style={miniBtn(false)}>
                      {steeringId === m.id ? '…' : '⚡'}
                    </button>
                    <button
                      type='button'
                      onClick={() => {
                        setEditingId(m.id);
                        setEditText(m.content);
                      }}
                      title='编辑'
                      style={miniBtn(false)}>
                      ✎
                    </button>
                    <button
                      type='button'
                      onClick={() => removeQueuedMessage(m.id)}
                      title='删除'
                      style={miniBtn(false)}>
                      ✕
                    </button>
                  </span>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 迷你图标按钮样式（disabled 时置灰） */
function miniBtn(disabled: boolean): React.CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    color: disabled ? 'var(--border)' : 'var(--text-secondary)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 10,
    padding: '0 2px',
    lineHeight: 1,
  };
}
