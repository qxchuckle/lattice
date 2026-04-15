import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import {
  readJSON,
  removeFile,
  getUsername,
  unregisterProject,
  initDb,
  closeDb,
} from '@qcqx/lattice-core';
import { logger, resolveProjectAtDirectory, shouldSkipConfirm } from '../utils';

export function registerUnlinkCommand(program: Command): void {
  program
    .command('unlink')
    .description('取消当前项目的 Lattice 注册')
    .option('-f, --fore', '跳过二次确认')
    .option('--remove-data', '同时删除 Lattice 中的项目数据')
    .action(async (opts) => {
      try {
        const project = await resolveProjectAtDirectory();
        if (!project) {
          logger.raw(chalk.yellow('当前目录不是 Lattice 项目（未找到 lattice.json）'));
          return;
        }

        const latticeJsonPath = project.latticeJsonPath;
        const data = await readJSON<{ id?: string }>(latticeJsonPath);
        if (!data?.id) {
          logger.raw(chalk.yellow('lattice.json 格式无效'));
          return;
        }

        // 二次确认
        if (!shouldSkipConfirm(opts)) {
          const confirmed = await confirm({
            message: `确认取消注册项目 ${data.id}？`,
            default: false,
          });
          if (!confirmed) {
            logger.raw(chalk.dim('已取消'));
            return;
          }
        }

        // 删除 lattice.json
        await removeFile(latticeJsonPath);

        // 如果 --remove-data，删除 lattice 中的项目数据
        if (opts.removeData) {
          const username = await getUsername();
          await initDb();
          await unregisterProject(username, data.id);
          closeDb();
          logger.raw(chalk.green('✓ 已删除 Lattice 中的项目数据'));
        }

        logger.raw(chalk.green('✓ 项目已取消 Lattice 注册'));
      } catch (err) {
        console.error(chalk.red('取消注册失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
