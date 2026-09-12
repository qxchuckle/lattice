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
import {
  logger,
  shouldSkipConfirm,
  outputJson,
  paginate,
  paginationEntries,
  paginationNote,
  projectTable,
  withPaginationOptions,
} from '../utils';

export function registerUserCommand(program: Command): void {
  const cmd = program.command('user').description('管理 Lattice 用户');

  // list
  withPaginationOptions(cmd.command('list').alias('ls').description('列出所有用户'))
    .option('--json', 'JSON 格式输出')
    .option(
      '--json-full',
      'JSON 输出原始对象数组（不做列式/压缩；默认 --json 为列式表 {cols,rows}）',
    )
    .action(async (opts) => {
      try {
        const currentUser = await getUsername();
        const users = await listUserDirs();

        const items = users.map((u) => ({ name: u, current: u === currentUser }));

        if (opts.json) {
          outputJson(projectTable(items, opts), opts.jsonFormat);
          return;
        }

        if (users.length === 0) {
          logger.raw(chalk.dim('暂无用户'));
          return;
        }

        const paged = paginate(items, opts);
        logger.raw(chalk.blue(`${paginationNote(paged) ?? `共 ${users.length} 个用户`}：\n`));
        for (const item of paginationEntries(paged)) {
          logger.raw(
            `  ${item.current ? chalk.green('→') : ' '} ${item.current ? chalk.bold(item.name) : item.name}`,
          );
        }
        logger.raw('');
      } catch (err) {
        logger.stderr(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // current
  cmd
    .command('current')
    .description('显示当前用户名')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        // 人读输出裸值（供 shell 直接捕获）；--json 输出合法 JSON 字符串，避免消费方 JSON.parse 失败
        if (opts.json) {
          outputJson(username, opts.jsonFormat);
          return;
        }
        logger.raw(username);
      } catch (err) {
        logger.stderr(chalk.red('错误：'), (err as Error).message);
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
        logger.stderr(chalk.red('错误：'), (err as Error).message);
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
        logger.stderr(chalk.red('错误：'), (err as Error).message);
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
        logger.stderr(chalk.red('错误：'), (err as Error).message);
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
        logger.stderr(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
