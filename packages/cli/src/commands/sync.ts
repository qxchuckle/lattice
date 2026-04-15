import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { getLatticeRoot, readResolvedConfig, dirExists } from '@qcqx/lattice-core';
import { join } from 'node:path';
import { logger } from '../utils';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('同步 ~/.lattice/ 的 Git 仓库')
    .option('--pull', '仅拉取')
    .option('--push', '仅推送')
    .action(async (opts) => {
      try {
        const root = getLatticeRoot();

        if (!(await dirExists(join(root, '.git')))) {
          logger.raw(chalk.yellow('~/.lattice 未启用 Git 管理'));
          return;
        }

        const config = await readResolvedConfig();
        if (!config?.gitRemote) {
          logger.raw(chalk.yellow('未配置 Git 远程仓库。请运行 lattice init --git-remote <url>'));
          return;
        }

        const execOpts = { cwd: root, stdio: 'pipe' as const, encoding: 'utf-8' as const };

        // 先 commit 所有变更
        try {
          execSync('git add -A', execOpts);
          const status = execSync('git status --porcelain', execOpts).trim();
          if (status) {
            execSync('git commit -m "chore: 自动同步"', execOpts);
            logger.raw(chalk.dim('已提交本地变更'));
          }
        } catch {
          // 无变更也不报错
        }

        if (!opts.push) {
          // Pull
          logger.raw(chalk.blue('正在拉取远程变更...'));
          try {
            execSync('git pull --rebase', execOpts);
            logger.raw(chalk.green('✓ 拉取完成'));
          } catch (err) {
            logger.raw(chalk.yellow('拉取失败：'), (err as Error).message);
          }
        }

        if (!opts.pull) {
          // Push
          logger.raw(chalk.blue('正在推送本地变更...'));
          try {
            execSync('git push', execOpts);
            logger.raw(chalk.green('✓ 推送完成'));
          } catch (err) {
            logger.raw(chalk.yellow('推送失败：'), (err as Error).message);
          }
        }
      } catch (err) {
        console.error(chalk.red('同步失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
