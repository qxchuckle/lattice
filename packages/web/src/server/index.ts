import { createServer } from './app';
import { createServer as createNetServer } from 'node:net';
import { exec } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheDir } from '@qcqx/lattice-core';

export interface StartServerOptions {
  port?: number;
  open?: boolean;
}

const PID_FILE = join(getCacheDir(), 'web-server.json');

interface ServerInfo {
  pid: number;
  port: number;
  startTime: string;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
    server.on('error', () => resolve(false));
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`从端口 ${startPort} 开始连续 100 个端口均被占用`);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'darwin') {
    cmd = `open ${url}`;
  } else if (platform === 'win32') {
    cmd = `start "" ${url}`;
  } else {
    cmd = `xdg-open ${url}`;
  }
  exec(cmd, (err) => {
    if (err) console.warn('无法自动打开浏览器，请手动访问:', url);
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkExistingServer(): Promise<ServerInfo | null> {
  if (!existsSync(PID_FILE)) return null;

  let info: ServerInfo;
  try {
    info = JSON.parse(readFileSync(PID_FILE, 'utf-8')) as ServerInfo;
  } catch {
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    return null;
  }

  if (!info.pid || !info.port) {
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    return null;
  }

  if (!isProcessAlive(info.pid)) {
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    return null;
  }

  try {
    const res = await fetch(`http://localhost:${info.port}/api/stats`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.status !== 404) return info;
  } catch {
    // API 不可访问
  }

  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  return null;
}

function writePidFile(port: number): void {
  const info: ServerInfo = {
    pid: process.pid,
    port,
    startTime: new Date().toISOString(),
  };
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

export async function startServer(opts?: StartServerOptions): Promise<void> {
  const requestedPort = opts?.port ?? 3000;
  const shouldAutoOpen = opts?.open ?? !process.env.LATTICE_WEB_NO_OPEN;

  // 检测是否已有 lattice web 在运行
  const existing = await checkExistingServer();
  if (existing) {
    const url = `http://localhost:${existing.port}`;
    console.log(`\n  ⚠ Lattice Web 已在运行中 → ${url}`);
    console.log(`  PID: ${existing.pid}  启动时间: ${existing.startTime}`);
    console.log(`  如需重新启动，请先关闭已有服务\n`);

    if (shouldAutoOpen) {
      openBrowser(url);
    }
    return;
  }

  let port: number;

  if (opts?.port !== undefined) {
    if (!(await isPortAvailable(requestedPort))) {
      console.error(`\n✗ 端口 ${requestedPort} 已被占用，请更换端口（--port <n>）\n`);
      process.exit(1);
    }
    port = requestedPort;
  } else {
    port = await findAvailablePort(requestedPort);
  }

  const app = await createServer();

  try {
    await app.listen({ port, host: '127.0.0.1' });
    writePidFile(port);

    const url = `http://localhost:${port}`;
    console.log(`\n  ✓ Lattice Web 已启动 → ${url}\n`);

    if (shouldAutoOpen) {
      openBrowser(url);
    }

    const shutdown = async () => {
      console.log('\n  正在关闭 Lattice Web...');
      removePidFile();
      await app.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    removePidFile();
    console.error('\n✗ 启动失败:', err, '\n');
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('server/index.ts') || process.argv[1]?.endsWith('server/index.js')) {
  startServer();
}
