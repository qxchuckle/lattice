import { Command } from 'commander';
import chalk from 'chalk';
import type { IndexProgressCallback } from '@qcqx/lattice-core';
import {
  getUsername,
  initDb,
  closeDb,
  getRAGStatus,
  forceRebuildIndex,
  updateRagIndex,
  isModelLoaded,
  isModelLoadNetworkError,
  formatModelNetworkHint,
} from '@qcqx/lattice-core';
import { formatRagTimestamp, logger, outputJson } from '../utils';

/** 进度显示管理器：真实进度 + 估算填补间隔 */
class ProgressDisplay {
  private lastProgress: {
    current: number;
    total: number;
    added: number;
    updated: number;
    skipped: number;
    chunksProcessed: number;
    currentFile?: string;
  } = {
    current: 0,
    total: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    chunksProcessed: 0,
  };
  private lastUpdateTime = 0;
  private startTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private avgMsPerChunk = 0;
  private realChunkCount = 0; // 最后一次真实 chunk 数

  start(): void {
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    // 每 100ms 刷新显示，用估算填补真实进度之间的间隔
    this.timer = setInterval(() => this.refresh(), 100);
  }

  /** 接收真实进度数据 */
  update(p: {
    current: number;
    total: number;
    added: number;
    updated: number;
    skipped: number;
    chunksProcessed: number;
    currentFile?: string;
  }): void {
    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;
    // 计算处理速度（仅在 chunk 数增长时更新）
    if (p.chunksProcessed > this.realChunkCount && elapsed > 0) {
      const chunkDelta = p.chunksProcessed - this.realChunkCount;
      const instantMsPerChunk = elapsed / chunkDelta;
      // 指数移动平均，避免单次波动
      this.avgMsPerChunk =
        this.avgMsPerChunk === 0
          ? instantMsPerChunk
          : this.avgMsPerChunk * 0.7 + instantMsPerChunk * 0.3;
    }
    this.lastProgress = p;
    this.realChunkCount = p.chunksProcessed;
    this.lastUpdateTime = now;
    this.render(p.chunksProcessed);
  }

  /** 估算当前 chunk 数并刷新显示 */
  private refresh(): void {
    if (this.avgMsPerChunk <= 0) return;
    const elapsedSinceLastReal = Date.now() - this.lastUpdateTime;
    const estimatedExtra = Math.floor(elapsedSinceLastReal / this.avgMsPerChunk);
    const estChunks = this.realChunkCount + estimatedExtra;
    this.render(estChunks);
  }

