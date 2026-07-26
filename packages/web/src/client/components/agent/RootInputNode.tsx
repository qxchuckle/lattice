/**
 * RootInputNode — 初始输入节点（始终存在，特殊样式）
 * 只有一个输入框 + 源/模型选择 + 发送按钮
 */
import { useState, useCallback, memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useSnapshot } from 'valtio';
import { agentStore, submitFromNode, setSource, setModel } from './agentStore';

function RootInputInner() {
  const snap = useSnapshot(agentStore);
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    submitFromNode(null, text);
    setInput('');
  }, [input]);

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

  const sourceOpts = snap.sources.map((s) => ({ id: s.id, label: s.displayName }));
  const modelOpts = snap.models.map((m) => ({ id: m.id, label: m.displayName }));

  return (
    <div className='nowheel' style={{ width: '100%', height: '100%' }}>
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 12,
          border: `1.5px solid ${focused ? 'var(--brand-color)' : 'var(--border)'}`,
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '8px 12px',
          boxShadow: focused ? '0 0 8px rgba(22,119,255,0.2)' : 'var(--shadow)',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}>
        <Handle
          type='source'
          position={Position.Bottom}
          style={{ background: 'var(--brand-color)', width: 6, height: 6 }}
        />

        {/* 输入框 */}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder='输入消息开始对话...'
          rows={1}
          className='nowheel'
          style={{
            width: '100%',
            resize: 'none',
            padding: '6px 8px',
            marginBottom: 6,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 12,
            lineHeight: 1.4,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        {/* 底栏：源 + 模型 + 发送 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={snap.activeSourceId}
            onChange={(e) => {
              e.stopPropagation();
              setSource(e.target.value);
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className='nowheel'
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}>
            {sourceOpts.map((o) => (
              <option key={o.id} value={o.id}>
                ∞ {o.label}
              </option>
            ))}
            {sourceOpts.length === 0 && <option value='qoder'>∞ Qoder</option>}
          </select>

          <select
            value={snap.activeModelId}
            onChange={(e) => {
              e.stopPropagation();
              setModel(e.target.value);
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className='nowheel'
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}>
            {modelOpts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            {modelOpts.length === 0 && <option value=''>默认模型</option>}
          </select>

          <div style={{ flex: 1 }} />

          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: input.trim() ? 'var(--brand-color)' : 'var(--bg-tertiary)',
              color: input.trim() ? '#fff' : 'var(--text-secondary)',
              cursor: input.trim() ? 'pointer' : 'default',
            }}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

export const RootInputNode = memo(RootInputInner);
