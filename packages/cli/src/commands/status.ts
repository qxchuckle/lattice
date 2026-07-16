import { Command } from 'commander';
import chalk from 'chalk';
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
  getLatticeRoot,
  getTasksForProject,
  getTaskMeta,
  findProjectById,
  dirExists,
  findAllUpwards,
  readJSON,
  getGlobalStatus,
  openLatticeRoot,
} from '@qcqx/lattice-core';
import { logger, outputJson, resolveCurrentProject } from '../utils';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('显示 Lattice 状态')
    .option('--global', '显示全局状态')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        if (!(await isInitialized())) {
          logger.raw(chalk.yellow('Lattice 未初始化。请先运行 lattice init'));
          return;
        }

        const username = await getUsername();
        await initDb();

        if (opts.global) {
          await showGlobalStatus(username, opts.json, opts.jsonFormat);
        } else {
          await showProjectStatus(username, opts.json, opts.jsonFormat);
        }

        closeDb();
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

async function showGlobalStatus(
  _username: string,
  json: boolean,
  jsonFormat?: boolean,
): Promise<void> {
  const status = await getGlobalStatus();
  if (!status) {
    logger.raw(chalk.yellow('Lattice 未初始化'));
    return;
  }

  if (json) {
    outputJson(status, jsonFormat);
    return;
  }

  logger.raw(chalk.bold('\nLattice 全局状态\n'));
  logger.raw(`  根目录：${chalk.cyan(status.latticeRoot)}`);
  logger.raw(`  用户名：${chalk.cyan(status.username)}`);
  logger.raw(`  项目数：${status.projectCount}`);
  logger.raw(`  任务数：${status.taskCount}（活跃 ${status.activeTaskCount}）`);
  logger.raw(`  数据库：${status.dbSizeKB} KB`);
  logger.raw(`  Git：${status.gitEnabled ? '已启用' : '未启用'}`);
  if (status.scanDirs.length) {
    logger.raw(`  扫描目录：${status.scanDirs.join(', ')}`);
  }
  logger.raw('');
}

/** 打开 Lattice 根目录 */
export function registerOpenCommand(program: Command): void {
  program
    .command('open')
    .description('打开 Lattice 根目录')
    .option('-t, --terminal', '在终端中打开（而非文件管理器）')
    .action(async (opts) => {
      const mode = opts.terminal ? 'terminal' : 'finder';
      const result = await openLatticeRoot(mode);
      if (result.success) {
        logger.raw(chalk.green(result.message));
      } else {
        logger.raw(chalk.red(result.message));
        process.exitCode = 1;
      }
    });
}
async function showProjectStatus(
  username: string,
  json: boolean,
  jsonFormat?: boolean,
): Promise<void> {
  const project = await resolveCurrentProject();
  if (!project) {
    logger.raw(chalk.yellow('当前目录不是 Lattice 项目。使用 --global 查看全局状态。'));
    return;
  }

  // 检查绑定状态：db 中是否存在该 id
  const dbRow = findProjectById(project.id);
  if (!dbRow) {
    logger.raw(
      chalk.yellow(
        `⚠ 当前 lattice.json 指向项目 ${project.id.slice(0, 8)}…，但 Lattice 中未找到对应项目`,
      ),
    );
    logger.raw(
      chalk.dim(
        '  修复建议：\n    1) lattice link --restore <id>  恢复绑定\n    2) lattice link              走指纹识别选单\n    3) lattice link --force-new   强制创建新项目',
      ),
    );
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

  // 收集路径存在性检测
  const pathStatus: { path: string; exists: boolean }[] = [];
  for (const p of meta.localPaths ?? []) {
    pathStatus.push({ path: p, exists: await dirExists(p) });
  }

  // 检测嵌套祖先项目
  const ancestorInfo: { id: string; name: string; root: string }[] = [];
  try {
    const ancestorRoots = await findAllUpwards('lattice.json', project.root);
    for (const aRoot of ancestorRoots) {
      const data = await readJSON<{ id?: string }>(`${aRoot}/lattice.json`);
      if (!data?.id || data.id === project.id) continue;
      const parentRow = findProjectById(data.id);
      if (!parentRow) continue;
      ancestorInfo.push({ id: data.id, name: parentRow.name, root: aRoot });
    }
  } catch {
    // 不影响主流程
  }

  const status = {
    meta,
    specs: specs.map((s) => s.fileName),
    activeTasks,
    binding: { current: project.root, pathStatus },
    ...(ancestorInfo.length > 0 ? { ancestors: ancestorInfo } : {}),
  };

  if (json) {
    outputJson(status, jsonFormat);
    return;
  }

  logger.raw(chalk.bold(`\n${meta.name}\n`));
  logger.raw(`  ID：${meta.id}`);
  logger.raw(`  当前绑定路径：${project.root}`);
  if (pathStatus.length > 1) {
    logger.raw(chalk.cyan(`  所有路径（${pathStatus.length}）：`));
    for (const ps of pathStatus) {
      logger.raw(`    ${ps.exists ? chalk.green('●') : chalk.red('○')} ${ps.path}`);
    }
  } else if (pathStatus.length === 1) {
    const ps = pathStatus[0];
    logger.raw(`  路径状态：${ps.exists ? chalk.green('存在') : chalk.red('已失效')}`);
  }
  if (meta.description) logger.raw(`  描述：${meta.description}`);
  if (meta.gitRemotes?.length) logger.raw(`  Git remote：${meta.gitRemotes.join(', ')}`);
  if (meta.packageNames?.length) logger.raw(`  Package：${meta.packageNames.join(', ')}`);
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

  // 显示嵌套项目关系
  if (ancestorInfo.length > 0) {
    logger.raw(chalk.blue(`\n  嵌套继承（${ancestorInfo.length} 个祖先项目）：`));
    for (let i = 0; i < ancestorInfo.length; i++) {
      const label = i === 0 ? '直接父级' : `第 ${i + 1} 级祖先`;
      logger.raw(`    ← ${ancestorInfo[i].name} ${chalk.dim(`(${label})`)}`);
    }
    logger.raw(
      chalk.dim(
        '    级联优先级：当前项目 > ' +
          ancestorInfo.map((a) => a.name).join(' > ') +
          ' > 用户级 > 全局级',
      ),
    );
  }

  logger.raw('');
}
