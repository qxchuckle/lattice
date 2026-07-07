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
  findProjectById,
} from '@qcqx/lattice-core';
import { logger, resolveProjectAtDirectory, shouldSkipConfirm } from '../utils';

export function registerUnlinkCommand(program: Command): void {
  program
    .command('unlink')
    .description(
      '取消项目的 Lattice 注册（默认仅从当前目录 lattice.json 解绑；--id 可指定项目 ID；--remove-data 同时回收 Lattice 项目数据/关系/指纹）',
    )
    .option('-f, --force', '跳过二次确认')
    .option('--id <projectId>', '指定要解绑的项目 ID（不依赖当前目录 lattice.json）')
    .option(
      '--remove-data',
      '同时删除 Lattice 中的项目数据（关系/指纹会联动清理，仍可通过 trash restore 恢复）',
    )
    .action(async (opts) => {
      try {
        // 分支 A：--id 制定于某个项目 ID，不依赖当前目录
        if (opts.id) {
          const username = await getUsername();
          await initDb();
          const target = findProjectById(opts.id as string);
          if (!target) {
            closeDb();
            logger.raw(chalk.red(`未找到项目：${opts.id}`));
            process.exitCode = 1;
            return;
          }

          if (!shouldSkipConfirm(opts)) {
            const confirmed = await confirm({
              message: `确认取消注册项目 ${target.name} (${target.id})？`,
              default: false,
            });
            if (!confirmed) {
              closeDb();
              logger.raw(chalk.dim('已取消'));
              return;
            }
          }

          if (opts.removeData) {
            await unregisterProject(username, target.id);
            closeDb();
            logger.raw(chalk.green('✓ 已将 Lattice 项目数据移入垃圾桶（含关系与指纹）'));
            logger.raw(
              chalk.dim('  使用 lattice trash list 查看，lattice trash restore <id> 恢复'),
            );
          } else {
            closeDb();
            logger.raw(
              chalk.yellow(
                '⚠ --id 模式下未加 --remove-data，未执行任何操作（lattice.json 不在当前目录，无需解绑）',
              ),
            );
            logger.raw(chalk.dim('  如需删除 Lattice 中的项目数据，请加 --remove-data'));
          }
          return;
        }

        // 分支 B：默认从当前目录 lattice.json 解绑
        const project = await resolveProjectAtDirectory();
        if (!project) {
          logger.raw(chalk.yellow('当前目录不是 Lattice 项目（未找到 lattice.json）'));
          logger.raw(chalk.dim('  提示：可使用 lattice unlink --id <projectId> 直接按 ID 解绑'));
          return;
        }

        const latticeJsonPath = project.latticeJsonPath;
        if (!latticeJsonPath) {
          logger.raw(
            chalk.yellow(
              '当前项目无 lattice.json，无法按目录解绑。可使用 lattice unlink --id <projectId> 直接按 ID 解绑',
            ),
          );
          return;
        }
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

        // 如果 --remove-data，删除 lattice 中的项目数据（含 relations.json / db / 指纹联动）
        if (opts.removeData) {
          const username = await getUsername();
          await initDb();
          await unregisterProject(username, data.id);
          closeDb();
          logger.raw(chalk.green('✓ 已将 Lattice 项目数据移入垃圾桶（含关系与指纹）'));
          logger.raw(chalk.dim('  使用 lattice trash list 查看，lattice trash restore <id> 恢复'));
        } else {
          logger.raw(
            chalk.dim('  Lattice 中的项目数据/关系/指纹仍保留；如需彻底清理请加 --remove-data'),
          );
        }

        logger.raw(chalk.green('✓ 项目已取消 Lattice 注册（已删除 lattice.json）'));
      } catch (err) {
        console.error(chalk.red('取消注册失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
