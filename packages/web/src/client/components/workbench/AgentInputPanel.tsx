/**
 * AgentInputPanel — Agent 输入栏 + 快捷按钮
 *
 * 输入区复用 ChatInputBox（chip 编辑器：/ 命令、@ 文件/选区、图片粘贴），
 * 与画布模式同一套交互；workbench 额外提供编辑器选区（@selection 入口）。
 */
import { useCallback } from 'react';
import { useSnapshot } from 'valtio';
import type { PromptSegment } from '@qcqx/lattice-agent-protocol';
import { workbenchStore } from './store';
import { ChatInputBox } from '../agent/ChatInputBar';

interface Props {
  onSend: (message: string, segments?: PromptSegment[]) => void;
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

  const handleSend = useCallback(
    (text: string, segments?: PromptSegment[]) => {
      onSend(text, segments);
      workbenchStore.inputMessage = '';
    },
    [onSend],
  );

  const handleQuickAction = useCallback(
    (command: string) => {
      if (command === '__fork__') {
        onFork?.();
        return;
      }
      onSend(command);
    },
    [onSend, onFork],
  );

  // 编辑器选区 → @selection 引用入口（无选区时菜单不显示该入口）
  const getSelection = useCallback(() => {
    const sel = workbenchStore.editorSelection;
    return sel && sel.text.trim() ? { text: sel.text, display: sel.display } : null;
  }, []);

  const statusText =
    snap.agentStatus === 'running'
      ? '⏳ Agent 响应中...'
      : snap.agentStatus === 'connecting'
        ? '🔌 连接中...'
        : snap.agentStatus === 'error'
          ? '❌ 错误'
          : `📍 ${snap.headNodeId ? 'HEAD 已定位' : '无会话'}`;

  return (
    <div
      style={{
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
            title={action.command}>
            {action.icon} {action.label}
          </button>
        ))}
      </div>

      {/* 输入区（chip 编辑器：/ 命令、@ 文件/选区、图片粘贴；qoder 源默认支持图片） */}
      <ChatInputBox
        placeholder='输入消息...（/ 触发命令，@ 引用文件/选区）'
        canSubmit={snap.agentStatus !== 'running'}
        onSubmit={handleSend}
        allowImages
        getSelection={getSelection}
      />

      {/* 流式响应预览 */}
      {snap.streamingText && (
        <div
          style={{
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
