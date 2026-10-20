import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { TerminalPanel } from '../src/components/terminal/TerminalPanel';
import { terminalStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

const xterm = vi.hoisted(() => ({
  terms: [] as Array<{
    cols: number;
    rows: number;
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onResize: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  fits: [] as Array<{ fit: ReturnType<typeof vi.fn> }>,
  sockets: [] as Array<{
    url: string;
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onerror?: () => void;
  }>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    onData = vi.fn();
    onResize = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    constructor() {
      xterm.terms.push(this);
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    constructor() {
      xterm.fits.push(this);
    }
  },
}));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}));

class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  send = vi.fn();
  close = vi.fn();
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onerror?: () => void;
  constructor(public url: string) {
    xterm.sockets.push(this);
  }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  installDomStubs();
  xterm.terms.length = 0;
  xterm.fits.length = 0;
  xterm.sockets.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ mode: 'spawn' })),
  );
  terminalStore.open = true;
  terminalStore.collapsed = false;
  terminalStore.fullscreen = false;
  terminalStore.height = 300;
  terminalStore.dragging = false;
  terminalStore.sidebarCollapsed = true;
  terminalStore.sessions = [{ id: 's1', cwd: '/home/u/projects/demo' } as never];
  terminalStore.activeSessionId = 's1';
  terminalStore.ptyMode = 'pty';
  window.innerWidth = 1280;
});

afterEach(() => {
  cleanup();
  terminalStore.open = false;
  terminalStore.collapsed = false;
  terminalStore.fullscreen = false;
  terminalStore.dragging = false;
  terminalStore.sessions = [];
  terminalStore.activeSessionId = null;
  terminalStore.ptyMode = 'unknown';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TerminalPanel', () => {
  it('xterm/WS 初始化、消息流、输入/resize、PTY 模式查询', async () => {
    renderUi(<TerminalPanel />);
    await waitFor(() => expect(xterm.terms.length).toBe(1));
    expect(xterm.sockets.length).toBe(1);
    expect(xterm.sockets[0].url).toContain('/api/terminal/ws');
    const term = xterm.terms[0];
    const ws = xterm.sockets[0];

    ws.onopen?.();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'init', cwd: '/home/u/projects/demo', cols: 80, rows: 24 }),
    );

    ws.onmessage?.({ data: JSON.stringify({ type: 'output', data: 'hello' }) });
    expect(term.write).toHaveBeenCalledWith('hello');
    ws.onmessage?.({ data: JSON.stringify({ type: 'mode', mode: 'spawn' }) });
    await waitFor(() => expect(terminalStore.ptyMode).toBe('spawn'));
    ws.onmessage?.({ data: JSON.stringify({ type: 'exit', code: 1 }) });
    expect(term.write).toHaveBeenCalledWith(expect.stringContaining('进程退出'));
    ws.onmessage?.({ data: JSON.stringify({ type: 'error', message: 'boom' }) });
    expect(term.write).toHaveBeenCalledWith(expect.stringContaining('boom'));
    ws.onmessage?.({ data: 'not-json' });
    ws.onerror?.();
    expect(term.write).toHaveBeenCalledWith(expect.stringContaining('WebSocket 连接错误'));

    const onData = term.onData.mock.calls[0][0] as (d: string) => void;
    onData('ls');
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'input', data: 'ls' }));
    ws.readyState = 0;
    onData('ignored');
    ws.readyState = 1;
    const onResize = term.onResize.mock.calls[0][0] as (s: { cols: number; rows: number }) => void;
    onResize({ cols: 100, rows: 40 });
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'resize', cols: 100, rows: 40 }));

    // fetch 模式查询把 store 设为 spawn
    await waitFor(() => expect(screen.getByText('SPAWN')).toBeTruthy());
    expect(screen.getByText(/降级模式/)).toBeTruthy();
  });

  it('工具栏按钮、拖拽、会话切换/关闭、空态与折叠', async () => {
    const { container } = renderUi(<TerminalPanel />);
    await waitFor(() => expect(xterm.terms.length).toBe(1));

    const actions = container.querySelectorAll('.terminal-panel__actions button');
    // 新建
    fireEvent.click(actions[0]);
    expect(terminalStore.sessions.length).toBe(2);
    // 全屏
    fireEvent.click(actions[1]);
    expect(terminalStore.fullscreen).toBe(true);
    fireEvent.click(actions[1]);
    expect(terminalStore.fullscreen).toBe(false);
    // 收起/展开
    fireEvent.click(actions[2]);
    expect(terminalStore.collapsed).toBe(true);
    fireEvent.click(actions[2]);
    expect(terminalStore.collapsed).toBe(false);
    // 关闭
    fireEvent.click(actions[3]);
    expect(terminalStore.open).toBe(false);

    // 重新打开；双击标题栏折叠
    terminalStore.open = true;
    await waitFor(() => expect(container.querySelector('.terminal-panel')).toBeTruthy());
    const header = container.querySelector('.terminal-panel__header') as HTMLElement;
    fireEvent.doubleClick(header);
    expect(terminalStore.collapsed).toBe(true);
    terminalStore.collapsed = false;

    // resize 拖拽
    await waitFor(() =>
      expect(container.querySelector('.terminal-panel__resize-handle')).toBeTruthy(),
    );
    const handle = container.querySelector('.terminal-panel__resize-handle') as HTMLElement;
    fireEvent.mouseDown(handle, { clientY: 500 });
    fireEvent.mouseMove(document, { clientY: 400 });
    fireEvent.mouseUp(document);
    expect(terminalStore.height).toBe(400);

    // 会话列表切换与关闭
    const items = container.querySelectorAll('.terminal-session-item');
    expect(items.length).toBeGreaterThan(0);
    fireEvent.click(items[0]);
    const closeBtn = items[0].querySelector('button') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(terminalStore.sessions.length).toBe(1);

    // 空态
    terminalStore.sessions = [];
    await waitFor(() => expect(screen.getByText('点击 + 新建终端')).toBeTruthy());
  });

  it('移动端会话列表按钮、折叠时隐藏主体、未打开不渲染', async () => {
    window.innerWidth = 500;
    const { container } = renderUi(<TerminalPanel />);
    await waitFor(() => expect(xterm.terms.length).toBe(1));
    const actions = container.querySelectorAll('.terminal-panel__actions button');
    // 移动端第一个按钮为会话列表
    fireEvent.click(actions[0]);
    expect(terminalStore.sidebarCollapsed).toBe(false);
    expect(container.querySelector('.terminal-panel__sidebar')).toBeTruthy();

    terminalStore.collapsed = true;
    await waitFor(() => expect(container.querySelector('.terminal-panel__body')).toBeNull());
    expect(container.querySelector('.terminal-panel')).toBeTruthy();

    terminalStore.open = false;
    await waitFor(() => expect(container.querySelector('.terminal-panel')).toBeNull());
  });
});