  /** 格式化耗时 */
  private formatElapsed(): string {
    const sec = Math.floor((Date.now() - this.startTime) / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m${s}s`;
  }

  /** 获取格式化的最终耗时 */
  get elapsed(): string {
    return this.formatElapsed();
  }

  /** 获取最终耗时（秒） */
  get elapsedSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  private render(displayChunks: number): void {
    const p = this.lastProgress;
    const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
    const time = chalk.gray(`[${this.formatElapsed()}]`);
    const chunkInfo = displayChunks > 0 ? chalk.cyan(`${displayChunks}chunks`) : '';
    const updateInfo = p.updated > 0 ? chalk.yellow(`~${p.updated}`) : '';
    const skipInfo = p.skipped > 0 ? chalk.dim(`=${p.skipped}`) : '';
    // 文件名：取路径最后一段，截断到 40 字符
    const fileName = p.currentFile
      ? chalk.dim(` → ${p.currentFile.split('/').pop() ?? p.currentFile}`.slice(0, 45))
      : '';
    process.stdout.write(
      `\r${time} ${chalk.dim('索引')} ${String(p.current).padStart(4)}/${p.total} ${chalk.green('+' + p.added)} ${updateInfo} ${skipInfo} ${chunkInfo} ${pct}%${fileName}`.slice(
        0,
        150,
      ) + '\r',
    );
  }

  /** 获取最终的真实 chunk 数 */
  get totalChunks(): number {
    return this.realChunkCount;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** 创建进度回调 */
function makeProgressCallback(display: ProgressDisplay): IndexProgressCallback {
  return (p) => display.update(p);
}

function clearProgressLine(): void {
  process.stdout.write('\r' + ' '.repeat(130) + '\r');
}

export function registerRagCommand(program: Command): void {
  const cmd = program.command('rag').description('管理 RAG 索引');

  // status
  cmd
    .command('status')
    .description('查看索引状态')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        await getUsername();
        await initDb();

        const status = await getRAGStatus();
        closeDb();

        if (opts.json) {
          outputJson(status, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.bold('\nRAG 索引状态\n'));
        logger.raw(`  数据库：${status.dbPath}`);
        logger.raw(`  Embedding 模型：${status.modelId}`);
        logger.raw(`  模型精度：${status.dtype} / pooling: ${status.pooling}`);
        logger.raw(`  向量维度：${status.vectorDimension}`);
        logger.raw(`  模型源：${status.remoteHost ?? '仅本地模型'}`);
        logger.raw(`  下载代理：${status.proxy ?? '未配置'}`);
        logger.raw(`  已索引文档：${status.indexedDocuments}`);
        logger.raw(`  已生成向量：${status.totalEmbeddings}`);
        const avgChunks =
          status.indexedDocuments > 0
            ? (status.totalEmbeddings / status.indexedDocuments).toFixed(1)
            : '0';
        logger.raw(`  平均分片：${avgChunks} chunks/文档`);
        logger.raw(`  向量存储可用：${status.vectorStoreReady ? '是' : '否'}`);
        logger.raw(
          `  FTS 索引版本：v${status.ftsIndexVersion}${status.ftsIndexVersion < status.expectedFtsVersion ? chalk.yellow(`（过期，需 v${status.expectedFtsVersion}）`) : ''}`,
        );
        logger.raw(
          `  分片参数：minChunkSize=${status.minChunkSize} / batchSize=${status.batchSize}`,
        );
        logger.raw(`  距离阈值：${status.distanceThreshold}`);
        logger.raw(`  模型已安装：${status.modelInstalled ? '是' : '否'}`);
        logger.raw(`  最后更新：${formatRagTimestamp(status.lastUpdated)}`);
        if (status.modelChanged) {
          logger.raw(
            chalk.yellow(
              `  ⚠ 模型已变更（${status.lastModelId} → ${status.modelId}），请运行 ltc rag rebuild`,
            ),
          );
        } else if (status.lastModelId) {
          logger.raw(chalk.dim(`  上次索引模型：${status.lastModelId}`));
        }
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
        const display = new ProgressDisplay();
        display.start();
        const indexed = await forceRebuildIndex(makeProgressCallback(display));
        display.stop();
        clearProgressLine();
        closeDb();
        logger.raw(
          chalk.green(
            `✓ 索引重建完成，共 ${indexed} 个文档 / ${display.totalChunks} 个分片（耗时 ${display.elapsed}）`,
          ),
        );
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

        const modelLoaded = isModelLoaded();
        logger.spin(
          modelLoaded ? '正在收集文档并检测变更...' : '首次需要加载 embedding 模型，正在准备...',
        );

        const display = new ProgressDisplay();
        display.start();
        const result = await updateRagIndex(makeProgressCallback(display));
        display.stop();

        clearProgressLine();
        closeDb();

        if (result.reason === 'fts_version_expired') {
          logger.raw(chalk.yellow('⚠ FTS 索引版本过期，已自动全量重建'));
        } else if (result.reason === 'model_changed') {
          logger.raw(chalk.yellow('⚠ Embedding 模型已变更，已自动全量重建'));
        }

        if (result.mode === 'rebuild') {
          logger.raw(
            chalk.green(
              `✓ 索引重建完成，共 ${result.added} 个文档 / ${display.totalChunks} 个分片（耗时 ${display.elapsed}）`,
            ),
          );
        } else {
          logger.spinSuccess('增量更新完成');
          if (!isModelLoaded()) {
            logger.spinWarn('embedding 模型未加载，部分文档可能未生成向量');
            if (isModelLoadNetworkError()) {
              logger.raw(chalk.yellow(formatModelNetworkHint()));
            }
          }
          const parts: string[] = [];
          if (result.added > 0) parts.push(chalk.green(`新增 ${result.added}`));
          if (result.updated > 0) parts.push(chalk.yellow(`更新 ${result.updated}`));
          if (result.removed > 0) parts.push(chalk.red(`删除 ${result.removed}`));
          parts.push(chalk.dim(`跳过 ${result.skipped}`));
          if (display.totalChunks > 0) parts.push(chalk.cyan(`${display.totalChunks}chunks`));
          logger.raw(`  ${parts.join(' / ')}`);
        }
      } catch (err) {
        if ((err as Error).message) {
          logger.spinFail('更新失败');
        }
        console.error(chalk.red('错误：'), (err as Error).message);
        if (isModelLoadNetworkError()) {
          logger.raw(chalk.yellow(formatModelNetworkHint()));
        }
        process.exitCode = 1;
      }
    });
}
