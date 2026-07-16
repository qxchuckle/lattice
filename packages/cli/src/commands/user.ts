import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import {
  getUsername,
  readLocalConfig,
  writeLocalConfig,
  getUserDir,
  getUserSpecDir,
  getUserProjectsDir,
  getUserTasksDir,
  ensureDir,
  listUserDirs,
  dirExists,
  removeDir,
  renameUser,
  initDb,
  closeDb,
} from '@qcqx/lattice-core';
import { logger, shouldSkipConfirm } from '../utils';

export function registerUserCommand(program: Command): void {
  const cmd = program.command('user').description('管理 Lattice 用户');

  // list
  cmd
    .command('list')
    .alias('ls')
    .description('列出所有用户')
    .action(async () => {
      try {
        const currentUser = await getUsername();
        const users = await listUserDirs();

        if (users.length === 0) {
          logger.raw(chalk.dim('暂无用户'));
          return;
        }

        logger.raw(chalk.blue(`共 ${users.length} 个用户：\n`));
        for (const u of users) {
          const isCurrent = u === currentUser;
          logger.raw(`  ${isCurrent ? chalk.green('→') : ' '} ${isCurrent ? chalk.bold(u) : u}`);
        }
        logger.raw('');
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // current
  cmd
    .command('current')
    .description('显示当前用户名')
    .action(async () => {
      try {
        const username = await getUsername();
        logger.raw(username);
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // switch
  cmd
    .command('switch <name>')
    .description('切换当前用户')
    .action(async (name: string) => {
      try {
        if (!(await dirExists(getUserDir(name)))) {
          logger.raw(chalk.yellow(`用户 ${name} 不存在。使用 lattice user create 创建。`));
          return;
        }

        const config = await readLocalConfig();
        if (config) {
          await writeLocalConfig({ ...config, username: name });
          logger.raw(chalk.green(`✓ 已切换到用户 ${name}`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // create
  cmd
    .command('create <name>')
    .description('新建用户')
    .action(async (name: string) => {
      try {
        if (await dirExists(getUserDir(name))) {
          logger.raw(chalk.yellow(`用户 ${name} 已存在`));
          return;
        }

        await ensureDir(getUserDir(name));
        await ensureDir(getUserSpecDir(name));
        await ensureDir(getUserProjectsDir(name));
        await ensureDir(getUserTasksDir(name));

        logger.raw(chalk.green(`✓ 用户 ${name} 已创建`));
        logger.raw(chalk.dim(`使用 lattice user switch ${name} 切换到该用户`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // rename
  cmd
    .command('rename <oldName> <newName>')
    .description('重命名用户（含数据库和文件系统）')
    .option('-f, --force', '跳过确认')
    .action(async (oldName: string, newName: string, opts) => {
      try {
        if (!shouldSkipConfirm(opts)) {
          const confirmed = await confirm({
            message: `确认将用户 ${oldName} 重命名为 ${newName}？将更新数据库和文件系统。`,
            default: false,
          });
          if (!confirmed) {
            logger.raw(chalk.dim('已取消'));
            return;
          }
        }

        await initDb();
        await renameUser(oldName, newName);
        closeDb();

        logger.raw(chalk.green(`✓ 用户 ${oldName} 已重命名为 ${newName}`));
        logger.raw(chalk.dim('数据库中的 username 字段已同步更新'));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      } finally {
        closeDb();
      }
    });

  // remove
  cmd
    .command('remove <name>')
    .alias('rm')
    .description('删除用户')
    .option('-f, --force', '跳过确认')
    .action(async (name: string, opts) => {
      try {
        const currentUser = await getUsername();
        if (name === currentUser) {
          logger.raw(chalk.yellow('不能删除当前活跃用户。请先切换到其他用户。'));
          return;
        }

        if (!(await dirExists(getUserDir(name)))) {
          logger.raw(chalk.yellow(`用户 ${name} 不存在`));
          return;
        }

        if (!shouldSkipConfirm(opts)) {
          const confirmed = await confirm({
            message: `确认删除用户 ${name} 及其所有数据？`,
            default: false,
          });
          if (!confirmed) {
            logger.raw(chalk.dim('已取消'));
            return;
          }
        }

        await removeDir(getUserDir(name));
        logger.raw(chalk.green(`✓ 用户 ${name} 已删除`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
