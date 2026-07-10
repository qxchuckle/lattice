import { Command } from 'commander';
import chalk from 'chalk';
import {
  addLogEntry,
  listLogEntries,
  searchLogEntries,
  getLogEntry,
  clearAllLogs,
  getLogStats,
  getFastStartLogDir,
  resolveProjectById,
  getUsername,
  initDb,
  closeDb,
  MAX_ENTRIES_PER_FILE,
} from '@qcqx/lattice-core';
import { logger, outputJson, resolveCurrentProject, shouldSkipConfirm } from '../utils';

export function registerFastStartCommand(program: Command): void {
  const cmd = program.command('fast-start').description('fast-start 轻量模式日志');

  // ─── log 子命令组 ───
  const log = cmd.command('log').description('fast-start 日志管理');

  // log add
  log
    .command('add <title>')
    .description('添加一条 fast-start 日志')
    .requiredOption('-m, --message <message>', '日志内容')
    .option('--files <files...>', '涉及的文件列表')
    .option('--cwd <dir>', '工作目录（默认当前目录）')
    .option('--project <id>', '关联项目 ID（默认自动检测）')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (title: string, opts) => {
      try {
        const username = await getUsername();
        const cwd = opts.cwd || process.cwd();
        let projectId: string | undefined;
        let projectName: string | undefined;

        if (opts.project) {
          await initDb();
          const resolved = resolveProjectById(username, opts.project);
          closeDb();
          if (resolved) {
            projectId = resolved.id;
            projectName = resolved.name;
          }
        } else {
          const cur = await resolveCurrentProject(cwd);
          if (cur) {
            projectId = cur.id;
          }
        }

        const entry = await addLogEntry(username, {
          title,
          message: opts.message,
          cwd,
          projectId,
          projectName,
          files: opts.files,
        });

        if (opts.json) {
          outputJson(entry, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.green('✓ fast-start 日志已添加'));
        logger.raw(chalk.dim(`  ID：${entry.id}`));
        logger.raw(chalk.dim(`  标题：${entry.title}`));
        logger.raw(chalk.dim(`  时间：${entry.time}`));
        logger.raw(chalk.dim(`  目录：${entry.cwd}`));
        if (entry.projectId) {
          logger.raw(chalk.dim(`  项目：${entry.projectId}`));
        }
        if (entry.files?.length) {
          logger.raw(chalk.dim(`  文件：${entry.files.join(', ')}`));
        }
        logger.raw(chalk.dim(`  存储：${getFastStartLogDir(username)}`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // log list
  log
    .command('list')
    .alias('ls')
    .description('列出 fast-start 日志')
    .option('--last <n>', '只显示最近 N 条', parseInt)
    .option('--project <id>', '按项目 ID 过滤')
    .option('--current', '自动识别当前目录对应的项目并过滤')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        let projectId = opts.project as string | undefined;
        if (opts.current) {
          const cur = await resolveCurrentProject();
          if (cur) {
            projectId = cur.id;
          } else {
            logger.raw(chalk.yellow('当前目录不是 Lattice 项目'));
            return;
          }
        }

        const entries = await listLogEntries(username, {
          last: opts.last,
          projectId,
        });

        if (opts.json) {
          outputJson(entries, opts.jsonFormat);
          return;
        }

        if (entries.length === 0) {
          logger.raw(chalk.dim('暂无 fast-start 日志。'));
          return;
        }

        logger.raw(chalk.blue(`共 ${entries.length} 条 fast-start 日志：\n`));

        for (const entry of entries) {
          const timeStr = entry.time.slice(0, 16).replace('T', ' ');
          logger.raw(`  ${chalk.dim(timeStr)} ${chalk.bold(entry.title)}`);
          logger.raw(chalk.dim(`    ${entry.id}`));
          if (entry.projectName || entry.projectId) {
            logger.raw(chalk.dim(`    项目：${entry.projectName ?? entry.projectId}`));
          }
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

  // log search
  log
    .command('search <query>')
    .alias('find')
    .description('关键词搜索 fast-start 日志（搜索标题 / 内容 / 文件 / 目录）')
    .option('--last <n>', '只返回最近 N 条', parseInt)
    .option('--project <id>', '按项目 ID 过滤')
    .option('--current', '自动识别当前目录对应的项目并过滤')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (query: string, opts) => {
      try {
        const username = await getUsername();
        let projectId = opts.project as string | undefined;
        if (opts.current) {
          const cur = await resolveCurrentProject();
          if (cur) {
            projectId = cur.id;
          } else {
            logger.raw(chalk.yellow('当前目录不是 Lattice 项目'));
            return;
          }
        }

        const entries = await searchLogEntries(username, {
          query,
          projectId,
          last: opts.last,
        });

        if (opts.json) {
          outputJson(entries, opts.jsonFormat);
          return;
        }

        if (entries.length === 0) {
          logger.raw(chalk.dim(`未找到匹配「${query}」的日志。`));
          return;
        }

        logger.raw(chalk.blue(`找到 ${entries.length} 条匹配「${query}」的日志：\n`));

        for (const entry of entries) {
          const timeStr = entry.time.slice(0, 16).replace('T', ' ');
          logger.raw(`  ${chalk.dim(timeStr)} ${chalk.bold(entry.title)}`);
          logger.raw(chalk.dim(`    ${entry.id}`));
          if (entry.projectName || entry.projectId) {
            logger.raw(chalk.dim(`    项目：${entry.projectName ?? entry.projectId}`));
          }
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

  // log show
  log
    .command('show <id>')
    .description('查看单条 fast-start 日志')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        const entry = await getLogEntry(username, id);
        if (!entry) {
          logger.raw(chalk.yellow(`未找到日志：${id}`));
          return;
        }

        if (opts.json) {
          outputJson(entry, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.bold(`\n${entry.title}`));
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(`  ID：${entry.id}`);
        logger.raw(`  时间：${entry.time}`);
        logger.raw(`  目录：${entry.cwd}`);
        if (entry.projectId) {
          logger.raw(`  项目：${entry.projectId}`);
        }
        if (entry.projectName) {
          logger.raw(`  项目名：${entry.projectName}`);
        }
        if (entry.files?.length) {
          logger.raw(`  文件：`);
          for (const f of entry.files) {
            logger.raw(`    - ${f}`);
          }
        }
        if (entry.message) {
          logger.raw(chalk.dim('\n─── 内容 ───'));
          logger.raw(entry.message);
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // log clear
  log
    .command('clear')
    .description('清空所有 fast-start 日志')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        const stats = await getLogStats(username);
        if (stats.totalEntries === 0) {
          logger.raw(chalk.dim('暂无 fast-start 日志可清空。'));
          return;
        }

        const skip = shouldSkipConfirm(opts);

        if (!skip) {
          const { confirm } = await import('@inquirer/prompts');
          const confirmed = await confirm({
            message: `确认清空 ${stats.totalEntries} 条日志（${stats.fileCount} 个文件）？此操作不可恢复。`,
            default: false,
          });
          if (!confirmed) {
            logger.raw(chalk.yellow('已取消'));
            return;
          }
        }

        const fileCount = await clearAllLogs(username);
        logger.raw(chalk.green(`✓ 已清空 ${fileCount} 个日志文件`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // log stats
  log
    .command('stats')
    .description('查看 fast-start 日志统计')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        const stats = await getLogStats(username);

        if (opts.json) {
          outputJson(stats, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.bold('\nfast-start 日志统计'));
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(`  总条目数：${stats.totalEntries}`);
        logger.raw(`  文件数：${stats.fileCount}`);
        if (stats.latestFileName) {
          logger.raw(`  当前文件：${stats.latestFileName}`);
          logger.raw(
            chalk.dim(
              `    （${stats.latestFileEntries}/${MAX_ENTRIES_PER_FILE} 条，${stats.fileCount > 1 ? '已分片' : '单文件'}）`,
            ),
          );
        }
        logger.raw(chalk.dim(`  存储目录：${getFastStartLogDir(username)}`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
