import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { OverviewTab } from '../src/components/admin/OverviewTab';
import { RagModelTab } from '../src/components/admin/RagModelTab';
import { DoctorTab } from '../src/components/admin/DoctorTab';
import { TrashTab } from '../src/components/admin/TrashTab';
import { ScanTab } from '../src/components/admin/ScanTab';
import { UserTab } from '../src/components/admin/UserTab';
import { WebPasswordSection } from '../src/components/admin/WebPasswordSection';
import { SyncLogSection } from '../src/components/admin/SyncLogSection';
import { setAdapter } from '../src/adapters';
import { authStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

const ragStatus = {
  modelId: 'Xenova/bge-small-zh-v1.5',
  vectorDimension: 512,
  dtype: 'q8',
  pooling: 'mean',
  indexedDocuments: 12,
  totalEmbeddings: 34,
  ftsIndexVersion: 3,
  expectedFtsVersion: 3,
  distanceThreshold: 0.5,
  lastUpdated: '2026-10-20T00:00:00.000Z',
};

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    getGlobalStatus: vi.fn(async () => ({
      home: '/home/u',
      pathSep: '/',
      latticeRoot: '/home/u/.lattice',
      username: 'tester',
      projectCount: 2,
      taskCount: 3,
      activeTaskCount: 1,
      dbSizeKB: 42,
      gitEnabled: true,
      scanDirs: ['/scan/a', '/scan/b'],
    })),
    getStats: vi.fn(async () => ({
      projectCount: 2,
      taskCount: 3,
      activeTaskCount: 1,
      relationCount: 4,
    })),
    getRagStatus: vi.fn(async () => ragStatus),
    getModelStatus: vi.fn(async () => ({
      installed: true,
      loaded: false,
      loadError: 'load failed',
      isNetworkError: true,
      networkHint: 'check network',
    })),
    removeModel: vi.fn(async () => true),
    runDoctor: vi.fn(async () => ({
      total: 2,
      healthy: 1,
      stale: 1,
      error: 0,
      repaired: 1,
      entries: [
        { item: '数据库', status: 'healthy', message: '正常' },
        {
          item: '索引',
          status: 'stale',
          message: '需要更新',
          fix: '执行 rebuild',
        },
      ],
    })),
    getTrash: vi.fn(async () => [
      {
        id: 'tr1',
        type: 'task',
        title: '回收任务',
        trashedAt: '2026-10-20T00:00:00.000Z',
        originalPath: '/x',
        username: 'tester',
        entityId: 't1',
      },
      {
        id: 'tr2',
        type: 'spec',
        title: '回收规范',
        trashedAt: '2026-10-20T00:00:00.000Z',
        originalPath: '/y',
        username: 'tester',
        entityId: 's1',
      },
    ]),
    restoreTrash: vi.fn(async () => true),
    purgeTrash: vi.fn(async () => true),
    emptyTrash: vi.fn(async () => ({ count: 2 })),
    getUsers: vi.fn(async () => ({ users: ['tester', 'alice'], currentUser: 'tester' })),
    getConfig: vi.fn(async (scope: string) => ({
      scanDirs: ['/scan/a'],
      gitEnabled: true,
      ...(scope === 'global'
        ? { 'rag.embedding.modelId': 'Xenova/bge-small-zh-v1.5', 'rag.embedding.dimension': 512 }
        : {}),
    })),
    setConfig: vi.fn(async () => true),
    getAuthStatus: vi.fn(async () => ({ enabled: true })),
    changePassword: vi.fn(async () => true),
    ...overrides,
  };
}

