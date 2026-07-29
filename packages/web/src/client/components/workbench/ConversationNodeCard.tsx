/**
 * ConversationNodeCard — React Flow 自定义节点卡片
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ConversationNode } from '@qcqx/lattice-agent';

interface NodeCardData {
  node: ConversationNode;
  isHead: boolean;
  isSelected: boolean;
  isStreaming: boolean;
  streamingText?: string;
  [key: string]: unknown;
}

const roleConfig: Record<string, { icon: string; border: string; label: string }> = {
  user: { icon: '👤', border: '#1677FF', label: 'User' },
  assistant: { icon: '🤖', border: '#722ED1', label: 'Agent' },
  tool: { icon: '🔧', border: '#8C8C8C', label: 'Tool' },
  system: { icon: 'ℹ️', border: '#8C8C8C', label: 'System' },
  'merge-summary': { icon: '⑃', border: '#FAAD14', label: 'Merge' },
  aggregation: { icon: '📦', border: '#13C2C2', label: 'Aggregate' },
};

function ConversationNodeCardInner({ data }: NodeProps) {
  const { node, isHead, isSelected, isStreaming, streamingText } = data as unknown as NodeCardData;
  const config = roleConfig[node.role] ?? roleConfig.system;

  const textContent = node.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join(' ')
    .slice(0, 80);

  const displayText = isStreaming && streamingText ? streamingText.slice(0, 80) : textContent;
  const toolCount = node.metadata?.toolCalls?.length ?? 0;
  const fileCount = node.metadata?.fileChanges?.length ?? 0;

  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        border: `2px solid ${isHead ? '#1677FF' : config.border}`,
        background: isSelected ? '#E6F4FF' : 'var(--lattice-bg-elevated, #fff)',
        boxShadow: isHead ? '0 0 0 3px rgba(22,119,255,0.2)' : '0 1px 4px rgba(0,0,0,0.08)',
        minWidth: 160,
        maxWidth: 280,
        fontSize: 12,
        cursor: 'pointer',
        opacity: isStreaming ? 0.9 : 1,
      }}>
      <Handle type='target' position={Position.Left} style={{ opacity: 0 }} />
      <Handle type='source' position={Position.Right} style={{ opacity: 0 }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span>{config.icon}</span>
        <span style={{ fontWeight: 600, color: config.border }}>{config.label}</span>
        {node.agentId && <span style={{ color: '#8C8C8C' }}>· {node.agentId}</span>}
        {isStreaming && <span style={{ animation: 'blink 1s infinite' }}>▌</span>}
      </div>

      {/* Content */}
      <div style={{ color: 'var(--lattice-text, #333)', lineHeight: 1.4, wordBreak: 'break-word' }}>
        {displayText || (isStreaming ? '思考中...' : '(空)')}
        {displayText.length >= 80 && '...'}
      </div>

      {/* Footer */}
      {(toolCount > 0 || fileCount > 0) && (
        <div style={{ marginTop: 4, color: '#8C8C8C', fontSize: 11 }}>
          {toolCount > 0 && <span>🔧 {toolCount} </span>}
          {fileCount > 0 && <span>📝 {fileCount} files</span>}
        </div>
      )}
    </div>
  );
}

export const ConversationNodeCard = memo(ConversationNodeCardInner);
