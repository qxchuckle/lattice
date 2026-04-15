import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  initDb,
  closeDb,
  getContextForProject,
  getSmartContext,
  formatContextAsMarkdown,
} from '@qcqx/lattice-core';
import { logger, resolveCurrentProject } from '../utils';

export function registerContextCommand(program: Command): void {
  program
    .command('context')
    .description('输出当前项目的聚合上下文')
    .option('--task <id>', '指定任务 ID')
    .option('--project <id>', '指定项目 ID')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        if (opts.task) {
          // 任务关联上下文
          const ctx = await getSmartContext(username, opts.task);
          closeDb();

          if (opts.json) {
            logger.raw(JSON.stringify(ctx, null, 2));
            return;
          }

          logger.raw(chalk.bold(`\n任务上下文：${ctx.task.title}\n`));

          if (ctx.directSpecs.length > 0) {
            logger.raw(chalk.blue(`直接关联 Spec（${ctx.directSpecs.length}）：`));
            for (const s of ctx.directSpecs) {
              const title = s.frontmatter.title ?? s.fileName;
              logger.raw(`  ${title}`);
              logger.raw(chalk.dim(`  ${s.content.slice(0, 200)}...`));
              logger.raw('');
            }
          }

          if (ctx.relatedSpecs.length > 0) {
            logger.raw(chalk.blue(`同组项目 Spec（${ctx.relatedSpecs.length}）：`));
            for (const s of ctx.relatedSpecs) {
              logger.raw(`  ${s.frontmatter.title ?? s.fileName}`);
            }
            logger.raw('');
          }

          return;
        }

        // 项目上下文
        let projectId = opts.project as string | undefined;
        if (!projectId) {
          const project = await resolveCurrentProject();
          if (!project) {
            logger.raw(chalk.yellow('当前目录不是 Lattice 项目。请指定 --project 或 --task'));
            closeDb();
            return;
          }
          projectId = project.id;
        }

        if (!projectId) {
          logger.raw(chalk.yellow('无法确定项目 ID'));
          closeDb();
          return;
        }

        const ctx = await getContextForProject(username, projectId);
        closeDb();

        if (opts.json) {
          logger.raw(JSON.stringify(ctx, null, 2));
          return;
        }

        logger.raw(formatContextAsMarkdown(ctx));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