function sseResponse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [key, handler] of Object.entries(overrides)) {
      if (url.includes(key)) return handler(init);
    }
    return jsonResponse({ success: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function clickConfirm(): void {
  const roots = Array.from(
    document.querySelectorAll<HTMLElement>('.ant-modal-confirm-btns, .ant-modal-footer'),
  );
  const root = roots[roots.length - 1];
  const buttons = Array.from(root?.querySelectorAll<HTMLButtonElement>('button') ?? []);
  const button =
    buttons.find((b) => b.classList.contains('ant-btn-primary')) ?? buttons[buttons.length - 1];
  if (!button) throw new Error('confirm button not found');
  fireEvent.click(button);
}

beforeEach(() => {
  installDomStubs();
  authStore.authEnabled = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin 概览/配置', () => {
  it('概览加载全局状态/统计并打开配置弹窗、切换本机配置', async () => {
    installFetch({
      '/api/global-status': () =>
        jsonResponse({
          latticeRoot: '/home/u/.lattice',
          username: 'tester',
          projectCount: 2,
          taskCount: 3,
          activeTaskCount: 1,
          dbSizeKB: 42,
          gitEnabled: true,
          scanDirs: ['/scan/a', '/scan/b'],
        }),
    });
    setAdapter(makeAdapter() as never);
    renderUi(<OverviewTab />);
    await waitFor(() => expect(screen.getByText('Lattice 全局状态')).toBeTruthy());
    expect(screen.getByText(/\.lattice/)).toBeTruthy();
    expect(screen.getByText('42 KB')).toBeTruthy();
    expect(screen.getByText('已启用')).toBeTruthy();
    expect(screen.getByText('/scan/a, /scan/b')).toBeTruthy();

    fireEvent.click(screen.getByText('编辑配置'));
    await waitFor(() => expect(screen.getByText('配置编辑')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('RAG - 模型配置')).toBeTruthy());
    fireEvent.click(screen.getByText('本机配置'));
    await waitFor(() => expect(screen.getByText('Web 面板密码')).toBeTruthy());
    expect(screen.getByText('● 已启用密码鉴权')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    // Modal 关闭后仍保留在 DOM（动画），不强制断言移除
  });
});

describe('admin RAG / Doctor', () => {
  it('RAG 状态渲染、增量更新/重建 SSE、模型下载与删除确认', async () => {
    const adapter = makeAdapter();
    setAdapter(adapter as never);
    installFetch({
      '/api/rag/update': () =>
        sseResponse([
          { current: 1, total: 2, chunksProcessed: 3, currentFile: '/a/b.md' },
          { done: true },
        ]),
      '/api/rag/rebuild': () => sseResponse([{ current: 1, total: 1 }, { done: true }]),
      '/api/rag/model/download': () => sseResponse([{ done: true }]),
    });
    renderUi(<RagModelTab />);
    await waitFor(() => expect(screen.getByText('RAG 索引')).toBeTruthy());
    expect(screen.getByText('Xenova/bge-small-zh-v1.5')).toBeTruthy();
    expect(screen.getByText('load failed')).toBeTruthy();
    expect(screen.getByText('check network')).toBeTruthy();

    fireEvent.click(screen.getByText('增量更新'));
    await waitFor(() => expect(screen.getByText('模型管理')).toBeTruthy());
    fireEvent.click(screen.getByText('全量重建'));
    fireEvent.click(screen.getByText('重装'));
    await waitFor(() => expect(adapter.removeModel).not.toHaveBeenCalled());
    fireEvent.click(screen.getByText('删除'));
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeTruthy());
    clickConfirm();
    await waitFor(() => expect(adapter.removeModel).toHaveBeenCalled());
  });

  it('Doctor 运行诊断/开关/报告/清除', async () => {
    const adapter = makeAdapter();
    setAdapter(adapter as never);
    installFetch();
    const { container } = renderUi(<DoctorTab />);
    expect(screen.getAllByText(/点击「运行诊断」/).length).toBeGreaterThan(0);

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);
    fireEvent.click(switches[1]);
    fireEvent.click(switches[2]);
    fireEvent.click(switches[3]);
    fireEvent.click(screen.getByText('诊断并修复'));
    await waitFor(() =>
      expect(adapter.runDoctor).toHaveBeenCalledWith({
        fix: true,
        migrate: true,
        rebuildFingerprints: true,
        recheckScopePaths: true,
      }),
    );
    await waitFor(() => expect(screen.getByText('数据库')).toBeTruthy());
    expect(screen.getByText(/索引/)).toBeTruthy();
    expect(screen.getByText(/执行 rebuild/)).toBeTruthy();
    fireEvent.click(screen.getByText('清除'));
    expect(container.textContent).toContain('运行诊断');
  });
});

describe('admin 垃圾桶/用户/密码', () => {
  it('垃圾桶：恢复/筛选/彻底删除/清空确认', async () => {
    const adapter = makeAdapter();
    setAdapter(adapter as never);
    installFetch();
    renderUi(<TrashTab />);
    await waitFor(() => expect(screen.getByText('回收任务')).toBeTruthy());
    expect(screen.getByText('回收规范')).toBeTruthy();

    fireEvent.click(screen.getAllByText('恢复')[0]);
    await waitFor(() => expect(adapter.restoreTrash).toHaveBeenCalledWith('tr1'));

    fireEvent.click(screen.getByText('清空'));
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeTruthy());
    clickConfirm();
    await waitFor(() => expect(adapter.emptyTrash).toHaveBeenCalled());

    fireEvent.click(screen.getByText('任务'));
    await waitFor(() => expect(adapter.getTrash).toHaveBeenCalledWith('task'));
    await waitFor(() => expect(screen.getByText('回收规范')).toBeTruthy());

    const purgeRow = screen.getByText('回收规范').closest('.ant-list-item');
    const purgeButtons = purgeRow?.querySelectorAll('button') ?? [];
    fireEvent.click(purgeButtons[purgeButtons.length - 1]);
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeTruthy());
    clickConfirm();
    await waitFor(() => expect(adapter.purgeTrash).toHaveBeenCalled());
  });

  it('用户：创建/切换/重命名/删除', async () => {
    const adapter = makeAdapter();
    setAdapter(adapter as never);
    const fetchMock = installFetch();
    renderUi(<UserTab />);
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    fireEvent.click(screen.getByText('创建'));
    fireEvent.change(screen.getByPlaceholderText('新用户名'), { target: { value: ' bob ' } });
    fireEvent.click(screen.getByText('创建'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/users/create', expect.anything()),
    );

    fireEvent.click(screen.getByRole('button', { name: /切换/ }));
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeTruthy());
    clickConfirm();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/users/switch', expect.anything()),
    );

    const testerRow = screen.getByText('tester').closest('.ant-list-item');
    const editButtons = testerRow?.querySelectorAll('button') ?? [];
    fireEvent.click(editButtons[0]);
    await waitFor(() => expect(screen.getByText(/重命名用户/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('新用户名'), { target: { value: 'tester2' } });
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-primary')!,
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/users/rename', expect.anything()),
    );

    const aliceRow = screen.getByText('alice').closest('.ant-list-item');
    const removeButtons = aliceRow?.querySelectorAll('button') ?? [];
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    await waitFor(() => expect(screen.getAllByText('删除用户').length).toBeGreaterThan(0));
    clickConfirm();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/users/remove', expect.anything()),
    );
  });

  it('Web 密码：设置/校验失败/清除', async () => {
    const adapter = makeAdapter();
    setAdapter(adapter as never);
    installFetch();
    authStore.authEnabled = true;
    renderUi(<WebPasswordSection />);
    await waitFor(() => expect(screen.getByText('● 已启用密码鉴权')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('新密码（至少 4 位）'), {
      target: { value: '1234' },
    });
    fireEvent.change(screen.getByPlaceholderText('确认新密码'), { target: { value: '9999' } });
    fireEvent.click(screen.getByText('修改密码'));
    await waitFor(() => expect(screen.getByText('两次密码不一致')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('确认新密码'), { target: { value: '1234' } });
    fireEvent.click(screen.getByText('修改密码'));
    await waitFor(() => expect(adapter.changePassword).toHaveBeenCalledWith('1234'));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /清除密码/ }).className).not.toContain(
        'ant-btn-loading',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /清除密码/ }));
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeTruthy());
    clickConfirm();
    await waitFor(() => expect(adapter.changePassword).toHaveBeenCalledWith(null));
  });
});

