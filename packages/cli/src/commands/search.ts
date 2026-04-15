import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  initDb,
  closeDb,
  hybridSearch,
  isModelLoaded,
  getRAGStatus,
} from '@qcqx/lattice-core';
import { formatRagTimestamp, logger } from '../utils';

function parseUsersOption(input?: string): string[] {
  return Array.from(
    new Set(
      (input ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('搜索 spec、任务和项目')
    .option('--type <type>', '限制搜索类型（spec / task / project）')
    .option('--project <id>', '限制在指定项目范围内')
    .option('--users <names>', '只搜索指定用户内容，逗号分隔')
    .option('--all-user', '搜索所有用户内容')
    .option('--limit <n>', '返回结果数量', '10')
    .option('--no-rerank', '关闭轻量 rerank，对比 first-stage 排序')
    .option('--json', 'JSON 格式输出')
    .action(async (query: string, opts) => {
      let spinnerActive = false;
      try {
        const currentUser = await getUsername();
        await initDb();

        if (opts.allUser && opts.users) {
          throw new Error('--users 与 --all-user 不能同时使用');
        }

        const specifiedUsers = parseUsersOption(opts.users as string | undefined);
        const usernames = opts.allUser
          ? undefined
          : specifiedUsers.length > 0
            ? specifiedUsers
            : [currentUser];

        const modelLoaded = isModelLoaded();
        logger.spin(
          modelLoaded
            ? `正在搜索 “${query}”...`
            : `首次搜索需要加载或下载 embedding 模型，正在准备 “${query}”...`,
        );
        spinnerActive = true;

        const results = await hybridSearch(query, {
          type: opts.type,
          projectId: opts.project,
          usernames,
          limit: parseInt(opts.limit, 10),
          useLightweightRerank: opts.rerank,
        });
        const ragStatus = await getRAGStatus();
        const showUsername = Boolean(opts.allUser || opts.users);

        logger.spinSuccess(modelLoaded ? '搜索完成' : '模型加载完成，搜索完成');
        spinnerActive = false;

        if (opts.json) {
          logger.raw(JSON.stringify(results, null, 2));
          return;
        }

        outputRagRefreshHint(ragStatus.lastUpdated);

        if (results.length === 0) {
          logger.raw(chalk.dim('未找到相关结果。'));
          return;
        }

        logger.raw(chalk.blue(`\n找到 ${results.length} 个结果：\n`));

        for (const r of results) {
          const typeLabel = { spec: '📄', task: '📋', project: '📁' }[r.type] ?? '•';
          logger.raw(`  ${typeLabel} ${chalk.bold(r.title)} ${chalk.dim(`[${r.type}]`)}`);
          if (r.snippet) {
            logger.raw(`    ${chalk.dim(r.snippet.slice(0, 120))}`);
          }
          const filePath = (r.meta as Record<string, unknown>).filePath;
          const username = (r.meta as Record<string, unknown>).username;
          if (showUsername) {
            logger.raw(`    ${chalk.dim(`用户: ${(username as string) || 'global'}`)}`);
          }
          if (filePath) {
            logger.raw(`    ${chalk.dim(filePath as string)}`);
          }
          logger.raw('');
        }
      } catch (err) {
        if (spinnerActive) {
          logger.spinFail('搜索失败');
        }
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      } finally {
        closeDb();
      }
    });
}

function outputRagRefreshHint(lastUpdated: string | null): void {
  const updatedLabel = formatRagTimestamp(lastUpdated);
  logger.raw(chalk.dim(`RAG 上次构建时间：${updatedLabel}`));
  logger.raw(chalk.dim('如近期新增或修改了 spec、任务或项目信息，建议主动运行 `lattice rag rebuild`。'));
  logger.raw('');
}
