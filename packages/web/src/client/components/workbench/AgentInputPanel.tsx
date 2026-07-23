/**
 * AgentInputPanel — Agent 输入栏 + 快捷按钮 + / 命令
 */
import { useState, useCallback, useRef } from 'react';
import { useSnapshot } from 'valtio';
import { workbenchStore } from './store';

interface Props {
  onSend: (message: string) => void;
  onFork?: () => void;
}

const QUICK_ACTIONS = [
  { icon: '🚀', label: '开始任务', command: '/lattice/task/start' },
  { icon: '📝', label: 'Checkpoint', command: '/checkpoint' },
  { icon: '🔍', label: '搜索历史', command: '/lattice/search' },
  { icon: '📋', label: '读Spec', command: '/lattice/spec/list' },
  { icon: '⑂', label: '分叉探索', command: '__fork__' },
  { icon: '🏗', label: '设计模式', command: '/lattice/task/design' },
];

export function AgentInputPanel({ onSend, onFork }: Props) {
  const snap = useSnapshot(workbenchStore);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const text = message.trim();
    if (!text) return;
    onSend(text);
    setMessage('');
    workbenchStore.inputMessage = '';
  }, [message, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleQuickAction = useCallback((command: string) => {
    if (command === '__fork__') {
      onFork?.();
      return;
    }
    onSend(command);
  }, [onSend, onFork]);

  const statusText = snap.agentStatus === 'running' ? '⏳ Agent 响应中...'
    : snap.agentStatus === 'connecting' ? '🔌 连接中...'
    : snap.agentStatus === 'error' ? '❌ 错误'
    : `📍 ${snap.headNodeId ? 'HEAD 已定位' : '无会话'}`;

  return (
    <div style={{
      borderTop: '1px solid var(--lattice-border, #f0f0f0)',
      padding: '8px 12px',
      background: 'var(--lattice-bg, #fff)',
    }}>
      {/* 状态栏 */}
      <div style={{ fontSize: 11, color: '#8C8C8C', marginBottom: 6 }}>
        {statusText}
        {snap.treeId && <span> · 树: {snap.treeId.slice(0, 8)}...</span>}
      </div>

      {/* 快捷按钮 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.command}
            onClick={() => handleQuickAction(action.command)}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              border: '1px solid #D9D9D9',
              borderRadius: 4,
              background: 'transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={action.command}
          >
            {action.icon} {action.label}
          </button>
        ))}
      </div>

      {/* 输入区 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          value={message}
          onChange={(e) => { setMessage(e.target.value); workbenchStore.inputMessage = e.target.value; }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行, / 触发命令)"
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            padding: '8px 12px',
            border: '1px solid #D9D9D9',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim() || snap.agentStatus === 'running'}
          style={{
            padding: '8px 16px',
            background: message.trim() ? '#1677FF' : '#F5F5F5',
            color: message.trim() ? '#fff' : '#BFBFBF',
            border: 'none',
            borderRadius: 8,
            cursor: message.trim() ? 'pointer' : 'default',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          发送
        </button>
      </div>

      {/* 流式响应预览 */}
      {snap.streamingText && (
        <div style={{
          marginTop: 8,
          padding: '8px 12px',
          background: '#F6F6F6',
          borderRadius: 8,
          fontSize: 12,
          maxHeight: 120,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
        }}>
          {snap.streamingText}
          <span style={{ animation: 'blink 1s infinite' }}>▌</span>
        </div>
      )}
    </div>
  );
}