describe('admin 扫描/同步日志', () => {
  it('扫描：配置预填、SSE 进度与结果', async () => {
    const adapter = makeAdapter();
    setAdapter(adapter as never);
    installFetch({
      '/api/scan': () =>
        sseResponse([
          { current: 1, total: 2, added: 1, updated: 0, currentFile: '/very/long/path/a' },
          { done: true, result: { added: ['a'], updated: ['b'] } },
        ]),
    });
    renderUi(<ScanTab />);
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/扫描目录/) as HTMLTextAreaElement).value).toBe(
        '/scan/a',
      ),
    );
    fireEvent.click(screen.getByText('开始扫描'));
    await waitFor(() => expect(screen.getByText(/新增 1/)).toBeTruthy());
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('同步日志：空态/条目/详情展开/刷新/分页', async () => {
    installFetch({
      '/api/git/sync-logs': () =>
        jsonResponse({
          entries: [
            {
              at: '2026-10-20T00:00:00.000Z',
              target: 'origin',
              action: 'push',
              status: 'ok',
              message: 'pushed',
              detail: { copied: 2, remote: 'origin', changedFiles: ['a.md'] },
            },
            {
              at: '2026-10-20T00:01:00.000Z',
              target: 'hash12345',
              action: 'pull',
              status: 'error',
              message: 'failed',
            },
          ],
          total: 2,
        }),
    });
    renderUi(<SyncLogSection domainOptions={[{ value: 'hash12345', label: '域一' }]} />);
    await waitFor(() => expect(screen.getByText(/pushed/)).toBeTruthy());
    expect(screen.getByText(/failed/)).toBeTruthy();
    fireEvent.click(screen.getByText(/pushed/));
    await waitFor(() => expect(screen.getByText(/上行 2 个文件/)).toBeTruthy());
    expect(screen.getAllByText(/origin/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('刷新'));
    await waitFor(() => expect(screen.getByText(/pushed/)).toBeTruthy());
  });
});
