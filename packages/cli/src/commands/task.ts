import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  initDb,
  closeDb,
  createTask,
  listTasks,
  getTaskMeta,
  updateTask,
  archiveTask,
  deleteTask,
  getTaskPrd,
} from '@qcqx/lattice-core';
import type { TaskMeta, TaskStatus } from '@qcqx/lattice-core';
import { logger, resolveCurrentProject } from '../utils';

const TASK_STATUSES: TaskStatus[] = ['planning', 'in_progress', 'completed', 'archived'];

async function resolveCurrentProjectId(): Promise<string | null> {
  return (await resolveCurrentProject())?.id ?? null;
}

async function resolveTaskById(username: string, input: string): Promise<TaskMeta | null> {
  const tasks = await listTasks(username);
  return (
    tasks.find((task) => task.id === input) ??
    tasks.find((task) => task.id.startsWith(input)) ??
    null
  );
}

function normalizeProjectIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function registerTaskCommand(program: Command): void {
  const cmd = program.command('task').description('管理跨项目任务');

  // list
  cmd
    .command('list')
    .alias('ls')
    .description('列出任务')
    .option('--status <status>', '按状态过滤（planning / in_progress / completed / archived）')
    .option('--project <id>', '按项目 ID 过滤')
    .option('--current', '自动识别当前目录对应的项目')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        let projectId = opts.project as string | undefined;
        if (opts.current) {
          projectId = (await resolveCurrentProjectId()) ?? undefined;
          if (!projectId) {
            logger.raw(chalk.yellow('当前目录不是 Lattice 项目'));
            closeDb();
            return;
          }
        }

        const tasks = await listTasks(username, {
          status: opts.status as TaskStatus | undefined,
          projectId,
        });

        closeDb();

        if (opts.json) {
          logger.raw(JSON.stringify(tasks, null, 2));
          return;
        }

        if (tasks.length === 0) {
          logger.raw(chalk.dim('暂无任务。使用 lattice task create 创建任务。'));
          return;
        }

        logger.raw(chalk.blue(`共 ${tasks.length} 个任务：\n`));

        const statusIcon: Record<string, string> = {
          planning: '📋',
          in_progress: '🔨',
          completed: '✅',
          archived: '📦',
        };

        for (const t of tasks) {
          const icon = statusIcon[t.status] ?? '•';
          logger.raw(`  ${icon} ${chalk.bold(t.title)} ${chalk.dim(`[${t.status}]`)}`);
          logger.raw(`    ${chalk.dim(t.id)}`);
          if (t.projects?.length) {
            logger.raw(`    ${chalk.dim(`关联项目：${t.projects.length} 个`)}`);
          }
          logger.raw('');
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // create
  cmd
    .command('create <title>')
    .description('创建任务')
    .option('-p, --project <ids...>', '关联项目 ID')
    .option('--current', '关联当前目录对应的项目')
    .action(async (title: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const projects: string[] = opts.project ? [...opts.project] : [];

        if (opts.current) {
          const pid = await resolveCurrentProjectId();
          if (pid && !projects.includes(pid)) projects.push(pid);
        }

        const task = await createTask(username, title, {
          projects: projects.length > 0 ? projects : undefined,
        });

        closeDb();

        logger.raw(chalk.green('✓ 任务已创建'));
        logger.raw(chalk.dim(`  ID：${task.id}`));
        logger.raw(chalk.dim(`  标题：${task.title}`));
        if (task.projects?.length) {
          logger.raw(chalk.dim(`  关联项目：${task.projects.join(', ')}`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // info
  cmd
    .command('info <id>')
    .description('查看任务详情')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        const meta = await getTaskMeta(username, id);

        if (!meta) {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
          return;
        }

        const prd = await getTaskPrd(username, id);

        if (opts.json) {
          logger.raw(JSON.stringify({ meta, prd }, null, 2));
          return;
        }

        logger.raw(chalk.bold(`\n${meta.title}`));
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(`  ID：${meta.id}`);
        logger.raw(`  状态：${meta.status}`);
        if (meta.projects?.length) {
          logger.raw(`  关联项目：${meta.projects.join(', ')}`);
        }
        logger.raw(`  创建：${meta.created}`);
        if (meta.updated) logger.raw(`  更新：${meta.updated}`);

        if (prd) {
          logger.raw(chalk.dim('\n─── PRD ───'));
          logger.raw(prd);
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // update
  cmd
    .command('update <id>')
    .description('更新任务元数据')
    .option('--title <title>', '任务标题')
    .option('--status <status>', '任务状态（planning / in_progress / completed / archived）')
    .option('-p, --project <ids...>', '覆盖关联项目 ID 列表')
    .option('--add-project <ids...>', '追加关联项目 ID')
    .option('--remove-project <ids...>', '移除关联项目 ID')
    .option('--clear-projects', '清空关联项目')
    .option('--add-current-project', '将当前目录对应项目加入关联项目')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const match = await resolveTaskById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
          closeDb();
          return;
        }

        const updates: Partial<TaskMeta> = {};

        if (typeof opts.title === 'string') {
          const title = opts.title.trim();
          if (!title) {
            logger.raw(chalk.yellow('任务标题不能为空'));
            closeDb();
            return;
          }
          updates.title = title;
        }

        if (opts.status) {
          if (!TASK_STATUSES.includes(opts.status as TaskStatus)) {
            logger.raw(chalk.yellow(`无效状态：${opts.status}`));
            logger.raw(chalk.dim(`可选值：${TASK_STATUSES.join(' / ')}`));
            closeDb();
            return;
          }
          updates.status = opts.status as TaskStatus;
        }

        const shouldUpdateProjects = Boolean(
          opts.project ||
          opts.addProject ||
          opts.removeProject ||
          opts.clearProjects ||
          opts.addCurrentProject,
        );

        if (shouldUpdateProjects) {
          let projects = opts.clearProjects
            ? []
            : opts.project
              ? normalizeProjectIds([...opts.project])
              : [...(match.projects ?? [])];

          if (opts.addProject) {
            projects.push(...opts.addProject);
          }

          if (opts.addCurrentProject) {
            const pid = await resolveCurrentProjectId();
            if (!pid) {
              logger.raw(chalk.yellow('当前目录不是 Lattice 项目'));
              closeDb();
              return;
            }
            projects.push(pid);
          }

          projects = normalizeProjectIds(projects);

          if (opts.removeProject) {
            const removeSet = new Set(normalizeProjectIds([...opts.removeProject]));
            projects = projects.filter((pid) => !removeSet.has(pid));
          }

          updates.projects = projects;
        }

        if (Object.keys(updates).length === 0) {
          logger.raw(chalk.yellow('没有可更新的字段'));
          closeDb();
          return;
        }

        const updated = await updateTask(username, match.id, updates);
        closeDb();

        if (!updated) {
          logger.raw(chalk.yellow('更新失败'));
          return;
        }

        logger.raw(chalk.green(`✓ 任务 ${updated.title} 已更新`));
        logger.raw(chalk.dim(`  ID：${updated.id}`));
        logger.raw(chalk.dim(`  状态：${updated.status}`));
        logger.raw(
          chalk.dim(`  关联项目：${updated.projects?.length ? updated.projects.join(', ') : '无'}`),
        );
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // start
  cmd
    .command('start <id>')
    .description('将任务状态设为 in_progress')
    .action(async (id: string) => {
      try {
        const username = await getUsername();
        await initDb();
        const updated = await updateTask(username, id, { status: 'in_progress' });
        closeDb();
        if (updated) {
          logger.raw(chalk.green(`✓ 任务 ${updated.title} 已开始`));
        } else {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // complete
  cmd
    .command('complete <id>')
    .description('将任务状态设为 completed')
    .action(async (id: string) => {
      try {
        const username = await getUsername();
        await initDb();
        const updated = await updateTask(username, id, { status: 'completed' });
        closeDb();
        if (updated) {
          logger.raw(chalk.green(`✓ 任务 ${updated.title} 已完成`));
        } else {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // archive
  cmd
    .command('archive <id>')
    .description('归档任务')
    .action(async (id: string) => {
      try {
        const username = await getUsername();
        await initDb();
        const updated = await archiveTask(username, id);
        closeDb();
        if (updated) {
          logger.raw(chalk.green(`✓ 任务 ${updated.title} 已归档`));
        } else {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // reopen
  cmd
    .command('reopen <id>')
    .description('重新打开任务并设为 in_progress')
    .action(async (id: string) => {
      try {
        const username = await getUsername();
        await initDb();
        const updated = await updateTask(username, id, { status: 'in_progress' });
        closeDb();
        if (updated) {
          logger.raw(chalk.green(`✓ 任务 ${updated.title} 已重新打开`));
        } else {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
