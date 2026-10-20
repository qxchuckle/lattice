import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router';
import { AppShell } from '../src/components/AppShell';
import { setAdapter } from '../src/adapters';
import { authStore, canvasStore, detailStore, sidebarStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

vi.mock('../src/components/CytoscapeGraph', () => ({
  CytoscapeGraph: () => <div data-testid='graph' />,
}));
vi.mock('../src/components/DetailPanel', () => ({
  DetailPanel: () => <div data-testid='detail' />,
}));
vi.mock('../src/components/sidebar/TreeBrowserSidebar', () => ({
  TreeBrowserSidebar: () => <div data-testid='sidebar' />,
}));
vi.mock('../src/components/FloatingStatusBar', () => ({
  FloatingStatusBar: () => <div data-testid='float' />,
}));
vi.mock('../src/components/GlobalSearchPanel', () => ({
  GlobalSearchPanel: () => <div data-testid='global-search' />,
}));
vi.mock('../src/components/admin/AdminDrawer', () => ({
  AdminDrawer: () => <div data-testid='admin' />,
}));
vi.mock('../src/components/terminal/TerminalPanel', () => ({
  TerminalPanel: () => <div data-testid='terminal' />,
}));
vi.mock('../src/components/LoginPage', () => ({
  LoginPage: () => <div data-testid='login' />,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname}</div>;
}

function Nav() {
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => navigate('/')}>root</button>
      <button onClick={() => navigate('/task')}>task-list</button>
      <button onClick={() => navigate('/task/t1')}>task</button>
      <button onClick={() => navigate('/project')}>project-list</button>
      <button onClick={() => navigate('/project/p%201')}>project</button>
      <button onClick={() => navigate('/spec')}>spec-list</button>
      <button onClick={() => navigate('/spec/s1')}>spec</button>
      <button onClick={() => navigate('/other')}>other</button>
      <button onClick={() => navigate('/login')}>login</button>
    </div>
  );
}

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    getAuthStatus: vi.fn(async () => ({ enabled: false })),
    ...overrides,
  };
}

beforeEach(() => {
  installDomStubs();
  authStore.initialized = false;
  authStore.authEnabled = false;
  authStore.token = null;
  canvasStore.viewMode = 'global';
  canvasStore.anchorId = null;
  detailStore.open = false;
  detailStore.collapsed = false;
  detailStore.width = 420;
  sidebarStore.mobileOpen = false;
  window.innerWidth = 1280;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  authStore.initialized = false;
  authStore.authEnabled = false;
  authStore.token = null;
  detailStore.open = false;
  detailStore.collapsed = false;
  sidebarStore.mobileOpen = false;
});

describe('AppShell', () => {
  it('无鉴权 Webview：路由同步、桌面组件、详情面板缩放/收起/关闭', async () => {
    authStore.initialized = true;
    detailStore.open = true;
    setAdapter(makeAdapter() as never);
    const { container } = renderUi(
      <>
        <AppShell features={{ login: false, admin: false, terminal: false }} />
        <Nav />
      </>,
    );

    expect(screen.queryByTestId('login')).toBeNull();
    expect(screen.queryByTestId('admin')).toBeNull();
    expect(screen.queryByTestId('terminal')).toBeNull();
    expect(screen.getByTestId('graph')).toBeTruthy();
    expect(screen.getByTestId('sidebar')).toBeTruthy();
    expect(screen.getByTestId('float')).toBeTruthy();

    fireEvent.click(screen.getByText('task'));
    await waitFor(() => expect(canvasStore.viewMode).toBe('task'));
    expect(canvasStore.anchorId).toBe('t1');
    fireEvent.click(screen.getByText('project'));
    await waitFor(() => expect(canvasStore.anchorId).toBe('p 1'));
    fireEvent.click(screen.getByText('task-list'));
    await waitFor(() => expect(canvasStore.anchorId).toBeNull());
    fireEvent.click(screen.getByText('spec'));
    await waitFor(() => expect(canvasStore.viewMode).toBe('spec'));
    fireEvent.click(screen.getByText('spec-list'));
    await waitFor(() => expect(canvasStore.viewMode).toBe('spec'));
    fireEvent.click(screen.getByText('other'));
    await waitFor(() => expect(canvasStore.anchorId).toBeNull());
    fireEvent.click(screen.getByText('root'));
    await waitFor(() => expect(canvasStore.viewMode).toBe('global'));

    const handle = container.querySelector('.detail-panel__resize-handle') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 300 });
    fireEvent.mouseUp(document);
    expect(detailStore.width).toBe(520);
    expect(document.body.style.cursor).toBe('');

    const actions = container.querySelectorAll<HTMLButtonElement>('.detail-panel__actions button');
    fireEvent.click(actions[0]);
    expect(detailStore.collapsed).toBe(true);
    fireEvent.click(actions[1]);
    expect(detailStore.open).toBe(false);
  });

  it('mobile：不渲染桌面侧栏，移动 Drawer 承载侧栏与详情', async () => {
    authStore.initialized = true;
    detailStore.open = true;
    sidebarStore.mobileOpen = true;
    window.innerWidth = 500;
    setAdapter(makeAdapter() as never);
    const { container } = renderUi(
      <AppShell features={{ login: false, admin: false, terminal: false }} />,
    );
    await waitFor(() => expect(screen.getAllByText('浏览器').length).toBeGreaterThan(0));
    expect(screen.getAllByText('详情').length).toBeGreaterThan(0);
    expect(container.querySelector('.app-root > [data-testid="sidebar"]')).toBeNull();
    expect(screen.queryByTestId('detail')).toBeTruthy();
  });

  it('启用鉴权且无 token 时跳转 /login；登录页独立渲染', async () => {
    setAdapter(makeAdapter({ getAuthStatus: vi.fn(async () => ({ enabled: true })) }) as never);
    renderUi(
      <>
        <AppShell features={{ login: true, admin: false, terminal: false }} />
        <LocationProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/login'));
    expect(screen.getByTestId('login')).toBeTruthy();
    expect(authStore.authEnabled).toBe(true);
    expect(authStore.initialized).toBe(true);
  });

  it('鉴权状态查询失败时也完成初始化', async () => {
    setAdapter(
      makeAdapter({
        getAuthStatus: vi.fn(async () => Promise.reject(new Error('offline'))),
      }) as never,
    );
    renderUi(<AppShell features={{ login: true, admin: false, terminal: false }} />, {
      route: '/login',
    });
    await waitFor(() => expect(authStore.initialized).toBe(true));
    expect(screen.getByTestId('login')).toBeTruthy();
  });
});
