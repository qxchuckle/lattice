/**
 * AgentPanel — 嵌入主页的 Agent 对话树画布
 * 收起时不渲染（图标在 Activity Bar），展开时全屏覆盖画布
 */
import { useSnapshot } from 'valtio';
import { AgentCanvas } from './AgentCanvas';
import { agentStore, formatTokens } from './agentStore';

export function AgentPanel() {
  const snap = useSnapshot(agentStore);

  // 收起状态：不渲染（图标在左侧 Activity Bar）
  if (!snap.visible) {
    return null;
  }

  // 展开状态：全屏画布覆盖
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
        <span
          style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 8,
            background: snap.wsConnected ? '#f6ffed' : '#fff2f0',
            color: snap.wsConnected ? '#52c41a' : '#ff4d4f',
            border: `1px solid ${snap.wsConnected ? '#b7eb8f' : '#ffccc7'}`,
          }}>
          {snap.wsConnected ? '● 在线' : '○ 离线'}
        </span>

        {/* 会话累计统计 */}
        <span
          style={{ fontSize: 10, color: 'var(--text-secondary)' }}
          title='会话累计：输入/输出 token'>
          ↑ {formatTokens(snap.totalInputTokens)} · ↓ {formatTokens(snap.totalOutputTokens)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{snap.nodes.size} 节点</span>

        <button
          onClick={() => {
            agentStore.visible = false;
          }}
          style={{
            marginLeft: 'auto',
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

      {/* 画布 */}
      <div style={{ flex: 1 }}>
        <AgentCanvas />
      </div>
    </div>
  );
}
