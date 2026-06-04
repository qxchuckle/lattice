import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  initDb,
  closeDb,
  getContextForProject,
  getSmartContext,
  formatContextAsMarkdown,
  findProjectById,
  getProjectMeta,
  type ContextOptions,
  type AncestorProjectInfo,
} from '@qcqx/lattice-core';
import {
  logger,
  outputJson,
  resolveCurrentProject,
  resolveCurrentProjectWithAncestors,
} from '../utils';

export function registerContextCommand(program: Command): void {
  program
    .command('context')
    .description('输出当前项目的聚合上下文')
    .option('--task <id>', '指定任务 ID')
    .option('--project <id>', '指定项目 ID')
    .option('--current-user', '仅显示当前用户数据，禁用跨用户聚合')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const contextOpts: ContextOptions = {
          crossUser: !opts.currentUser,
        };

        if (opts.task) {
          // 任务关联上下文
          const ctx = await getSmartContext(username, opts.task, contextOpts);
          closeDb();

          if (opts.json) {
            outputJson(ctx, opts.jsonFormat);
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

          if (ctx.semanticSpecs.length > 0) {
            logger.raw(chalk.green(`语义关联 Spec（${ctx.semanticSpecs.length}）：`));
            for (const s of ctx.semanticSpecs) {
              const title = s.frontmatter.title ?? s.fileName;
              logger.raw(`  ${title}`);
              logger.raw(chalk.dim(`  ${s.content.slice(0, 200)}...`));
              logger.raw('');
            }
          }

          // 跨用户聚合数据
          if (ctx.crossUserData && ctx.crossUserData.length > 0) {
            logger.raw(chalk.magenta.bold(`\n跨用户聚合：`));
            for (const userData of ctx.crossUserData) {
              logger.raw(chalk.magenta(`\n  来源用户：${userData.username}`));

              if (userData.directSpecs.length > 0) {
                logger.raw(chalk.blue(`  项目级 Spec（${userData.directSpecs.length}）：`));
                for (const s of userData.directSpecs) {
                  logger.raw(`    ${s.frontmatter.title ?? s.fileName}`);
                }
              }

              if (userData.activeTasks.length > 0) {
                logger.raw(chalk.blue(`  活跃任务（${userData.activeTasks.length}）：`));
                for (const t of userData.activeTasks) {
                  logger.raw(`    ${t.title} (${t.status}) — ${t.id}`);
                }
              }
            }
            logger.raw('');
          }

          return;
        }

        // 项目上下文
        let projectId = opts.project as string | undefined;
        let ancestors: AncestorProjectInfo[] | undefined;

        if (!projectId) {
          // 解析当前项目及祖先
          const resolved = await resolveCurrentProjectWithAncestors();
          if (!resolved) {
            logger.raw(chalk.yellow('当前目录不是 Lattice 项目。请指定 --project 或 --task'));
            closeDb();
            return;
          }
          projectId = resolved.current.id;

          // 构建祖先信息
          if (resolved.ancestors.length > 0) {
            ancestors = [];
            for (const a of resolved.ancestors) {
              const meta = await getProjectMeta(username, a.id);
              ancestors.push({
                id: a.id,
                name: meta?.name ?? undefined,
                root: a.root,
              });
            }
          }
        }

        if (!projectId) {
          logger.raw(chalk.yellow('无法确定项目 ID'));
          closeDb();
          return;
        }

        // 绑定丢失自检：db 中不存在该项目时给出修复建议
        const dbRow = findProjectById(projectId);
        if (!dbRow) {
          closeDb();
          logger.raw(
            chalk.yellow(
              `⚠ 未在 Lattice 中找到项目 ${projectId.slice(0, 8)}… （lattice.json 指向的 id 不存在）`,
            ),
          );
          logger.raw(
            chalk.dim(
              '  修复建议：\n    1) lattice link --restore <id>  恢复绑定\n    2) lattice link              走指纹识别选单\n    3) lattice link --force-new   强制创建新项目',
            ),
          );
          process.exitCode = 1;
          return;
        }

        // 传入祖先信息用于 spec 级联继承
        if (ancestors && ancestors.length > 0) {
          contextOpts.ancestorProjectIds = ancestors.map((a) => a.id);
          contextOpts.ancestors = ancestors;
        }

        const ctx = await getContextForProject(username, projectId, contextOpts);
        closeDb();

        if (opts.json) {
          outputJson(ctx, opts.jsonFormat);
          return;
        }

        logger.raw(formatContextAsMarkdown(ctx));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
