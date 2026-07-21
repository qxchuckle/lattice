import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import {
  getUsername,
  readResolvedConfig,
  scanForProjects,
  type ScanProgress,
  initDb,
  closeDb,
} from '@qcqx/lattice-core';
import { logger, resolveAndRegisterUpwards } from '../utils';

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('扫描目录，发现所有 Lattice 项目')
    .option('--dirs <dirs>', '指定扫描目录（逗号分隔）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        let dirs: string[];
        if (opts.dirs) {
          dirs = (opts.dirs as string).split(',').map((d: string) => resolve(d.trim()));
        } else {
          const config = await readResolvedConfig();
          if (config?.scanDirs?.length) {
            dirs = config.scanDirs.map((d) => resolve(d.replace(/^~/, process.env.HOME ?? '')));
          } else {
            logger.raw(chalk.yellow('未指定扫描目录。请使用 --dirs 参数或在配置中设置 scanDirs'));
            closeDb();
            return;
          }
        }

        logger.raw(chalk.blue(`正在扫描 ${dirs.length} 个目录...`));
        for (const dir of dirs) {
          logger.raw(chalk.dim(`  ${dir}`));
        }

        // 向上注册：对每个目标路径解析其自身及祖先的 ID 源
        for (const dir of dirs) {
          try {
            await resolveAndRegisterUpwards(dir);
          } catch {
            // 向上注册失败不阻断向下扫描
          }
        }

        const startTime = Date.now();
        const result = await scanForProjects(username, dirs, (p: ScanProgress) => {
          const dirShort =
            p.currentDir.length > 60 ? '...' + p.currentDir.slice(-57) : p.currentDir;
          const line =
            `${chalk.dim('扫描')} ${dirShort.padEnd(60)} ${chalk.green('+' + p.added)} ${chalk.blue('~' + p.updated)} ${chalk.dim('(' + p.found + ')')}`.slice(
              0,
              120,
            );
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(line);
        });
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);

        closeDb();

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.raw(chalk.green(`\n✓ 扫描完成 (${elapsed}s)`));
        logger.raw(chalk.dim(`  新增：${result.added.length} 个项目`));
        logger.raw(chalk.dim(`  更新：${result.updated.length} 个项目`));

        if (result.added.length > 0) {
          logger.raw(chalk.dim('\n新增项目：'));
          for (const p of result.added) {
            logger.raw(chalk.dim(`  + ${p}`));
          }
        }
      } catch (err) {
        console.error(chalk.red('扫描失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
