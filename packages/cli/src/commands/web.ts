import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';

function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535)
    throw new InvalidArgumentError('端口号必须是 1 到 65535 之间的整数');
  return port;
}

export function registerWebCommand(program: Command): void {
  program
    .command('web')
    .description('启动 Lattice 可视化 Web 服务')
    .option('-p, --port <port>', '端口号，默认 14527', parsePort)
    .option('--no-open', '不自动打开浏览器')
    .action(async (opts: { port?: number; open: boolean }) => {
      // Keep Web and its dependencies off the startup path of all other commands.
      const { startServer } = await import('@qcqx/lattice-web');
      await startServer(opts);
    });
}
