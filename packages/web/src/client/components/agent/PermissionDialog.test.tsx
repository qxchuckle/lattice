/**
 * PermissionDialog 行为测试
 *
 * 验证 permission.respond 客户端正向应答 UI：
 *   1. 无 pending 权限时不渲染
 *   2. 有 pending 权限时渲染工具名 + 参数摘要
 *   3. 点击"允许"→ sendWs permission.respond(allowed:true) + 移除条目
 *   4. 点击"拒绝"→ sendWs permission.respond(allowed:false) + 移除条目
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PermissionDialog } from './PermissionDialog';
import { agentStore } from './store';
import { sendWs } from './connection';
import type { PendingPermission } from './store';

// mock connection 的 sendWs
vi.mock('./connection', () => ({
  sendWs: vi.fn(),
}));

describe('PermissionDialog', () => {
  beforeEach(() => {
    agentStore.pendingPermissions.clear();
    vi.clearAllMocks();
    cleanup();
  });

  it('无 pending 权限时不渲染', () => {
    render(<PermissionDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('有 pending 权限时渲染工具名 + 参数摘要', () => {
    const perm: PendingPermission = {
      requestId: 'req-1',
      tool: 'shell_exec',
      args: { command: 'rm -rf /tmp/test' },
      level: 'ask',
    };
    agentStore.pendingPermissions.set('req-1', perm);

    render(<PermissionDialog />);
    // 工具名显示
    expect(screen.getByText('shell_exec')).toBeTruthy();
    // 参数命令显示
    expect(screen.getByText(/rm -rf/i)).toBeTruthy();
  });

  it('点击"允许"→ sendWs permission.respond(allowed:true) + 移除条目', () => {
    const perm: PendingPermission = {
      requestId: 'req-allow',
      tool: 'file_write',
      args: { path: '/tmp/a.txt' },
      level: 'ask',
    };
    agentStore.pendingPermissions.set('req-allow', perm);

    render(<PermissionDialog />);
    const allowBtn = screen.getByText('允许');
    fireEvent.click(allowBtn);

    expect(sendWs).toHaveBeenCalledWith({
      type: 'permission.respond',
      requestId: 'req-allow',
      allowed: true,
    });
    expect(agentStore.pendingPermissions.has('req-allow')).toBe(false);
  });

  it('点击“拒绝”→ sendWs permission.respond(allowed:false) + 移除条目', () => {
    const perm: PendingPermission = {
      requestId: 'req-deny',
      tool: 'file_delete',
      args: { path: '/tmp/b.txt' },
      level: 'ask',
    };
    agentStore.pendingPermissions.set('req-deny', perm);

    render(<PermissionDialog />);
    const denyBtn = screen.getByText('拒绝');
    fireEvent.click(denyBtn);

    expect(sendWs).toHaveBeenCalledWith({
      type: 'permission.respond',
      requestId: 'req-deny',
      allowed: false,
    });
    expect(agentStore.pendingPermissions.has('req-deny')).toBe(false);
  });

  it('ESC 关闭对话框（拒绝）+ stopPropagation', () => {
    const perm: PendingPermission = {
      requestId: 'req-esc',
      tool: 'shell_exec',
      args: { command: 'echo test' },
      level: 'ask',
    };
    agentStore.pendingPermissions.set('req-esc', perm);

    render(<PermissionDialog />);
    expect(screen.getByRole('dialog')).toBeTruthy();

    // 触发 ESC（捕获阶段）
    const escEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const propagationSpy = vi.spyOn(escEvent, 'stopPropagation');
    window.dispatchEvent(escEvent);

    expect(propagationSpy).toHaveBeenCalled();
    // ESC 应触发拒绝操作
    expect(sendWs).toHaveBeenCalledWith({
      type: 'permission.respond',
      requestId: 'req-esc',
      allowed: false,
    });
    expect(agentStore.pendingPermissions.has('req-esc')).toBe(false);
  });

  it('对话框具有 aria-modal 属性', () => {
    const perm: PendingPermission = {
      requestId: 'req-modal',
      tool: 'test',
      args: {},
      level: 'ask',
    };
    agentStore.pendingPermissions.set('req-modal', perm);

    render(<PermissionDialog />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
