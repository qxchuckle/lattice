import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import {
  getUsername,
  listProjects,
  findProjectById,
  getProjectMeta,
  updateProjectMeta,
  unregisterProject,
  initDb,
  closeDb,
  getRelationsForProject,
  getTasksForProject,
} from '@qcqx/lattice-core';
import { logger, shouldSkipConfirm } from '../utils';

export function registerProjectCommand(program: Command): void {
  const cmd = program.command('project').description('管理已注册的项目');

  // list
  cmd
    .command('list')
    .alias('ls')
    .description('列出所有已注册项目')
    .option('--group <group>', '按分组过滤')
    .option('--tag <tag>', '按标签过滤')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        let projects = listProjects(username);

        if (opts.group) {
          projects = projects.filter((p) => {
            const groups = p.groups ? JSON.parse(p.groups) : [];
            return groups.includes(opts.group);
          });
        }

        if (opts.tag) {
          projects = projects.filter((p) => {
            const tags = p.tags ? JSON.parse(p.tags) : [];
            return tags.includes(opts.tag);
          });
        }

        closeDb();

        if (opts.json) {
          logger.raw(JSON.stringify(projects, null, 2));
          return;
        }

        if (projects.length === 0) {
          logger.raw(chalk.dim('暂无已注册项目。使用 lattice link 注册项目。'));
          return;
        }

        logger.raw(chalk.blue(`共 ${projects.length} 个项目：\n`));
        for (const p of projects) {
          const groups = p.groups ? JSON.parse(p.groups) : [];
          const tags = p.tags ? JSON.parse(p.tags) : [];
          logger.raw(`  ${chalk.bold(p.name)} ${chalk.dim(`(${p.id})`)}`);
          logger.raw(`    ${chalk.dim(p.local_path)}`);
          if (groups.length) logger.raw(`    ${chalk.cyan('分组：')}${groups.join(', ')}`);
          if (tags.length) logger.raw(`    ${chalk.cyan('标签：')}${tags.join(', ')}`);
          logger.raw('');
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // info
  cmd
    .command('info <id>')
    .description('查看项目详情')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const row = findProjectById(id);
        if (!row) {
          // 尝试前缀匹配
          const projects = listProjects(username);
          const match = projects.find((p) => p.id.startsWith(id));
          if (!match) {
            logger.raw(chalk.yellow(`未找到项目：${id}`));
            closeDb();
            return;
          }
          id = match.id;
        }

        const meta = await getProjectMeta(username, id);
        const relations = getRelationsForProject(id);
        const taskIds = getTasksForProject(id);

        closeDb();

        if (opts.json) {
          logger.raw(JSON.stringify({ meta, relations, taskIds }, null, 2));
          return;
        }

        if (!meta) {
          logger.raw(chalk.yellow('项目元数据不存在'));
          return;
        }

        logger.raw(chalk.bold(`\n${meta.name}`));
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(`  ID：${meta.id}`);
        logger.raw(`  路径：${meta.localPath}`);
        if (meta.description) logger.raw(`  描述：${meta.description}`);
        if (meta.gitRemote) logger.raw(`  Git：${meta.gitRemote}`);
        if (meta.groups?.length) logger.raw(`  分组：${meta.groups.join(', ')}`);
        if (meta.tags?.length) logger.raw(`  标签：${meta.tags.join(', ')}`);
        logger.raw(`  创建：${meta.created}`);
        if (meta.updated) logger.raw(`  更新：${meta.updated}`);
        if (taskIds.length) logger.raw(`  关联任务：${taskIds.length} 个`);
        if (relations.length) logger.raw(`  项目关系：${relations.length} 个`);
        logger.raw('');
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // update
  cmd
    .command('update <id>')
    .description('更新项目元数据')
    .option('--name <name>', '项目名称')
    .option('--description <desc>', '项目描述')
    .option('--groups <groups>', '项目分组（逗号分隔）')
    .option('--tags <tags>', '标签（逗号分隔）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        // 前缀匹配
        const projects = listProjects(username);
        const match = projects.find((p) => p.id.startsWith(id));
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }

        const updates: Record<string, unknown> = {};
        if (opts.name) updates.name = opts.name;
        if (opts.description) updates.description = opts.description;
        if (opts.groups)
          updates.groups = (opts.groups as string).split(',').map((s: string) => s.trim());
        if (opts.tags) updates.tags = (opts.tags as string).split(',').map((s: string) => s.trim());

        const updated = await updateProjectMeta(username, match.id, updates);
        closeDb();

        if (updated) {
          logger.raw(chalk.green(`✓ 项目 ${updated.name} 已更新`));
        } else {
          logger.raw(chalk.yellow('更新失败'));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // remove
  cmd
    .command('remove <id>')
    .alias('rm')
    .description('删除项目数据')
    .option('-f, --fore', '跳过确认')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const projects = listProjects(username);
        const match = projects.find((p) => p.id.startsWith(id));
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }

        if (!shouldSkipConfirm(opts)) {
          const confirmed = await confirm({
            message: `确认删除项目 ${match.name}（${match.id}）的所有数据？`,
            default: false,
          });
          if (!confirmed) {
            logger.raw(chalk.dim('已取消'));
            closeDb();
            return;
          }
        }

        await unregisterProject(username, match.id);
        closeDb();

        logger.raw(chalk.green(`✓ 项目 ${match.name} 已删除`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
