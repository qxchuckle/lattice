/**
 * Playwright webServer：启动构建产物版 web 服务（dist/server + dist/client）。
 *
 * - 固定端口 14529（被占用则失败退出，避免误连到别的实例）
 * - LATTICE_HOME 由 playwright.config.ts 的 webServer.env 注入（隔离 fixture 数据根）
 * - 前置：pnpm build:web（缺少产物时给出明确指引）
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const distServer = resolve(here, '../../web/dist/server/index.js');
const distClient = resolve(here, '../../web/dist/client/index.html');

if (!existsSync(distServer) || !existsSync(distClient)) {
  console.error('✗ 缺少 web 构建产物：请先运行 pnpm build:web');
  process.exit(1);
}

process.env.LATTICE_WEB_NO_OPEN = '1';

const { startServer } = await import(distServer);
await startServer({ port: 14529, open: false });
