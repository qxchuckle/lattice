import { Command } from 'commander';
import chalk from 'chalk';
import { runDoctorCheck, initDb, closeDb } from '@qcqx/lattice-core';
import type { DoctorEntry } from '@qcqx/lattice-core';
import { logger, outputJson } from '../utils';
import { cliVersion } from '../version';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('检测和修复 Lattice 配置健康状况')
    .option('--fix', '自动修复可安全修复的项')
    .option('--migrate', '迁移：将旧 single-path/single-remote 项目数据升级为多路径数组')
    .option('--rebuild-fingerprints', '重新采集所有项目的指纹')
    .option('--recheck-scope-paths', '重新检查所有任务的 scopePaths 是否已属于某个已注册项目')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        await initDb();
        const report = await runDoctorCheck({
          fix: opts.fix,
          migrate: opts.migrate,
          rebuildFingerprints: opts.rebuildFingerprints,
          recheckScopePaths: opts.recheckScopePaths,
          cliVersion,
        });

        if (opts.json) {
          outputJson(report, opts.jsonFormat);
          return;
        }

        outputReport(report.entries);
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      } finally {
        closeDb();
      }
    });
}

function outputReport(entries: DoctorEntry[], jsonFormat?: boolean): void {
  const healthy = entries.filter((e) => e.status === 'healthy').length;
  const stale = entries.filter((e) => e.status === 'stale').length;
  const errors = entries.filter((e) => e.status === 'error').length;
  const repaired = entries.filter((e) => e.status === 'repaired').length;

  logger.raw(chalk.bold('\nLattice 健康检查\n'));

  const statusIcon: Record<string, string> = {
    healthy: chalk.green('✓'),
    stale: chalk.yellow('⚠'),
    error: chalk.red('✗'),
    repaired: chalk.blue('↻'),
  };

  for (const e of entries) {
    const icon = statusIcon[e.status] ?? '•';
    logger.raw(`  ${icon} ${e.item}: ${e.message}`);
    if (e.fix && e.status !== 'healthy' && e.status !== 'repaired') {
      logger.raw(`    ${chalk.dim(`修复：${e.fix}`)}`);
    }
  }

  logger.raw('');
  logger.raw(
    chalk.dim(
      `  共 ${entries.length} 项：${healthy} 健康，${stale} 待修复，${errors} 错误${repaired ? `，${repaired} 已修复` : ''}`,
    ),
  );
  logger.raw('');
}
