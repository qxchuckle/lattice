import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  initDb,
  closeDb,
  getRAGStatus,
  rebuildIndex,
  incrementalIndex,
  deleteSearchDocumentsByPrefixes,
  collectAllSearchDocuments,
  isModelLoaded,
  FTS_INDEX_VERSION,
  getFtsIndexVersion,
  setFtsIndexVersion,
} from '@qcqx/lattice-core';
import { formatRagTimestamp, logger } from '../utils';

export function registerRagCommand(program: Command): void {
  const cmd = program.command('rag').description('管理 RAG 索引');

  // status
  cmd
    .command('status')
    .description('查看索引状态')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        await getUsername();
        await initDb();

        const status = await getRAGStatus();
        closeDb();

        if (opts.json) {
          logger.raw(JSON.stringify(status, null, 2));
          return;
        }

        logger.raw(chalk.bold('\nRAG 索引状态\n'));
        logger.raw(`  数据库：${status.dbPath}`);
        logger.raw(`  Embedding 模型：${status.modelId}`);
        logger.raw(`  模型源：${status.remoteHost ?? '仅本地模型'}`);
        logger.raw(`  下载代理：${status.proxy ?? '未配置'}`);
        logger.raw(`  已索引文档：${status.indexedDocuments}`);
        logger.raw(`  已生成向量：${status.totalEmbeddings}`);
        logger.raw(`  向量存储可用：${status.vectorStoreReady ? '是' : '否'}`);
        logger.raw(`  模型已安装：${status.modelInstalled ? '是' : '否'}`);
        logger.raw(`  模型已加载：${status.modelLoaded ? '是' : '否'}`);
        logger.raw(`  最后更新：${formatRagTimestamp(status.lastUpdated)}`);
        logger.raw('');
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // rebuild
  cmd
    .command('rebuild')
    .description('重建全部 embedding 索引')
    .action(async () => {
      try {
        await getUsername();
        await initDb();

        logger.raw(chalk.blue('正在收集搜索文档...'));

        deleteSearchDocumentsByPrefixes(['task/', 'project/', 'user/']);

        const allDocs = await collectAllSearchDocuments();

        logger.raw(chalk.blue(`找到 ${allDocs.length} 个搜索文档，正在建立索引...`));

        const indexed = await rebuildIndex(allDocs);
        // 全量重建完成后写入当前 FTS 索引版本，供 doctor / rag update 检测。
        setFtsIndexVersion(FTS_INDEX_VERSION);
        closeDb();

        logger.raw(chalk.green(`✓ 索引重建完成，共 ${indexed} 个文档`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // update
  cmd
    .command('update')
    .description('增量更新 RAG 索引（仅处理变更文档）')
    .action(async () => {
      try {
        await getUsername();
        await initDb();

        // 检测 FTS 索引版本是否过期（新升版后必须 rag rebuild 才能拿到新分词）
        const currentFtsVersion = getFtsIndexVersion();
        if (currentFtsVersion < FTS_INDEX_VERSION) {
          logger.raw(
            chalk.yellow(
              `⚠ FTS 索引版本过期（当前 v${currentFtsVersion}，需 v${FTS_INDEX_VERSION}）。`,
            ),
          );
          logger.raw(
            chalk.yellow('  为让中文 FTS 检索生效，请运行 `lattice rag rebuild` 一次全量重建。'),
          );
        }

        const modelLoaded = isModelLoaded();
        logger.spin(
          modelLoaded ? '正在收集文档并检测变更...' : '首次需要加载 embedding 模型，正在准备...',
        );

        const allDocs = await collectAllSearchDocuments();
        const result = await incrementalIndex(allDocs);
        closeDb();

        logger.spinSuccess('增量更新完成');
        const parts: string[] = [];
        if (result.added > 0) parts.push(chalk.green(`新增 ${result.added}`));
        if (result.updated > 0) parts.push(chalk.yellow(`更新 ${result.updated}`));
        if (result.removed > 0) parts.push(chalk.red(`删除 ${result.removed}`));
        parts.push(chalk.dim(`跳过 ${result.skipped}`));

        logger.raw(`  ${parts.join(' / ')}`);
      } catch (err) {
        if ((err as Error).message) {
          logger.spinFail('增量更新失败');
        }
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
