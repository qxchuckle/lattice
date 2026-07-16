import { Command } from 'commander';
import chalk from 'chalk';
import { syncAll, pullRebase, pushGit } from '@qcqx/lattice-core';
import { logger } from '../utils';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('同步 ~/.lattice/ 的 Git 仓库')
    .option('--pull', '仅拉取')
    .option('--push', '仅推送')
    .action(async (opts) => {
      try {
        if (opts.pull && opts.push) {
          logger.raw(chalk.yellow('--pull 和 --push 不能同时使用'));
          return;
        }

        if (opts.pull) {
          logger.raw(chalk.blue('正在拉取远程变更...'));
          const result = await pullRebase();
          if (result.success) {
            logger.raw(chalk.green(`✓ ${result.message}`));
            if (result.output) logger.raw(chalk.dim(`  ${result.output}`));
          } else {
            logger.raw(chalk.yellow(result.message));
          }
          return;
        }

        if (opts.push) {
          logger.raw(chalk.blue('正在推送本地变更...'));
          const result = await pushGit();
          if (result.success) {
            logger.raw(chalk.green(`✓ ${result.message}`));
            if (result.output) logger.raw(chalk.dim(`  ${result.output}`));
          } else {
            logger.raw(chalk.yellow(result.message));
          }
          return;
        }

        // 默认完整同步
        logger.raw(chalk.blue('正在同步...'));
        const results = await syncAll();

        if (results.commit.success) {
          logger.raw(chalk.dim(`  ${results.commit.message}`));
        } else {
          logger.raw(chalk.yellow(`  ${results.commit.message}`));
        }

        if (results.pull.success) {
          logger.raw(chalk.green(`  ✓ ${results.pull.message}`));
          if (results.pull.output) logger.raw(chalk.dim(`    ${results.pull.output}`));
        } else {
          logger.raw(chalk.yellow(`  ${results.pull.message}`));
        }

        if (results.push.success) {
          logger.raw(chalk.green(`  ✓ ${results.push.message}`));
          if (results.push.output) logger.raw(chalk.dim(`    ${results.push.output}`));
        } else {
          logger.raw(chalk.yellow(`  ${results.push.message}`));
        }

        logger.raw(chalk.green('\n✓ 同步完成'));
      } catch (err) {
        console.error(chalk.red('同步失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
