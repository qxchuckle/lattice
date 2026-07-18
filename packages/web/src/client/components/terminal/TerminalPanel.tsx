import { useEffect, useRef, useCallback, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button, Tag, Tooltip } from 'antd';
import {
  PlusOutlined,
  CloseOutlined,
  ExpandOutlined,
  CompressOutlined,
  UpOutlined,
  DownOutlined,
  CodeOutlined,
  WarningOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import {
  terminalStore,
  type TerminalSession,
  addTerminalSession,
  closeTerminalSession,
  setActiveTerminal,
  closeTerminalPanel,
  toggleTerminalCollapse,
  toggleTerminalFullscreen,
  setTerminalHeight,
  setTerminalPtyMode,
  authStore,
  toggleTerminalSidebar,
} from '../../store';
import { apiGet } from '../../lib';
import { useIsMobile } from '../../hooks';
import './TerminalPanel.less';

// ── xterm 主题（深色，匹配 web 深色风格）──
const terminalTheme: ITheme = {
  background: '#1e1e28',
  foreground: '#eaeaf0',
  cursor: '#4096ff',
  cursorAccent: '#1e1e28',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#ff5454',
  green: '#54ff54',
  yellow: '#ffff54',
  blue: '#5454ff',
  magenta: '#ff54ff',
  cyan: '#54ffff',
  white: '#ffffff',
  brightBlack: '#808080',
  brightRed: '#ff8b8b',
  brightGreen: '#8bff8b',
  brightYellow: '#ffff8b',
  brightBlue: '#8b8bff',
  brightMagenta: '#ff8bff',
  brightCyan: '#8bffff',
  brightWhite: '#ffffff',
};

/** 构建 WebSocket URL（鉴权启用时带 token query，握手无法设置 Header） */
function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${window.location.host}/api/terminal/ws`;
  // 直接读 valtio proxy 属性（模块级非 React 上下文安全）
  return authStore.token ? `${base}?token=${encodeURIComponent(authStore.token)}` : base;
}

// ── 单个终端会话视图（xterm + WebSocket）──

const TerminalSessionView = memo(function TerminalSessionView({
  session,
  active,
}: {
  session: TerminalSession;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // 创建 Terminal + WebSocket（会话 ID / cwd 变化时重建）
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
      fontSize: 13,
      theme: terminalTheme,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    // WebSocket 连接
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'init',
          cwd: session.cwd,
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'output') {
          term.write(msg.data as string);
        } else if (msg.type === 'mode') {
          setTerminalPtyMode(msg.mode as 'pty' | 'spawn');
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[33m[进程退出，代码 ${msg.code}]\x1b[0m\r\n`);
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31m[错误: ${msg.message}]\x1b[0m\r\n`);
        }
      } catch {
        // 忽略无法解析的消息
      }
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[31m[WebSocket 连接错误]\x1b[0m\r\n');
    };

    // 终端输入 → WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // 终端 resize → WebSocket
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // ResizeObserver：容器尺寸变化时自动 fit
    const observer = new ResizeObserver(() => {
      const container = containerRef.current;
      if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        try {
          fit.fit();
        } catch {
          /* 容器尺寸可能为 0 */
        }
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [session.id, session.cwd]);

  // 活动会话变化时 fit（等待 display 生效）
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        try {
          fitRef.current?.fit();
        } catch {
          /* 忽略 */
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div
      ref={containerRef}
      className='terminal-session-view'
      style={{ display: active ? 'block' : 'none' }}
    />
  );
});

// ── 终端面板主组件（VS Code 底栏风格）──

export const TerminalPanel = memo(function TerminalPanel() {
  const {
    open,
    collapsed,
    fullscreen,
    height,
    sessions,
    activeSessionId,
    ptyMode,
    dragging,
    sidebarCollapsed,
  } = useSnapshot(terminalStore);
  const isMobile = useIsMobile();

  // 设置 CSS 变量 --terminal-offset：终端面板打开时让出 sidebar/detail panel 底部空间（最多 50vh）
  useEffect(() => {
    const offset =
      open && !fullscreen ? (collapsed ? 32 : Math.min(height, window.innerHeight * 0.6)) : 0;
    document.documentElement.style.setProperty('--terminal-offset', `${offset}px`);
    return () => {
      document.documentElement.style.setProperty('--terminal-offset', '0px');
    };
  }, [open, collapsed, fullscreen, height]);

  // dragging 时设置 body class（禁用 sidebar/detail panel 的 transition，避免拖拽不跟手）
  useEffect(() => {
    if (dragging) {
      document.documentElement.classList.add('terminal-dragging');
    } else {
      document.documentElement.classList.remove('terminal-dragging');
    }
    return () => {
      document.documentElement.classList.remove('terminal-dragging');
    };
  }, [dragging]);

  // 查询 PTY 模式
  useEffect(() => {
    if (!open) return;
    apiGet<{ mode?: string }>('/api/terminal/mode')
      .then((data) => {
        if (data.mode) setTerminalPtyMode(data.mode as 'pty' | 'spawn');
      })
      .catch(() => {});
  }, [open]);

  // 拖拽调高度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalStore.height;
    terminalStore.dragging = true;
    const onMouseMove = (ev: MouseEvent) => {
      setTerminalHeight(startHeight - (ev.clientY - startY));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      terminalStore.dragging = false;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  if (!open) return null;

  const panelHeight = fullscreen ? 'calc(100vh - 40px)' : collapsed ? 32 : height;

  return (
    <div
      className={`terminal-panel${collapsed ? ' terminal-panel--collapsed' : ''}${fullscreen ? ' terminal-panel--fullscreen' : ''}${dragging ? ' terminal-panel--dragging' : ''}`}
      style={{ height: panelHeight }}>
      {/* 拖拽 resize handle */}
      {!collapsed && !fullscreen && (
        <div className='terminal-panel__resize-handle' onMouseDown={handleResizeStart} />
      )}

      {/* 标题栏 */}
      <div className='terminal-panel__header' onDoubleClick={toggleTerminalCollapse}>
        <div className='terminal-panel__header-left'>
          <CodeOutlined className='terminal-panel__icon' />
          <span className='terminal-panel__title'>终端</span>
          {ptyMode !== 'unknown' && (
            <Tag
              color={ptyMode === 'pty' ? 'green' : 'orange'}
              style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>
              {ptyMode === 'pty' ? 'PTY' : 'SPAWN'}
            </Tag>
          )}
        </div>
        <div className='terminal-panel__actions' onDoubleClick={(e) => e.stopPropagation()}>
          {isMobile && (
            <Tooltip title={sidebarCollapsed ? '显示会话列表' : '隐藏会话列表'}>
              <Button
                size='small'
                type='text'
                icon={<UnorderedListOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTerminalSidebar();
                }}
              />
            </Tooltip>
          )}
          <Tooltip title='新建终端'>
            <Button
              size='small'
              type='text'
              icon={<PlusOutlined />}
              onClick={() => addTerminalSession()}
            />
          </Tooltip>
          <Tooltip title={fullscreen ? '退出全屏' : '全屏'}>
            <Button
              size='small'
              type='text'
              icon={fullscreen ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={toggleTerminalFullscreen}
            />
          </Tooltip>
          <Tooltip title={collapsed ? '展开' : '收起'}>
            <Button
              size='small'
              type='text'
              icon={collapsed ? <UpOutlined /> : <DownOutlined />}
              onClick={toggleTerminalCollapse}
            />
          </Tooltip>
          <Tooltip title='关闭面板'>
            <Button
              size='small'
              type='text'
              icon={<CloseOutlined />}
              onClick={closeTerminalPanel}
            />
          </Tooltip>
        </div>
      </div>

      {/* 降级模式提示 */}
      {!collapsed && ptyMode === 'spawn' && (
        <div className='terminal-panel__fallback-notice'>
          <WarningOutlined /> 降级模式（SPAWN）：vim/top 等全屏程序不可用。重新安装
          @qcqx/lattice-web 可启用完整 PTY 模式
        </div>
      )}

      {/* 主体 */}
      {!collapsed && (
        <div className='terminal-panel__body'>
          {/* 终端渲染区 */}
          <div className='terminal-panel__main'>
            {sessions.length === 0 ? (
              <div className='terminal-panel__empty'>点击 + 新建终端</div>
            ) : (
              sessions.map((s) => (
                <TerminalSessionView
                  key={s.id}
                  session={s as TerminalSession}
                  active={s.id === activeSessionId}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* 右侧会话列表（移到 body 外，避免 overflow:hidden 裁剪） */}
      {!collapsed && sessions.length > 0 && (
        <div
          className='terminal-panel__sidebar'
          style={
            isMobile
              ? { transform: sidebarCollapsed ? 'translateX(100%)' : 'translateX(0)' }
              : undefined
          }>
          {sessions.map((s) => {
            const displayName = s.cwd ? s.cwd.split('/').pop() || s.cwd : '~';
            return (
              <div
                key={s.id}
                className={`terminal-session-item${s.id === activeSessionId ? ' terminal-session-item--active' : ''}`}
                onClick={() => setActiveTerminal(s.id)}>
                <Tooltip title={s.cwd || '~'} placement='left'>
                  <span className='terminal-session-item__name'>{displayName}</span>
                </Tooltip>
                <Button
                  size='small'
                  type='text'
                  icon={<CloseOutlined />}
                  className='terminal-session-item__close'
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminalSession(s.id);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
