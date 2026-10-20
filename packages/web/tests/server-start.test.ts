import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { getCacheDir } from '@qcqx/lattice-core';
import { createFixtureHome } from '../../services/tests/fixture';

const state = vi.hoisted(() => ({
  createCount: 0,
  listenPort: 0,
  listenError: null as Error | null,
  closed: 0,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: vi.fn((_cmd: string, cb?: (err: Error | null) => void) => cb?.(new Error('no-open'))),
  };
});

vi.mock('../src/server/app', () => ({
  createServer: vi.fn(async () => {
    state.createCount++;
    return {
      listen: async ({ port }: { port: number }) => {
        if (state.listenError) throw state.listenError;
        state.listenPort = port;
      },
      close: async () => {
        state.closed++;
      },
    };
  }),
}));

const fixture = createFixtureHome();
process.env.LATTICE_HOME = fixture.home;
process.env.LATTICE_WEB_NO_OPEN = '1';

const { startServer } = await import('../src/server/index');

const pidFile = join(getCacheDir(), 'web-server.json');
let sigint: (() => Promise<void>) | null = null;
let sigterm: (() => Promise<void>) | null = null;
let exitCode: number | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

beforeEach(async () => {
  state.createCount = 0;
  state.listenPort = 0;
  state.listenError = null;
  state.closed = 0;
  exitCode = null;
  sigint = null;
  sigterm = null;
  await mkdir(getCacheDir(), { recursive: true });
  vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
    if (event === 'SIGINT') sigint = handler;
    if (event === 'SIGTERM') sigterm = handler;
    return process;
  }) as never);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    return undefined as never;
  }) as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env.LATTICE_WEB_NO_OPEN = '1';
  await rm(pidFile, { force: true });
});

test('startServer：已有实例直接复用（有效 pid + HTTP 可访问）', async () => {
  const http = createHttpServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await writeFile(
    pidFile,
    JSON.stringify({ pid: process.pid, port, startTime: '2026-01-01T00:00:00.000Z' }),
  );

  delete process.env.LATTICE_WEB_NO_OPEN;
  await startServer({});
  assert.equal(state.createCount, 0);
  assert.match(console.warn.mock.calls.flat().join(' '), /无法自动打开浏览器/);
  assert.match(console.log.mock.calls.flat().join(' '), /已在运行中/);
  http.close();
});

test('startServer：有效端口启动/写 pid/信号关闭；非法 pid 文件与失效实例自动清理', async () => {
  const port = await freePort();
  delete process.env.LATTICE_WEB_NO_OPEN;
  await startServer({ port });
  assert.match(console.warn.mock.calls.flat().join(' '), /无法自动打开浏览器/);
  assert.equal(state.createCount, 1);
  assert.equal(state.listenPort, port);
  const info = JSON.parse(await readFile(pidFile, 'utf-8'));
  assert.equal(info.pid, process.pid);
  assert.equal(info.port, port);
  assert.match(console.log.mock.calls.flat().join(' '), /Lattice Web 已启动/);
  assert.ok(sigterm);
  await sigterm!();
  assert.equal(state.closed, 1);
  assert.equal(exitCode, 0);
  await assert.rejects(access(pidFile));

  // 非法 JSON → 清理后重新启动（覆盖 findAvailablePort）
  await writeFile(pidFile, 'not-json');
  await startServer({ open: false });
  assert.equal(state.createCount, 2);
  assert.ok(state.listenPort >= 14527);
  assert.ok(sigint);
  await sigint!();
  assert.equal(state.closed, 2);

  // 缺 pid/port 字段 → 清理
  await writeFile(pidFile, JSON.stringify({ pid: 0, port: 0 }));
  await startServer({ open: false });
  assert.equal(state.createCount, 3);

  // 进程存活但 HTTP 不可达 → 清理后重启
  await writeFile(
    pidFile,
    JSON.stringify({ pid: process.pid, port: await freePort(), startTime: 'x' }),
  );
  await startServer({ open: false });
  assert.equal(state.createCount, 4);

  // 进程已死 → 清理后重启
  await writeFile(pidFile, JSON.stringify({ pid: 999999, port: 1, startTime: 'x' }));
  await startServer({ open: false });
  assert.equal(state.createCount, 5);
});

test('startServer：端口占用提示与 listen 失败分支', async () => {
  const occupied = createNetServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  await startServer({ port, open: false });
  assert.match(console.error.mock.calls.flat().join(' '), /已被占用/);
  assert.equal(exitCode, 1);
  if (sigterm) await sigterm();

  state.listenError = new Error('boom');
  const nextPort = await freePort();
  exitCode = null;
  await startServer({ port: nextPort, open: false });
  assert.match(console.error.mock.calls.flat().join(' '), /启动失败/);
  assert.equal(exitCode, 1);
  await assert.rejects(access(pidFile));
  occupied.close();
});
