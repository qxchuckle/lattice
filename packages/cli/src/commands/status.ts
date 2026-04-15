import { Command } from 'commander';
import chalk from 'chalk';
import { statSync } from 'node:fs';
import {
  getUsername,
  initDb,
  closeDb,
  isInitialized,
  readResolvedConfig,
  listProjects,
  listTasks,
  getProjectMeta,
  getProjectSpecs,
  getDbPath,
  getTasksForProject,
  getTaskMeta,
} from '@qcqx/lattice-core';
import { logger, resolveCurrentProject } from '../utils';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('显示 Lattice 状态')
    .option('--global', '显示全局状态')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        if (!(await isInitialized())) {
          logger.raw(chalk.yellow('Lattice 未初始化。请先运行 lattice init'));
          return;
        }

        const username = await getUsername();
        await initDb();

        if (opts.global) {
          await showGlobalStatus(username, opts.json);
        } else {
          await showProjectStatus(username, opts.json);
        }

        closeDb();
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

async function showGlobalStatus(username: string, json: boolean): Promise<void> {
  const config = await readResolvedConfig();
  const projects = listProjects(username);
  const tasks = await listTasks(username);
  const activeTasks = tasks.filter((t) => t.status === 'in_progress' || t.status === 'planning');

  let dbSize = 0;
  try {
    dbSize = statSync(getDbPath()).size;
  } catch {
    // 数据库文件可能不存在
  }

  const status = {
    username,
    projects: projects.length,
    tasks: tasks.length,
    activeTasks: activeTasks.length,
    dbSizeKB: Math.round(dbSize / 1024),
    scanDirs: config?.scanDirs ?? [],
    gitEnabled: config?.gitEnabled ?? false,
  };

  if (json) {
    logger.raw(JSON.stringify(status, null, 2));
    return;
  }

  logger.raw(chalk.bold('\nLattice 全局状态\n'));
  logger.raw(`  用户名：${chalk.cyan(username)}`);
  logger.raw(`  项目数：${projects.length}`);
  logger.raw(`  任务数：${tasks.length}（活跃 ${activeTasks.length}）`);
  logger.raw(`  数据库：${status.dbSizeKB} KB`);
  logger.raw(`  Git：${status.gitEnabled ? '已启用' : '未启用'}`);
  if (status.scanDirs.length) {
    logger.raw(`  扫描目录：${status.scanDirs.join(', ')}`);
  }
  logger.raw('');
}

async function showProjectStatus(username: string, json: boolean): Promise<void> {
  const project = await resolveCurrentProject();
  if (!project) {
    logger.raw(chalk.yellow('当前目录不是 Lattice 项目。使用 --global 查看全局状态。'));
    return;
  }

  const meta = await getProjectMeta(username, project.id);
  if (!meta) {
    logger.raw(chalk.yellow('项目元数据不存在，可能需要重新 scan'));
    return;
  }

  const specs = await getProjectSpecs(username, project.id);

  let activeTasks: Awaited<ReturnType<typeof getTaskMeta>>[] = [];
  try {
    const taskIds = getTasksForProject(project.id);
    const allTasks = await Promise.all(taskIds.map((id) => getTaskMeta(username, id)));
    activeTasks = allTasks.filter(
      (t) => t !== null && t.status !== 'archived' && t.status !== 'completed',
    );
  } catch {
    // 忽略
  }

  const status = { meta, specs: specs.map((s) => s.fileName), activeTasks };

  if (json) {
    logger.raw(JSON.stringify(status, null, 2));
    return;
  }

  logger.raw(chalk.bold(`\n${meta.name}\n`));
  logger.raw(`  ID：${meta.id}`);
  logger.raw(`  路径：${meta.localPath}`);
  if (meta.description) logger.raw(`  描述：${meta.description}`);
  if (meta.groups?.length) logger.raw(`  分组：${meta.groups.join(', ')}`);
  if (meta.tags?.length) logger.raw(`  标签：${meta.tags.join(', ')}`);

  if (specs.length > 0) {
    logger.raw(chalk.blue(`\n  Spec 文件（${specs.length}）：`));
    for (const s of specs) {
      const title = s.frontmatter.title ?? s.fileName.replace('.md', '');
      logger.raw(`    ${title} ${chalk.dim(`(${s.fileName})`)}`);
    }
  }

  if (activeTasks.length > 0) {
    logger.raw(chalk.blue(`\n  活跃任务（${activeTasks.length}）：`));
    for (const t of activeTasks) {
      if (t) logger.raw(`    ${t.title} ${chalk.dim(`[${t.status}]`)}`);
    }
  }

  logger.raw('');
}
