import type { Command } from 'commander';
import { initDb } from '@qcqx/lattice-core';

/**
 * 注册 `lattice web` 子命令。
 * 动态 import @qcqx/lattice-web，未安装时提示用户安装。
 * web 包不在 cli 的 dependencies 中（保持可选安装）。
 */
export function registerWebCommand(program: Command): void {
  program
    .command('web')
    .description('启动 Lattice 可视化 Web 服务')
    .option('-p, --port <port>', '端口号，默认 14527')
    .option('--no-open', '不自动打开浏览器')
    .action(async (opts: { port?: string; open: boolean }) => {
      try {
        // 初始化数据库
        await initDb();

        // 动态 import：web 包可选安装，不在 cli dependencies 中
        const webModule: {
          startServer: (opts?: { port?: number; open?: boolean }) => Promise<void>;
        } = await import('@qcqx/lattice-web');
        await webModule.startServer({
          port: opts.port ? parseInt(opts.port, 10) : undefined,
          open: opts.open,
        });
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        const message = (err as { message?: string }).message || '';
        if (
          code === 'ERR_MODULE_NOT_FOUND' ||
          code === 'MODULE_NOT_FOUND' ||
          message.includes('Cannot find')
        ) {
          console.log('\n  ✗ 可视化包未安装\n');
          console.log('  请运行: npm i -g @qcqx/lattice-web\n');
        } else {
          throw err;
        }
      }
    });
}
