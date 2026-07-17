import type { FastifyInstance } from 'fastify';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { getUsername } from '@qcqx/lattice-core';
import { isPathSafe } from './shared';

// ── 终端进程抽象（PTY / spawn 降级统一接口）──

interface ITerminalProcess {
  readonly pid: number;
  readonly mode: 'pty' | 'spawn';
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number, signal?: number) => void): void;
}

// ── node-pty 动态加载（失败降级 spawn）──
// 使用 optionalDependencies，加载失败不阻断 lattice-web 安装
// 运行时动态 import，有则 PTY 完整体验，无则降级 spawn

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ptyModule: any = null;
let ptyTried = false;

async function getPty(): Promise<unknown> {
  if (ptyTried) return ptyModule;
  ptyTried = true;
  try {
    ptyModule = await import('@homebridge/node-pty-prebuilt-multiarch');
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

/** 当前 PTY 模式（前端查询用） */
let currentMode: 'pty' | 'spawn' = 'spawn';

function getDefaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe';
  return process.env.SHELL || 'bash';
}

function createPtyProcess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pty: any,
  shell: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  cols: number,
  rows: number,
): ITerminalProcess {
  const proc = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env,
  });
  return {
    pid: proc.pid,
    mode: 'pty',
    write: (data) => proc.write(data),
    resize: (c, r) => {
      try {
        proc.resize(c, r);
      } catch {
        /* resize 失败忽略 */
      }
    },
    kill: () => {
      try {
        proc.kill();
      } catch {
        /* 已退出 */
      }
    },
    onData: (cb) => proc.onData(cb),
    onExit: (cb) =>
      proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) =>
        cb(exitCode, signal),
      ),
  };
}

function createSpawnProcess(shell: string, cwd: string, env: NodeJS.ProcessEnv): ITerminalProcess {
  const args = process.platform === 'win32' ? [] : ['-i'];
  const proc = spawn(shell, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;

  return {
    pid: proc.pid ?? -1,
    mode: 'spawn',
    write: (data) => {
      try {
        proc.stdin.write(data);
      } catch {
        /* stdin 已关闭 */
      }
    },
    resize: () => {
      /* spawn 模式不支持 resize */
    },
    kill: () => {
      try {
        proc.kill();
      } catch {
        /* 已退出 */
      }
    },
    onData: (cb) => {
      proc.stdout.on('data', (d: Buffer) => cb(d.toString()));
      proc.stderr.on('data', (d: Buffer) => cb(d.toString()));
    },
    onExit: (cb) => {
      proc.on('exit', (code, signal) => {
        cb(code ?? -1, signal ? Number(signal) || undefined : undefined);
      });
    },
  };
}

// ── WebSocket 消息协议 ──
// client → server: { type: 'init', cwd, cols, rows } | { type: 'input', data } | { type: 'resize', cols, rows }
// server → client: { type: 'mode', mode } | { type: 'output', data } | { type: 'exit', code } | { type: 'error', message }

interface ClientMessage {
  type: 'init' | 'input' | 'resize';
  cwd?: string;
  cols?: number;
  rows?: number;
  data?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function send(ws: { send: (data: string) => void }, payload: Record<string, unknown>) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* 连接已关闭 */
  }
}

export function registerTerminalRoutes(app: FastifyInstance): void {
  // 查询当前 PTY 模式
  app.get('/api/terminal/mode', async () => {
    if (!ptyTried) {
      await getPty();
      currentMode = ptyModule ? 'pty' : 'spawn';
    }
    return { mode: currentMode };
  });

  // WebSocket 终端端点
  // @fastify/websocket 扩展了 FastifyInstance 的 get 方法支持 websocket 选项，
  // 但 TypeScript 类型声明需要运行时注册后才完整，这里用类型断言注册
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get(
    '/api/terminal/ws',
    { websocket: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (socket: any, _req: any) => {
      let proc: ITerminalProcess | null = null;
      let initialized = false;

      const cleanup = () => {
        if (proc) {
          proc.kill();
          proc = null;
        }
      };

      socket.on('message', async (raw: Buffer | string | unknown[]) => {
        let msg: ClientMessage;
        try {
          const text = typeof raw === 'string' ? raw : Buffer.from(raw as Uint8Array).toString();
          msg = JSON.parse(text);
        } catch {
          return; // 忽略无法解析的消息
        }

        // 首条消息：初始化终端会话
        if (msg.type === 'init' && !initialized) {
          initialized = true;
          const requestedCwd = msg.cwd;
          const cols = msg.cols || 80;
          const rows = msg.rows || 24;

          // 安全校验：前端指定 cwd 时校验 isPathSafe；
          // 空 cwd 由后端用 HOME（安全默认值，不需校验）
          const username = await getUsername();
          if (requestedCwd) {
            if (!(await isPathSafe(requestedCwd, username))) {
              send(socket, { type: 'error', message: '路径不在允许范围内' });
              send(socket, { type: 'exit', code: -1 });
              cleanup();
              return;
            }
          }
          const cwd = requestedCwd || process.env.HOME || '/';

          const shell = getDefaultShell();
          const env = { ...process.env, TERM: 'xterm-256color' };

          // 动态加载 PTY，失败降级 spawn
          const pty = await getPty();
          if (pty) {
            currentMode = 'pty';
            try {
              proc = createPtyProcess(pty, shell, cwd, env, cols, rows);
            } catch {
              proc = createSpawnProcess(shell, cwd, env);
              currentMode = 'spawn';
            }
          } else {
            currentMode = 'spawn';
            proc = createSpawnProcess(shell, cwd, env);
          }

          send(socket, { type: 'mode', mode: proc.mode });

          // 绑定输出和退出回调
          proc.onData((data) => send(socket, { type: 'output', data }));
          proc.onExit((code) => {
            send(socket, { type: 'exit', code });
            cleanup();
          });
          return;
        }

        if (!proc) return;

        // 后续消息：输入 / resize
        if (msg.type === 'input' && typeof msg.data === 'string') {
          proc.write(msg.data);
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          proc.resize(msg.cols, msg.rows);
        }
      });

      // 连接关闭 / 出错时清理进程
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
}
