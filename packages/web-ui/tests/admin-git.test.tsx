import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { GitSyncTab } from '../src/components/admin/GitSyncTab';
import { installDomStubs, renderUi } from './helpers/component';

const domains = [
  {
    hash: 'hash1111aaaa',
    remote: 'https://github.com/team/pack-a.git',
    branch: 'main',
    label: '团队域A',
    use: 'trusted',
    routes: ['project:*', 'user-spec:*.md'],
    pushState: '可推送',
    mirrorExists: true,
    lastPushAt: '2026-10-20T00:00:00.000Z',
    priority: 1,
    lastSync: { status: 'ok', message: '已同步', at: '2026-10-20T00:00:00.000Z' },
    stats: { users: 2, projects: 3, specs: 4, tasks: 5 },
  },
  {
    hash: 'hash2222bbbb',
    remote: 'https://github.com/team/pack-b.git',
    branch: 'main',
    label: '团队域B',
    use: 'reference',
    routes: [],
    pushState: '只读',
    mirrorExists: false,
    lastPushAt: null,
    priority: 2,
    lastSync: { status: 'error', message: '拉取失败', at: '2026-10-20T00:00:00.000Z' },
    stats: null,
  },
];

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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(statusOverrides: Record<string, unknown> = {}) {
  const gitStatus = {
    initialized: true,
    remote: 'https://github.com/me/lattice.git',
    branch: 'main',
    hasChanges: true,
    changedFiles: Array.from({ length: 22 }, (_, i) => `file-${i}.md`),
    aheadCount: 2,
    behindCount: 1,
    ...statusOverrides,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/git/status')) return jsonResponse(gitStatus);
    if (url.includes('/api/git/remotes')) return jsonResponse(remotes);
    if (url.includes('/api/git/domains/preview')) {
      return jsonResponse({
        copied: 2,
        removed: 1,
        copiedFiles: ['a.md', 'b.md'],
        removedFiles: ['c.md'],
      });
    }
    if (url.includes('/api/git/domains/join')) {
      return jsonResponse({
        domainHash: 'hash3333cccc',
        summary: {
          users: 2,
          projects: 1,
          specs: 3,
          globalSpecTitles: [],
          sameNameUserPresent: false,
        },
        warnings: ['该域含全局 spec'],
      });
    }
    if (url.includes('/api/git/domains/update')) return jsonResponse({ migrated: false });
    if (url.includes('/api/git/domains/sync')) {
      return jsonResponse({
        outcomes: [
          {
            domainHash: 'hash1111aaaa',
            label: '团队域A',
            pulled: true,
            pullMessage: 'ok',
            push: { status: 'pushed', message: '1 file' },
          },
          {
            domainHash: 'hash2222bbbb',
            label: '团队域B',
            pulled: false,
            pullMessage: 'conflict',
          },
        ],
      });
    }
    if (url.includes('/api/git/domains')) return jsonResponse(domains);
    if (url.includes('/api/git/sync-logs')) return jsonResponse({ entries: [] });
    if (url.includes('/api/git/commit')) {
      return jsonResponse({ success: true, message: 'committed', output: 'detail' });
    }
    if (url.includes('/api/git/sync')) {
      return jsonResponse({
        commit: { success: true, message: 'committed' },
        pull: { success: false, message: 'pull failed' },
        push: { success: true, message: 'pushed' },
      });
    }
    if (url.includes('/api/git/remotes/add'))
      return jsonResponse({ success: true, message: 'added' });
    if (url.includes('/api/git/remotes/set-url')) {
      return jsonResponse({ success: true, message: 'updated' });
    }
    if (url.includes('/api/git/remotes/remove')) {
      return jsonResponse({ success: true, message: 'removed' });
    }
    if (url.includes('/api/git/enable')) return jsonResponse({ success: true, message: 'enabled' });
    return jsonResponse({ success: true, message: 'ok', output: 'out' });
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

beforeEach(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GitSyncTab', () => {
  it('未启用：输入远端后启用 Git；空域/空日志渲染', async () => {
    installFetch({
      initialized: false,
      remote: null,
      changedFiles: [],
      aheadCount: 0,
      behindCount: 0,
    });
    renderUi(<GitSyncTab />);
    await waitFor(() => expect(screen.getAllByText(/未启用 Git 管理/).length).toBeGreaterThan(0));
    const remoteInput = screen.getByPlaceholderText('可选：远程仓库 URL（git remote）');
    fireEvent.change(remoteInput, { target: { value: 'git@github.com:me/lattice.git' } });
    fireEvent.click(screen.getByText('启用 Git 管理'));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/git/enable',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('已启用：状态/变更文件/remotes 编辑删除、提交与同步日志', async () => {
    const fetchMock = installFetch();
    renderUi(<GitSyncTab />);
    await waitFor(() => expect(screen.getByText('主数据 · origin 单仓')).toBeTruthy());
    expect(screen.getByText('22 个文件')).toBeTruthy();
    expect(screen.getByText(/还有 2 个文件/)).toBeTruthy();
    expect(screen.getByText('2 个 commit 未推送')).toBeTruthy();
    expect(screen.getByText('1 个 commit 未拉取')).toBeTruthy();
    expect(screen.getByText('backup')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('提交信息（可选）'), {
      target: { value: 'my commit' },
    });
    fireEvent.click(screen.getByText('提交'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/commit', expect.anything()),
    );
    await waitFor(() => expect(screen.getByText(/committed/)).toBeTruthy());

    await waitFor(() =>
      expect(screen.getByText('Pull').closest('button')?.className).not.toContain(
        'ant-btn-loading',
      ),
    );
    fireEvent.click(screen.getByText('Pull'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/git/pull', expect.anything()));
    await waitFor(() =>
      expect(screen.getByText('Push').closest('button')?.className).not.toContain(
        'ant-btn-loading',
      ),
    );
    fireEvent.click(screen.getByText('Push'));
    await waitFor(() =>
      expect(screen.getByText('全部同步').closest('button')?.className).not.toContain(
        'ant-btn-loading',
      ),
    );
    fireEvent.click(screen.getByText('全部同步'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/git/sync', expect.anything()));
    await waitFor(() => expect(screen.getByText(/拉取: ⚠ pull failed/)).toBeTruthy());

    // 添加 remote
    const addButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.querySelector('.anticon-plus'),
    );
    expect(addButton).toBeTruthy();
    fireEvent.click(addButton!);
    await waitFor(() => expect(screen.getByText('添加 Remote')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'newremote' } });
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://github.com/me/new.git' },
    });
    clickModalPrimary();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/remotes/add', expect.anything()),
    );

    // 编辑 backup 的 URL
    const backupRow = screen.getByText('backup').closest('.ant-list-item');
    const backupButtons = backupRow?.querySelectorAll('button') ?? [];
    fireEvent.click(backupButtons[0]);
    await waitFor(() => expect(screen.getByText(/切换 URL - backup/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('新 URL'), {
      target: { value: 'https://github.com/me/backup2.git' },
    });
    clickModalPrimary();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/remotes/set-url', expect.anything()),
    );

    // 删除 backup
    fireEvent.click(backupButtons[1]);
    await waitFor(() => expect(screen.getAllByText('删除 Remote').length).toBeGreaterThan(0));
    clickModalPrimary();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/remotes/remove', expect.anything()),
    );
  });

  it('域：join/编辑预览/全域同步/拖拽排序/解除', async () => {
    const fetchMock = installFetch();
    renderUi(<GitSyncTab />);
    await waitFor(() => expect(screen.getByText('团队域A')).toBeTruthy());
    expect(screen.getAllByText(/上次同步/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2 用户 · 3 项目 · 4 spec · 5 任务')).toBeTruthy();
    expect(screen.getByText('镜像缺失')).toBeTruthy();

    fireEvent.click(screen.getByText('关联域'));
    await waitFor(() => expect(screen.getByText('关联域（经验包仓库）')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('仓库地址'), {
      target: { value: 'https://github.com/team/pack-c.git' },
    });
    fireEvent.change(screen.getByLabelText('备注名（纯本机显示）'), {
      target: { value: '新手域' },
    });
    fireEvent.change(screen.getByLabelText(/推送白名单/), {
      target: { value: 'project:*\nuser-spec:*.md' },
    });
    clickModalPrimary();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/domains/join', expect.anything()),
    );

    fireEvent.click(screen.getAllByLabelText('编辑域')[0]);
    await waitFor(() => expect(screen.getByText(/编辑域 · 团队域A/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('备注名（纯本机显示）'), {
      target: { value: '团队域A2' },
    });
    fireEvent.change(screen.getByLabelText(/推送白名单/), {
      target: { value: 'project:*' },
    });
    await waitFor(() => expect(screen.getByText(/预览/)).toBeTruthy());
    expect(screen.getByText(/将上行 2 个文件/)).toBeTruthy();
    clickModalPrimary();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/domains/update', expect.anything()),
    );

    fireEvent.click(screen.getByText('域同步'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/domains/sync', expect.anything()),
    );

    const cards = document.querySelectorAll('[draggable="true"]');
    expect(cards.length).toBe(2);
    fireEvent.dragStart(cards[0]);
    fireEvent.dragOver(cards[1]);
    fireEvent.drop(cards[1]);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/domains/reorder', expect.anything()),
    );

    fireEvent.click(screen.getAllByLabelText('解除关联')[0]);
    await waitFor(() => expect(screen.getByText('解除该域关联？')).toBeTruthy());
    const popButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-popconfirm .ant-btn-primary'),
    );
    fireEvent.click(popButtons[popButtons.length - 1]);
    await waitFor(() => expect(screen.getAllByText(/解除域/).length).toBeGreaterThan(0));
    clickModalPrimary();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/git/domains/unlink', expect.anything()),
    );
  });
});
