/**
 * E2E Server 入口 — Playwright webServer.command 启动此脚本
 *
 * 职责：
 *   1. 设置 LATTICE_HOME 到测试隔离目录（DB/session 缓存不污染用户数据）
 *   2. 启动 createE2EServer（mock agent + Fastify + WS/REST）
 *   3. 信号处理优雅关闭
 *
 * 不做 globalSetup（webServer 指令自带 start/stop/health-check 生命周期管理）。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createE2EServer } from '../utils/agent-server.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// 测试隔离目录（e2e 包内 .tmp-e2e-home，已在 .gitignore 中排除）
const E2E_HOME = resolve(__dirname, '../.tmp-e2e-home');
process.env.LATTICE_HOME = E2E_HOME;
mkdirSync(resolve(E2E_HOME, '.cache'), { recursive: true });

const PORT = Number(process.env.E2E_PORT ?? 14530);

async function main(): Promise<void> {
  const server = await createE2EServer(PORT);
  console.log(`[e2e-server] listening on http://localhost:${server.port}`);

  const shutdown = async (): Promise<void> => {
    console.log('[e2e-server] shutting down...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[e2e-server] failed to start:', err);
  process.exit(1);
});
