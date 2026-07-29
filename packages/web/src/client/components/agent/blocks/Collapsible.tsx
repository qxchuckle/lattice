/**
 * 通用折叠容器 — 块渲染的统一外壳
 * extra：右侧附加信息（耗时标注等），状态图标之前
 */
import { useState } from 'react';

export function Collapsible({
  label,
  icon,
  status,
  extra,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  children,
}: {
  label: string;
  icon: string;
  status?: 'running' | 'done' | 'error';
  /** 右侧附加信息（如耗时「1.2s」），渲染在状态图标左侧 */
  extra?: React.ReactNode;
  defaultOpen?: boolean;
  /** 受控展开态（不传 = 非受控，内部 state 管理） */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = controlledOpen ?? innerOpen;
  const toggle = (): void => {
    const next = !open;
    if (controlledOpen === undefined) setInnerOpen(next);
    onToggle?.(next);
  };
  return (
    <div
      style={{
        margin: '4px 0',
        borderRadius: 6,
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
      <div
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: 11,
          background: 'var(--bg-tertiary)',
          userSelect: 'none',
        }}>
        <span
          style={{
            fontSize: 10,
            opacity: 0.6,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}>
          ▶
        </span>
        <span>{icon}</span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--text)',
          }}>
          {label}
        </span>
        {extra}
        {status === 'running' && (
          <span style={{ color: 'var(--brand-color)', fontSize: 10 }}>●</span>
        )}
        {status === 'done' && <span style={{ color: '#52c41a', fontSize: 10 }}>✓</span>}
        {status === 'error' && <span style={{ color: '#ff4d4f', fontSize: 10 }}>✗</span>}
      </div>
      {open && (
        <div style={{ padding: '6px 8px', fontSize: 11, borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}
