import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { GitSyncTab } from '../src/components/admin/GitSyncTab';
import { installDomStubs, renderUi } from './helpers/component';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const remotes = [
  {
    name: 'origin',
    url: 'https://github.com/me/lattice.git',
    fetchUrl: 'https://github.com/me/lattice.git',
    pushUrl: 'https://github.com/me/lattice.git',
  },
  {
    name: 'backup',
    url: 'https://github.com/me/backup.git',
    fetchUrl: 'https://github.com/me/backup.git',
    pushUrl: 'https://github.com/me/backup.git',
  },
];

type Handler = (url: string) => Response | Promise<Response>;

function installFetch(
  statusOverrides: Record<string, unknown> = {},
  handlers: Record<string, Handler> = {},
) {
  const gitStatus = {
    initialized: true,
    remote: 'https://github.com/me/lattice.git',
    branch: 'main',
    hasChanges: false,
    changedFiles: [],
    aheadCount: 0,
    behindCount: 0,
    ...statusOverrides,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [suffix, handler] of Object.entries(handlers)) {
      if (url.endsWith(suffix)) return handler(url);
    }
    if (url.endsWith('/api/git/status')) return jsonResponse(gitStatus);
    if (url.endsWith('/api/git/remotes')) return jsonResponse(remotes);
    if (url.endsWith('/api/git/domains')) return jsonResponse([]);
    if (url.endsWith('/api/git/sync-logs')) return jsonResponse({ entries: [] });
    return jsonResponse({ success: true, message: 'ok' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function clickModalPrimary(): void {
  const modals = Array.from(
    document.querySelectorAll<HTMLElement>('.ant-modal-footer, .ant-modal-confirm-btns'),
  );
  const buttons = Array.from(
    modals[modals.length - 1]?.querySelectorAll<HTMLButtonElement>('button') ?? [],
  );
  const button = buttons.find((b) => b.classList.contains('ant-btn-primary')) ?? buttons.at(-1);
  if (!button) throw new Error('modal primary not found');
  fireEvent.click(button);
}

function closeModal(): void {
  const close = document.querySelector<HTMLButtonElement>('.ant-modal-close');
  if (!close) throw new Error('modal close not found');
  fireEvent.click(close);
}

beforeEach(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GitSyncTab 失败路径', () => {
  it('启用失败：提示错误并恢复按钮', async () => {
    installFetch(
      { initialized: false, remote: null },
      {
        '/api/git/enable': () => {
          throw new Error('remote unreachable');
        },
      },
    );
    renderUi(<GitSyncTab />);
    await waitFor(() => expect(screen.getByText(/未启用 Git 管理/)).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('可选：远程仓库 URL（git remote）'), {
      target: { value: 'git@github.com:me/lattice.git' },
    });
    const enableButton = screen.getByRole('button', { name: '启用 Git 管理' });
    fireEvent.click(enableButton);
    await waitFor(() => expect(screen.getByText('启用失败：remote unreachable')).toBeTruthy());
    await waitFor(() => expect(enableButton.className).not.toContain('ant-btn-loading'));
  });

  it('提交/同步失败：写操作日志、错误提示与 loading 复位', async () => {
    let commitCalls = 0;
    installFetch(
      {},
      {
        '/api/git/commit': () => {
          commitCalls += 1;
          if (commitCalls === 1) throw new Error('disk full');
          return jsonResponse({ success: false, message: 'no changes' });
        },
        '/api/git/sync': () => {
          throw new Error('network down');
        },
      },
    );
    renderUi(<GitSyncTab />);
    await waitFor(() => expect(screen.getByText('主数据 · origin 单仓')).toBeTruthy());

    const commitButton = screen.getByRole('button', { name: /提交/ });
    fireEvent.click(commitButton);
    await waitFor(() => expect(screen.getByText('操作失败: disk full')).toBeTruthy());
    await waitFor(() => expect(commitButton.className).not.toContain('ant-btn-loading'));

    // HTTP 200 + success:false：显示服务端消息，不误判为成功
    fireEvent.click(commitButton);
    await waitFor(() => expect(screen.getAllByText('no changes').length).toBeGreaterThan(0));
    await waitFor(() => expect(commitButton.className).not.toContain('ant-btn-loading'));

    const syncButton = screen.getByRole('button', { name: /全部同步/ });
    fireEvent.click(syncButton);
    await waitFor(() => expect(screen.getByText('操作失败: network down')).toBeTruthy());
    await waitFor(() => expect(syncButton.className).not.toContain('ant-btn-loading'));
  });

  it('Remote 添加/改址/删除失败：错误提示且保留弹窗', async () => {
    installFetch(
      {},
      {
        '/api/git/remotes/add': () => jsonResponse({ success: false, message: 'remote exists' }),
        '/api/git/remotes/set-url': () => jsonResponse({ success: false, message: 'bad url' }),
        '/api/git/remotes/remove': () =>
          jsonResponse({ success: false, message: 'permission denied' }),
      },
    );
    renderUi(<GitSyncTab />);
    await waitFor(() => expect(screen.getByText('backup')).toBeTruthy());

    // 添加失败（success:false）：只提示，不关闭表单
    const addButton = document
      .querySelector<HTMLButtonElement>('button .anticon-plus')
      ?.closest('button');
    fireEvent.click(addButton!);
    await waitFor(() => expect(screen.getByText('添加 Remote')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'newremote' } });
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://github.com/me/new.git' },
    });
    clickModalPrimary();
    await waitFor(() => expect(screen.getByText('remote exists')).toBeTruthy());
    expect(screen.getByText('添加 Remote')).toBeTruthy();
    closeModal();
    await waitFor(() => expect(screen.queryByText('添加 Remote')).toBeNull());

    // 修改 URL 失败：保留编辑弹窗
    const getBackupButtons = () =>
      screen.getByText('backup').closest('.ant-list-item')?.querySelectorAll('button') ?? [];
    fireEvent.click(getBackupButtons()[0]);
    await waitFor(() => expect(screen.getByText('切换 URL - backup')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('新 URL'), {
      target: { value: 'https://github.com/me/backup2.git' },
    });
    clickModalPrimary();
    await waitFor(() => expect(screen.getByText('bad url')).toBeTruthy());
    expect(screen.getByText('切换 URL - backup')).toBeTruthy();
    closeModal();
    await waitFor(() => expect(screen.queryByText('切换 URL - backup')).toBeNull());

    // 删除失败（success:false）：提示服务端消息，不误报成功
    fireEvent.click(getBackupButtons()[1]);
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe('删除 Remote'),
    );
    clickModalPrimary();
    await waitFor(() => expect(screen.getByText('permission denied')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeNull());
    expect(screen.getByText('backup')).toBeTruthy();
  });
});
