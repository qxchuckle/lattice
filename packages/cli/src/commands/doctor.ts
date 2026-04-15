import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  isInitialized,
  initDb,
  closeDb,
  readLocalConfig,
  listProjects,
  listTasks,
  getRAGStatus,
  dirExists,
  fileExists,
  getLatticeRoot,
  getGlobalSpecDir,
  getUserDir,
  getUserSpecDir,
  getUserProjectsDir,
  getUserTasksDir,
  getLocalConfigPath,
  getGlobalConfigPath,
} from '@qcqx/lattice-core';
import type { DoctorEntry } from '@qcqx/lattice-core';
import { logger } from '../utils';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('检测和修复 Lattice 配置健康状况')
    .option('--fix', '自动修复可安全修复的项')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const entries: DoctorEntry[] = [];

        // 1. 检查初始化状态
        const initialized = await isInitialized();
        entries.push({
          item: 'Lattice 初始化',
          status: initialized ? 'healthy' : 'error',
          message: initialized ? '已初始化' : '未初始化',
          fix: initialized ? undefined : '运行 lattice init',
        });

        if (!initialized) {
          outputReport(entries, opts.json);
          return;
        }

        // 2. 检查配置文件
        entries.push({
          item: 'config.json',
          status: (await fileExists(getGlobalConfigPath())) ? 'healthy' : 'stale',
          message: (await fileExists(getGlobalConfigPath())) ? '存在' : '缺失',
          fix: '运行 lattice init 重新生成',
        });

        entries.push({
          item: 'config-local.json',
          status: (await fileExists(getLocalConfigPath())) ? 'healthy' : 'error',
          message: (await fileExists(getLocalConfigPath())) ? '存在' : '缺失',
          fix: '运行 lattice init 重新生成',
        });

        // 3. 检查目录结构
        const username = await getUsername();
        const dirChecks = [
          { name: '全局 spec 目录', path: getGlobalSpecDir() },
          { name: '用户目录', path: getUserDir(username) },
          { name: '用户 spec 目录', path: getUserSpecDir(username) },
          { name: '用户 projects 目录', path: getUserProjectsDir(username) },
          { name: '用户 tasks 目录', path: getUserTasksDir(username) },
        ];

        for (const check of dirChecks) {
          const exists = await dirExists(check.path);
          entries.push({
            item: check.name,
            status: exists ? 'healthy' : 'stale',
            message: exists ? '存在' : '缺失',
            fix: exists ? undefined : `创建目录 ${check.path}`,
          });
        }

        // 4. 检查数据库
        await initDb();

        // 5. 检查项目索引
        const projects = listProjects(username);
        let staleCount = 0;
        for (const p of projects) {
          const exists = await dirExists(p.local_path);
          if (!exists) staleCount++;
        }

        entries.push({
          item: '项目索引',
          status: staleCount === 0 ? 'healthy' : 'stale',
          message:
            staleCount === 0
              ? `${projects.length} 个项目全部有效`
              : `${staleCount}/${projects.length} 个项目路径失效`,
          fix: staleCount > 0 ? '运行 lattice scan 重新扫描' : undefined,
        });

        // 6. 检查 RAG 状态
        const ragStatus = await getRAGStatus();
        entries.push({
          item: 'RAG 索引',
          status:
            ragStatus.indexedDocuments === 0
              ? 'stale'
              : ragStatus.vectorStoreReady &&
                  ragStatus.totalEmbeddings === ragStatus.indexedDocuments
                ? 'healthy'
                : 'stale',
          message: `${ragStatus.totalEmbeddings}/${ragStatus.indexedDocuments} 条向量已生成`,
          fix:
            ragStatus.indexedDocuments === 0
              ? '运行 lattice rag rebuild 重建索引'
              : !ragStatus.vectorStoreReady
                ? '检查 sqlite-vec 扩展是否可用'
                : ragStatus.totalEmbeddings < ragStatus.indexedDocuments
                  ? '重新运行 lattice rag rebuild 生成缺失向量'
                  : undefined,
        });

        closeDb();

        outputReport(entries, opts.json);
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

function outputReport(entries: DoctorEntry[], json: boolean): void {
  if (json) {
    logger.raw(JSON.stringify(entries, null, 2));
    return;
  }

  const healthy = entries.filter((e) => e.status === 'healthy').length;
  const stale = entries.filter((e) => e.status === 'stale').length;
  const errors = entries.filter((e) => e.status === 'error').length;

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
    if (e.fix && e.status !== 'healthy') {
      logger.raw(`    ${chalk.dim(`修复：${e.fix}`)}`);
    }
  }

  logger.raw('');
  logger.raw(
    chalk.dim(`  共 ${entries.length} 项：${healthy} 健康，${stale} 待修复，${errors} 错误`),
  );
  logger.raw('');
}
