import { Command } from 'commander';
import chalk from 'chalk';
import { resolve as pathResolve } from 'node:path';
import { existsSync } from 'node:fs';
import { confirm } from '@inquirer/prompts';
import {
  getUsername,
  initDb,
  closeDb,
  createTask,
  listTasks,
  listTasksCrossUser,
  getTaskMeta,
  updateTask,
  archiveTask,
  deleteTask,
  getTaskPrd,
  getTaskPrdPath,
  getTaskDir,
  getTaskProgressPath,
  getTaskDesignPath,
  resolveTaskById,
  getTaskGraphViews,
  getTaskLineage,
  getTaskDescendantTree,
  getTaskContainingTree,
  addCheckpoint,
  listCheckpoints,
  getCheckpoint,
  findProjectsByPathSmart,
  normalizeLocalPath,
  resolveProjectById,
  listAllUsernames,
  CONFIDENCE_THRESHOLDS,
  addSpecRefs,
  removeSpecRefs,
  nowISO,
} from '@qcqx/lattice-core';
import type {
  TaskMeta,
  TaskStatus,
  TaskTreeNode,
  CheckpointType,
  ScopePath,
  TaskMetaWithSource,
} from '@qcqx/lattice-core';
import { logger, outputJson, resolveCurrentProject, shouldSkipConfirm } from '../utils';

const TASK_STATUSES: TaskStatus[] = ['planning', 'in_progress', 'completed', 'archived'];
// 检查点类型按信息源三分（详见 core/types CheckpointType 注释）
// A 区 用户输入 / B 区 AI 自我 / C 区 进程事件
const CHECKPOINT_TYPES: CheckpointType[] = [
  // A 区 · 用户输入
  'context',
  'correction',
  'constraint',
  // B 区 · AI 自我
  'assumption',
  'followup',
  'note',
  // C 区 · 进程事件
  'decision',
  'pivot',
  'milestone',
  'issue',
  'summary',
];

async function resolveCurrentProjectId(): Promise<string | null> {
  return (await resolveCurrentProject())?.id ?? null;
}

function normalizeProjectIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function formatTaskTree(node: TaskTreeNode, depth = 0): string[] {
  const prefix = `${'  '.repeat(depth)}- `;
  const lines = [`${prefix}${node.title} [${node.status}] (${node.id})`];
  for (const child of node.nextTasks) {
    lines.push(...formatTaskTree(child, depth + 1));
  }
  return lines;
}

