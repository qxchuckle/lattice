/**
 * PermissionDialog — permission.respond 客户端正向应答 UI
 *
 * 批次四新增：
 * - 订阅 agentStore.pendingPermissions，有挂起请求时弹出对话框
 * - 展示工具名 + 参数摘要
 * - 允许/拒绝按钮 → sendWs({type:'permission.respond',requestId,allowed}) + 移除条目
 * - 多个 pending 时逐个处理（队列：取第一个）
 */
import { memo, useCallback, useEffect, useRef } from 'react';
import { Typography } from 'antd';
import { useSnapshot } from 'valtio';
import { agentStore } from './store';
import { sendWs } from './connection';
import type { PendingPermission } from './store';

const { Text, Paragraph } = Typography;

/** 将参数摘要为可读字符串（截断长值，避免 DOM 溢出） */
function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '（无参数）';
  return entries
    .map(([key, val]) => {
      const valStr = typeof val === 'string' ? val : JSON.stringify(val);
      const truncated = valStr.length > 200 ? valStr.slice(0, 200) + '…' : valStr;
      return `${key}: ${truncated}`;
    })
    .join('\n');
}

export const PermissionDialog = memo(function PermissionDialog() {
  const { pendingPermissions } = useSnapshot(agentStore);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 取第一个 pending 权限（队列模式，逐个处理）
  const entries = Array.from(pendingPermissions.entries());
  const current: PendingPermission | null = entries.length > 0 ? entries[0][1] : null;

  const handleRespond = useCallback(
    (allowed: boolean) => {
      if (!current) return;
      sendWs({
        type: 'permission.respond',
        requestId: current.requestId,
        allowed,
      });
      agentStore.pendingPermissions.delete(current.requestId);
    },
    [current],
  );

  const handleAllow = useCallback(() => handleRespond(true), [handleRespond]);
  const handleDeny = useCallback(() => handleRespond(false), [handleRespond]);

  // 对话框打开时聚焦到对话框容器
  useEffect(() => {
    if (current && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [current?.requestId]);

  // ESC 关闭对话框（拒绝）+ 焦点陷阱（Tab 循环）
  useEffect(() => {
    if (!current) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        handleDeny();
        return;
      }
      // 焦点陷阱：Tab 时在对话框内部循环
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [current, handleDeny]);

  if (!current) return null;

  return (
    <div
      ref={dialogRef}
      role='dialog'
      aria-modal='true'
      aria-label='工具权限确认'
      tabIndex={-1}
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        width: 520,
        maxWidth: '90vw',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,0.2)',
        padding: 20,
      }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>工具权限确认</div>

      {/* 工具信息 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, minWidth: 60 }}>工具</span>
          <Text strong>{current.tool}</Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, minWidth: 60 }}>
            权限级别
          </span>
          <Text>{current.level}</Text>
        </div>
      </div>

      {/* 参数摘要 */}
      <Paragraph
        style={{
          padding: 8,
          background: 'var(--bg-tertiary)',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 200,
          overflow: 'auto',
          margin: 0,
        }}>
        {summarizeArgs(current.args)}
      </Paragraph>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button
          onClick={handleDeny}
          style={{
            padding: '4px 16px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'transparent',
            color: '#ff4d4f',
            cursor: 'pointer',
            fontSize: 13,
          }}>
          拒绝
        </button>
        <button
          onClick={handleAllow}
          style={{
            padding: '4px 16px',
            border: 'none',
            borderRadius: 4,
            background: 'var(--brand-color)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
          }}>
          允许
        </button>
      </div>

      {/* 蒙层（点击不关闭——必须显式选择） */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          background: 'rgba(0,0,0,0.3)',
        }}
      />
    </div>
  );
});
