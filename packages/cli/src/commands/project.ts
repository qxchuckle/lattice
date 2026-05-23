import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import {
  getUsername,
  listProjects,
  findProjectById,
  resolveProjectById,
  getAllUniqueRelations,
  parseProjectRow,
  getProjectMeta,
  updateProjectMeta,
  unregisterProject,
  initDb,
  closeDb,
  getRelationsForProject,
  getTasksForProject,
  upsertRelation,
  deleteRelation,
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
    .option('--with-relations', '附带显示项目关系')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        let projects = listProjects(username, {
          group: opts.group,
          tag: opts.tag,
        });

        // 收集关系信息
        const relationsMap = new Map<
          string,
          {
            project_a: string;
            project_b: string;
            relation_type: string;
            description: string | null;
          }[]
        >();
        if (opts.withRelations) {
          for (const p of projects) {
            relationsMap.set(p.id, getRelationsForProject(p.id));
          }
        }

        closeDb();

        if (opts.json) {
          if (opts.withRelations) {
            const result = projects.map((p) => ({
              ...p,
              relations: relationsMap.get(p.id) ?? [],
            }));
            logger.raw(JSON.stringify(result, null, 2));
          } else {
            logger.raw(JSON.stringify(projects, null, 2));
          }
          return;
        }

        if (projects.length === 0) {
          logger.raw(chalk.dim('暂无已注册项目。使用 lattice link 注册项目。'));
          return;
        }

        logger.raw(chalk.blue(`共 ${projects.length} 个项目：\n`));
        for (const p of projects) {
          const { parsedGroups: groups, parsedTags: tags } = parseProjectRow(p);
          logger.raw(`  ${chalk.bold(p.name)} ${chalk.dim(`(${p.id})`)}`);
          logger.raw(`    ${chalk.dim(p.local_path)}`);
          if (groups.length) logger.raw(`    ${chalk.cyan('分组：')}${groups.join(', ')}`);
          if (tags.length) logger.raw(`    ${chalk.cyan('标签：')}${tags.join(', ')}`);
          if (opts.withRelations) {
            const relations = relationsMap.get(p.id) ?? [];
            if (relations.length > 0) {
              const relStrs = relations.map((r) => {
                const otherId = r.project_a === p.id ? r.project_b : r.project_a;
                const other = projects.find((pp) => pp.id === otherId);
                return `${other?.name ?? otherId}(${r.relation_type})`;
              });
              logger.raw(`    ${chalk.cyan('关系：')}${relStrs.join(', ')}`);
            }
          }
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
          const match = resolveProjectById(username, id);
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
        const match = resolveProjectById(username, id);
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
    .option('-f, --force', '跳过确认')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const projects = listProjects(username);
        const match = resolveProjectById(username, id);
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

  // ─── relation 子命令组 ───
  const relationCmd = cmd.command('relation').description('管理项目间关系');

  // relation list
  relationCmd
    .command('list [id]')
    .alias('ls')
    .description('查看项目关系')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string | undefined, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const projects = listProjects(username);

        if (id) {
          const match = resolveProjectById(username, id);
          if (!match) {
            logger.raw(chalk.yellow(`未找到项目：${id}`));
            closeDb();
            return;
          }

          const relations = getRelationsForProject(match.id);
          closeDb();

          if (opts.json) {
            logger.raw(JSON.stringify(relations, null, 2));
            return;
          }

          if (relations.length === 0) {
            logger.raw(chalk.dim(`项目 ${match.name} 暂无关系。`));
            return;
          }

          logger.raw(
            chalk.blue(`\n项目 ${chalk.bold(match.name)} 的关系（${relations.length} 个）：\n`),
          );
          for (const r of relations) {
            const otherId = r.project_a === match.id ? r.project_b : r.project_a;
            const otherProject = projects.find((p) => p.id === otherId);
            const otherName = otherProject?.name ?? otherId;
            logger.raw(`  ${chalk.bold(otherName)} ${chalk.dim(`(${otherId})`)}`);
            logger.raw(
              `    ${chalk.cyan('类型：')}${r.relation_type}${r.description ? `  ${chalk.dim(r.description)}` : ''}`,
            );
          }
          logger.raw('');
        } else {
          // 列出所有有关系的项目
          const relationRows = getAllUniqueRelations(username);
          closeDb();

          if (opts.json) {
            logger.raw(JSON.stringify(relationRows, null, 2));
            return;
          }

          if (relationRows.length === 0) {
            logger.raw(chalk.dim('暂无项目关系。使用 lattice project relation add 创建。'));
            return;
          }

          logger.raw(chalk.blue(`\n共 ${relationRows.length} 个项目关系：\n`));
          for (const r of relationRows) {
            const nameA = projects.find((p) => p.id === r.project_a)?.name ?? r.project_a;
            const nameB = projects.find((p) => p.id === r.project_b)?.name ?? r.project_b;
            logger.raw(`  ${chalk.bold(nameA)} ↔ ${chalk.bold(nameB)}`);
            logger.raw(
              `    ${chalk.cyan('类型：')}${r.relation_type}${r.description ? `  ${chalk.dim(r.description)}` : ''}`,
            );
          }
          logger.raw('');
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // relation add
  relationCmd
    .command('add <project-a> <project-b>')
    .description('创建项目间关系')
    .option('--type <type>', '关系类型', 'related')
    .option('--description <desc>', '关系描述')
    .action(async (projectA: string, projectB: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const matchA = resolveProjectById(username, projectA);
        const matchB = resolveProjectById(username, projectB);

        if (!matchA) {
          logger.raw(chalk.yellow(`未找到项目 A：${projectA}`));
          closeDb();
          return;
        }
        if (!matchB) {
          logger.raw(chalk.yellow(`未找到项目 B：${projectB}`));
          closeDb();
          return;
        }
        if (matchA.id === matchB.id) {
          logger.raw(chalk.yellow('不能创建项目与自身的关系'));
          closeDb();
          return;
        }

        upsertRelation({
          project_a: matchA.id,
          project_b: matchB.id,
          relation_type: opts.type as string,
          description: (opts.description as string) ?? null,
        });
        closeDb();

        logger.raw(chalk.green(`✓ 已创建关系：${matchA.name} ↔ ${matchB.name}`));
        logger.raw(chalk.dim(`  类型：${opts.type}`));
        if (opts.description) logger.raw(chalk.dim(`  描述：${opts.description}`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // relation remove
  relationCmd
    .command('remove <project-a> <project-b>')
    .alias('rm')
    .description('删除项目间关系')
    .option('-f, --force', '跳过确认')
    .action(async (projectA: string, projectB: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const matchA = resolveProjectById(username, projectA);
        const matchB = resolveProjectById(username, projectB);

        if (!matchA) {
          logger.raw(chalk.yellow(`未找到项目 A：${projectA}`));
          closeDb();
          return;
        }
        if (!matchB) {
          logger.raw(chalk.yellow(`未找到项目 B：${projectB}`));
          closeDb();
          return;
        }

        if (!shouldSkipConfirm(opts)) {
          const confirmed = await confirm({
            message: `确认删除 ${matchA.name} 与 ${matchB.name} 之间的关系？`,
            default: false,
          });
          if (!confirmed) {
            logger.raw(chalk.dim('已取消'));
            closeDb();
            return;
          }
        }

        const deleted = deleteRelation(matchA.id, matchB.id);
        closeDb();

        if (deleted) {
          logger.raw(chalk.green(`✓ 已删除关系：${matchA.name} ↔ ${matchB.name}`));
        } else {
          logger.raw(chalk.yellow(`未找到 ${matchA.name} 与 ${matchB.name} 之间的关系`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