function formatLineage(lineage: TaskMeta[]): string[] {
  return lineage.map(
    (task, index) => `${index === 0 ? '- ' : '  -> '}${task.title} [${task.status}] (${task.id})`,
  );
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
    .option('--all-user', '聚合所有用户的任务（需搭配 --project 或 --current）')
    .option('--user <users>', '聚合指定用户的任务（逗号分隔，需搭配 --project 或 --current）')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
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

        // 解析 --user 选项
        let filterUsernames: string[] | undefined;
        if (opts.user) {
          filterUsernames = (opts.user as string)
            .split(',')
            .map((u: string) => u.trim())
            .filter(Boolean);
          // 校验用户是否存在
          const allUsernames = await listAllUsernames();
          const invalid = filterUsernames.filter((u) => !allUsernames.includes(u));
          if (invalid.length > 0) {
            logger.raw(
              chalk.yellow(
                `用户不存在：${invalid.join(', ')}。可用用户：${allUsernames.join(', ')}`,
              ),
            );
            closeDb();
            return;
          }
        }

        // --all-user 与 --user 互斥
        if (opts.allUser && filterUsernames) {
          logger.raw(chalk.yellow('--all-user 与 --user 不能同时使用'));
          closeDb();
          return;
        }

        const crossUserMode = opts.allUser || !!filterUsernames;

        // 跨用户模式需要搭配 --project 或 --current
        if (crossUserMode && !projectId) {
          logger.raw(chalk.yellow('--all-user / --user 需搭配 --project 或 --current 使用'));
          closeDb();
          return;
        }

        if (crossUserMode && projectId) {
          // 跨用户模式
          const tasks: TaskMetaWithSource[] = await listTasksCrossUser(username, projectId, {
            status: opts.status as TaskStatus | undefined,
            usernames: filterUsernames,
          });
          closeDb();

          if (opts.json) {
            outputJson(tasks, opts.jsonFormat);
            return;
          }

          if (tasks.length === 0) {
            logger.raw(chalk.dim('暂无任务。'));
            return;
          }

          logger.raw(chalk.blue(`共 ${tasks.length} 个任务（跨用户）：\n`));

          const statusIcon: Record<string, string> = {
            planning: '📋',
            in_progress: '🔨',
            completed: '✅',
            archived: '📦',
          };

          for (const t of tasks) {
            const icon = statusIcon[t.status] ?? '•';
            const sourceTag = t.sourceUser !== username ? chalk.magenta(` [${t.sourceUser}]`) : '';
            logger.raw(
              `  ${icon} ${chalk.bold(t.title)} ${chalk.dim(`[${t.status}]`)}${sourceTag}`,
            );
            logger.raw(`    ${chalk.dim(t.id)}`);
            logger.raw('');
          }
        } else {
          // 单用户模式（原逻辑）
          const tasks = await listTasks(username, {
            status: opts.status as TaskStatus | undefined,
            projectId,
          });

          closeDb();

          if (opts.json) {
            outputJson(tasks, opts.jsonFormat);
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
    .option('--parent <id>', '指定父任务 ID')
    .action(async (title: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const projects: string[] = opts.project ? [...opts.project] : [];

        if (opts.current) {
          const pid = await resolveCurrentProjectId();
          if (pid && !projects.includes(pid)) projects.push(pid);
        }

        let parentTaskId: string | undefined;
        if (typeof opts.parent === 'string') {
          const parentTask = await resolveTaskById(username, opts.parent);
          if (!parentTask) {
            logger.raw(chalk.yellow(`未找到父任务：${opts.parent}`));
            closeDb();
            return;
          }
          parentTaskId = parentTask.id;
        }

        const task = await createTask(username, title, {
          projects: projects.length > 0 ? projects : undefined,
          parentTaskId,
        });

        closeDb();

        logger.raw(chalk.green('✓ 任务已创建'));
        logger.raw(chalk.dim(`  ID：${task.id}`));
        logger.raw(chalk.dim(`  标题：${task.title}`));
        logger.raw(chalk.dim(`  PRD：${getTaskPrdPath(username, task.id)}`));
        logger.raw(chalk.dim(`  目录：${getTaskDir(username, task.id)}`));
        if (task.parentTaskId) {
          logger.raw(chalk.dim(`  父任务：${task.parentTaskId}`));
        }
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
    .option('--lineage', '显示父任务链路')
    .option('--tree', '显示当前任务所在整棵任务树')
    .option('--descendants', '显示当前任务的后代树')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        const match = await resolveTaskById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
          return;
        }

        const meta = await getTaskMeta(username, match.id);

        if (!meta) {
          logger.raw(chalk.yellow(`未找到任务：${match.id}`));
          return;
        }

        const prd = await getTaskPrd(username, match.id);
        const shouldLoadViews = opts.json || opts.lineage || opts.tree || opts.descendants;
        const views = shouldLoadViews ? await getTaskGraphViews(username, match.id) : null;

        if (opts.json) {
          outputJson(
            {
              meta,
              prd,
              lineage: views?.lineage ?? null,
              tree: views?.tree ?? null,
              descendants: views?.descendants ?? null,
            },
            opts.jsonFormat,
          );
          return;
        }

        logger.raw(chalk.bold(`\n${meta.title}`));
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(`  ID：${meta.id}`);
        logger.raw(`  状态：${meta.status}`);
        logger.raw(`  PRD：${getTaskPrdPath(username, meta.id)}`);
        const designPath = getTaskDesignPath(username, meta.id);
        if (existsSync(designPath)) {
          logger.raw(`  Design：${designPath}`);
        }
        logger.raw(`  目录：${getTaskDir(username, meta.id)}`);
        if (meta.projects?.length) {
          logger.raw(`  关联项目：${meta.projects.join(', ')}`);
        }
        if (meta.parentTaskId) {
          logger.raw(`  父任务：${meta.parentTaskId}`);
        }
        logger.raw(`  创建：${meta.created}`);
        if (meta.updated) logger.raw(`  更新：${meta.updated}`);

        if (prd) {
          logger.raw(chalk.dim('\n─── PRD ───'));
          logger.raw(prd);
        }

        if (opts.lineage && views?.lineage) {
          logger.raw(chalk.dim('\n─── 父任务链路 ───'));
          logger.raw(formatLineage(views.lineage).join('\n'));
        }

        if (opts.tree && views?.tree) {
          logger.raw(chalk.dim('\n─── 所在任务树 ───'));
          logger.raw(formatTaskTree(views.tree).join('\n'));
        }

        if (opts.descendants && views?.descendants) {
          logger.raw(chalk.dim('\n─── 后代任务树 ───'));
          logger.raw(formatTaskTree(views.descendants).join('\n'));
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
    .option('--parent <id>', '修改父任务 ID')
    .option('--clear-parent', '清空父任务')
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

        if (opts.parent && opts.clearParent) {
          logger.raw(chalk.yellow('不能同时指定 --parent 和 --clear-parent'));
          closeDb();
          return;
        }

        if (typeof opts.parent === 'string') {
          const parentTask = await resolveTaskById(username, opts.parent);
          if (!parentTask) {
            logger.raw(chalk.yellow(`未找到父任务：${opts.parent}`));
            closeDb();
            return;
          }
          updates.parentTaskId = parentTask.id;
        } else if (opts.clearParent) {
          updates.parentTaskId = undefined;
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
        logger.raw(chalk.dim(`  父任务：${updated.parentTaskId ?? '无'}`));
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

  // tree
  cmd
    .command('tree <id>')
    .description('查看任务树')
    .option('--descendants', '只显示当前任务为根的后代树')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        const match = await resolveTaskById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
          return;
        }

        const tree = opts.descendants
          ? await getTaskDescendantTree(username, match.id)
          : await getTaskContainingTree(username, match.id);

        if (!tree) {
          logger.raw(chalk.yellow(`未找到任务树：${match.id}`));
          return;
        }

        if (opts.json) {
          outputJson(tree, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.bold(`\n${opts.descendants ? '后代任务树' : '所在任务树'}`));
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(formatTaskTree(tree).join('\n'));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // lineage
  cmd
    .command('lineage <id>')
    .description('查看父任务链路')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        const match = await resolveTaskById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
          return;
        }

        const lineage = await getTaskLineage(username, match.id);
        if (!lineage) {
          logger.raw(chalk.yellow(`未找到任务链路：${match.id}`));
          return;
        }

        if (opts.json) {
          outputJson(lineage, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.bold('\n父任务链路'));
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(formatLineage(lineage).join('\n'));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // delete
  cmd
    .command('delete <id>')
    .alias('rm')
    .description('删除任务（移入垃圾桶，可恢复）')
    .action(async (id: string) => {
      try {
        const username = await getUsername();
        await initDb();

        const match = await resolveTaskById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
          closeDb();
          return;
        }

        await deleteTask(username, match.id);
        closeDb();

        logger.raw(chalk.green(`✓ 任务「${match.title}」已移入垃圾桶`));
        logger.raw(chalk.dim('  使用 lattice trash list 查看，lattice trash restore <id> 恢复'));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // checkpoint
  cmd
    .command('checkpoint <id>')
    .description('添加任务检查点记录')
    .requiredOption('--type <type>', `检查点类型（${CHECKPOINT_TYPES.join(' / ')}）`)
    .requiredOption('--title <title>', '检查点标题')
    .option('-m, --message <message>', '检查点内容')
    .option('--refs <spec-ids>', '同时为任务添加 spec 引用（逗号分隔 spec-id 或 spec 名称）')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = await resolveTaskById(username, id);
        if (!match) {
          closeDb();
          logger.raw(chalk.yellow(`未找到任务：${id}`));
          return;
        }

        if (!CHECKPOINT_TYPES.includes(opts.type as CheckpointType)) {
          closeDb();
          logger.raw(chalk.yellow(`无效的检查点类型：${opts.type}`));
          logger.raw(chalk.dim(`可选值：${CHECKPOINT_TYPES.join(' / ')}`));
          return;
        }

        // --refs 快捷方式：同时添加 spec 引用
        if (opts.refs) {
          const specInputs = String(opts.refs)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (specInputs.length > 0) {
            const projectId = await resolveCurrentProjectId();
            const refResult = await addSpecRefs(username, match.id, specInputs, { projectId });
            if (refResult.added.length > 0) {
              logger.raw(chalk.green(`✓ 已添加 ${refResult.added.length} 条 spec 引用`));
            }
            if (refResult.errors.length > 0) {
              for (const e of refResult.errors) logger.raw(chalk.yellow(`  ⚠ ${e}`));
            }
          }
        }

        const entry = await addCheckpoint(username, match.id, {
          type: opts.type,
          title: opts.title,
          message: opts.message || '',
        });

        closeDb();

        if (opts.json) {
          outputJson(entry, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.green(`✓ 检查点已添加`));
        logger.raw(chalk.dim(`  ID：${entry.id}`));
        logger.raw(chalk.dim(`  类型：${entry.type}`));
        logger.raw(chalk.dim(`  标题：${entry.title}`));
        logger.raw(chalk.dim(`  时间：${entry.time}`));
        logger.raw(chalk.dim(`  文件：${getTaskProgressPath(username, match.id)}`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // progress
  cmd
    .command('progress <id>')
    .description('查看任务进展记录')
    .option('--last <n>', '只显示最近 N 条', parseInt)
    .option('--type <type>', '按类型过滤')
    .option('--id <checkpointId>', '查看指定检查点')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        const match = await resolveTaskById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到任务：${id}`));
          return;
        }

        // 查看单条
        if (opts.id) {
          const entry = await getCheckpoint(username, match.id, opts.id);
          if (!entry) {
            logger.raw(chalk.yellow(`未找到检查点：${opts.id}`));
            return;
          }
          if (opts.json) {
            outputJson(entry, opts.jsonFormat);
            return;
          }
          logger.raw(chalk.bold(`\n[${entry.type}] ${entry.title}`));
          logger.raw(chalk.dim(`  ID：${entry.id}`));
          logger.raw(chalk.dim(`  时间：${entry.time}`));
          if (entry.message) {
            logger.raw(`\n${entry.message}`);
          }
          return;
        }

        // 列表
        if (opts.type && !CHECKPOINT_TYPES.includes(opts.type as CheckpointType)) {
          logger.raw(chalk.yellow(`无效的检查点类型：${opts.type}`));
          logger.raw(chalk.dim(`可选值：${CHECKPOINT_TYPES.join(' / ')}`));
          return;
        }

        const entries = await listCheckpoints(username, match.id, {
          last: opts.last,
          type: opts.type as CheckpointType | undefined,
        });

        if (opts.json) {
          outputJson(entries, opts.jsonFormat);
          return;
        }

        if (entries.length === 0) {
          logger.raw(chalk.dim('暂无检查点记录。'));
          return;
        }

        const typeIcon: Record<string, string> = {
          // A 区 · 用户输入
          context: '📥',
          correction: '🔧',
          constraint: '🚧',
          // B 区 · AI 自我
          assumption: '💭',
          followup: '⏭️',
          note: '📌',
          // C 区 · 进程事件
          decision: '🎯',
          pivot: '🔄',
          milestone: '🏁',
          issue: '⚠️',
          summary: '📝',
        };

        logger.raw(chalk.blue(`\n任务「${match.title}」的进展记录（共 ${entries.length} 条）：\n`));

        for (const entry of entries) {
          const icon = typeIcon[entry.type] ?? '•';
          const timeStr = entry.time.slice(0, 16).replace('T', ' ');
          logger.raw(
            `  ${icon} ${chalk.dim(timeStr)} ${chalk.bold(entry.title)} ${chalk.dim(`[${entry.type}]`)}`,
          );
          logger.raw(chalk.dim(`    ${entry.id}`));
          if (entry.message) {
            const preview =
              entry.message.length > 80 ? entry.message.slice(0, 80) + '...' : entry.message;
            logger.raw(chalk.dim(`    ${preview}`));
          }
          logger.raw('');
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── associate <id> ───
  cmd
    .command('associate <id>')
    .description(
      '为任务关联项目或路径（路径智能识别：命中已注册项目记到 projects，未命中记到 scopePaths）',
    )
    .option('-p, --project <ids...>', '追加关联项目 ID')
    .option('--current', '追加当前目录对应的项目')
    .option('--paths <paths...>', '追加额外路径（可多个，会依次智能识别是否属于某个已注册项目）')
    .option('--note <note>', '赋予本次新增路径的备注')
    .option('--remove-path <path>', '从 scopePaths 中移除指定路径')
    .option('--remove-project <id>', '从 projects 中移除指定项目')
    .option('--clear-paths', '清空任务的 scopePaths')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
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
        const meta = match;
        const updates: Partial<TaskMeta> = {};

        // 1) projects 演变
        const currentProjects = new Set(meta.projects ?? []);
        if (opts.project) {
          for (const raw of opts.project as string[]) {
            const r = resolveProjectById(username, raw);
            if (!r) {
              logger.raw(chalk.yellow(`跳过未知项目：${raw}`));
              continue;
            }
            currentProjects.add(r.id);
          }
        }
        if (opts.current) {
          const cur = await resolveCurrentProject();
          if (cur) currentProjects.add(cur.id);
        }
        if (opts.removeProject) {
          const r = resolveProjectById(username, opts.removeProject as string);
          if (r) currentProjects.delete(r.id);
          else currentProjects.delete(opts.removeProject as string);
        }

        // 2) scopePaths 演变
        let scopePaths: ScopePath[] = [...(meta.scopePaths ?? [])];
        if (opts.clearPaths) scopePaths = [];
        if (opts.removePath) {
          const norm = normalizeLocalPath(pathResolve(opts.removePath as string));
          scopePaths = scopePaths.filter((s) => s.path !== norm);
        }
        const recognized: {
          path: string;
          projectName: string;
          projectId: string;
          score: number;
        }[] = [];
        const unrecognized: { path: string; note?: string }[] = [];
        if (opts.paths) {
          for (const raw of opts.paths as string[]) {
            const norm = normalizeLocalPath(pathResolve(raw));
            const candidates = await findProjectsByPathSmart(norm);
            const top = candidates[0];
            if (top && top.score >= CONFIDENCE_THRESHOLDS.high) {
              currentProjects.add(top.projectId);
              recognized.push({
                path: norm,
                projectName: top.projectName,
                projectId: top.projectId,
                score: top.score,
              });
            } else {
              if (!scopePaths.find((s) => s.path === norm)) {
                scopePaths.push({
                  path: norm,
                  note: (opts.note as string | undefined) ?? undefined,
                  addedAt: nowISO(),
                });
              }
              unrecognized.push({ path: norm, note: opts.note as string | undefined });
            }
          }
        }

        updates.projects = [...currentProjects];
        updates.scopePaths = scopePaths;

        const updated = await updateTask(username, meta.id, updates);
        closeDb();

        if (opts.json) {
          outputJson({ task: updated, recognized, unrecognized, scopePaths }, opts.jsonFormat);
          return;
        }

        if (!updated) {
          logger.raw(chalk.yellow('更新失败'));
          return;
        }

        logger.raw(chalk.green(`✓ 任务 ${updated.title} 关联已更新`));
        logger.raw(chalk.dim(`  关联项目：${updated.projects?.length ?? 0} 个`));
        logger.raw(chalk.dim(`  scopePaths：${updated.scopePaths?.length ?? 0} 个`));
        if (recognized.length > 0) {
          logger.raw(chalk.cyan(`\n  → 路径识别为项目（${recognized.length}）：`));
          for (const r of recognized) {
            logger.raw(`    ${r.path} ${chalk.dim(`→ ${r.projectName} (score=${r.score})`)}`);
          }
        }
        if (unrecognized.length > 0) {
          logger.raw(chalk.cyan(`\n  → 记为额外路径（${unrecognized.length}）：`));
          for (const u of unrecognized) {
            logger.raw(`    ${u.path}${u.note ? chalk.dim(` (${u.note})`) : ''}`);
          }
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── ref-spec / unref-spec ───

  cmd
    .command('ref-spec <task-id> <spec...>')
    .description('为任务添加 spec 引用（支持文件名、标题模糊匹配和 glob）')
    .action(async (taskId: string, specInputs: string[]) => {
      try {
        const username = await getUsername();
        await initDb();
        const projectId = await resolveCurrentProjectId();
        const resolved = await resolveTaskById(username, taskId);
        if (!resolved) {
          closeDb();
          logger.raw(chalk.yellow(`未找到任务：${taskId}`));
          process.exitCode = 1;
          return;
        }
        const result = await addSpecRefs(username, resolved.id, specInputs, { projectId });
        closeDb();

        if (result.added.length > 0) {
          logger.raw(chalk.green(`✓ 已添加 ${result.added.length} 条 spec 引用：`));
          for (const id of result.added) logger.raw(chalk.dim(`  + ${id}`));
        }
        if (result.skipped.length > 0) {
          logger.raw(chalk.dim(`  跳过已存在：${result.skipped.join(', ')}`));
        }
        if (result.errors.length > 0) {
          for (const e of result.errors) logger.raw(chalk.yellow(`  ⚠ ${e}`));
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  cmd
    .command('unref-spec <task-id> <spec-id...>')
    .description('从任务移除 spec 引用（参数为 spec-id）')
    .action(async (taskId: string, specIds: string[]) => {
      try {
        const username = await getUsername();
        await initDb();
        const resolved = await resolveTaskById(username, taskId);
        if (!resolved) {
          closeDb();
          logger.raw(chalk.yellow(`未找到任务：${taskId}`));
          process.exitCode = 1;
          return;
        }
        const result = await removeSpecRefs(username, resolved.id, specIds);
        closeDb();

        if (result.removed.length > 0) {
          logger.raw(chalk.green(`✓ 已移除 ${result.removed.length} 条引用：`));
          for (const id of result.removed) logger.raw(chalk.dim(`  - ${id}`));
        }
        if (result.notFound.length > 0) {
          logger.raw(chalk.yellow(`  未找到：${result.notFound.join(', ')}`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
