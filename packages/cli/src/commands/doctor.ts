import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  isInitialized,
  initDb,
  closeDb,
  listProjects,
  listTasks,
  getRAGStatus,
  FTS_INDEX_VERSION,
  getFtsIndexVersion,
  dirExists,
  fileExists,
  getGlobalSpecDir,
  getUserDir,
  getUserSpecDir,
  getUserProjectsDir,
  getUserTasksDir,
  getLocalConfigPath,
  getGlobalConfigPath,
  getProjectMeta,
  collectFingerprint,
  persistFingerprints,
  findProjectsByPathSmart,
  CONFIDENCE_THRESHOLDS,
  updateTask,
  findProjectDirName,
  writeJSON,
  readJSON,
  getProjectMetaPath,
  upsertProject,
  listDir,
} from '@qcqx/lattice-core';
import type { DoctorEntry, ProjectRow, TaskMeta, ScopePath, ProjectMeta } from '@qcqx/lattice-core';
import { logger } from '../utils';

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function rowLocalPaths(row: ProjectRow): string[] {
  return parseJsonArray(row.local_path);
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('检测和修复 Lattice 配置健康状况')
    .option('--fix', '自动修复可安全修复的项')
    .option('--migrate', '迁移：将旧 single-path/single-remote 项目数据升级为多路径数组')
    .option('--rebuild-fingerprints', '重新采集所有项目的指纹')
    .option('--recheck-scope-paths', '重新检查所有任务的 scopePaths 是否已属于某个已注册项目')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const entries: DoctorEntry[] = [];

        // 1. 初始化检查
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

        // 2. 配置文件
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

        // 3. 目录结构
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

        // 4. 数据库
        await initDb();

        // 5. 项目索引：localPaths 数组中的所有路径
        const projects = listProjects(username);
        let staleCount = 0;
        let missingPathCount = 0;
        for (const p of projects) {
          const localPaths = rowLocalPaths(p);
          if (localPaths.length === 0) {
            missingPathCount++;
            continue;
          }
          let anyExists = false;
          for (const path of localPaths) {
            if (await dirExists(path)) {
              anyExists = true;
              break;
            }
          }
          if (!anyExists) staleCount++;
        }

        entries.push({
          item: '项目索引',
          status: staleCount === 0 && missingPathCount === 0 ? 'healthy' : 'stale',
          message:
            staleCount === 0 && missingPathCount === 0
              ? `${projects.length} 个项目全部有效`
              : `${staleCount}/${projects.length} 个项目所有路径都失效${missingPathCount ? `，${missingPathCount} 个无路径记录` : ''}`,
          fix:
            staleCount > 0
              ? '运行 lattice scan 重新扫描或 lattice project list --orphaned 查看'
              : undefined,
        });

        // 6. RAG
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

        // 6.1 FTS 索引版本（CJK 检索能力依赖该版本）
        const ftsVersion = getFtsIndexVersion();
        const ftsStale = ftsVersion < FTS_INDEX_VERSION;
        entries.push({
          item: 'FTS 索引版本',
          status: ragStatus.indexedDocuments === 0 ? 'stale' : ftsStale ? 'stale' : 'healthy',
          message:
            ragStatus.indexedDocuments === 0
              ? `当前 v${ftsVersion}，期望 v${FTS_INDEX_VERSION}（索引为空）`
              : ftsStale
                ? `当前 v${ftsVersion}，期望 v${FTS_INDEX_VERSION}（中文检索失效，需要重建）`
                : `v${FTS_INDEX_VERSION}`,
          fix:
            ftsStale || ragStatus.indexedDocuments === 0 ? '运行 lattice rag rebuild' : undefined,
        });

        // 7. --migrate
        if (opts.migrate) {
          const migrated = await runMigrate(username);
          entries.push({
            item: '数据迁移',
            status: 'repaired',
            message:
              `扫描 ${migrated.scannedDirs} 个项目目录；升级 ${migrated.upgradedMeta} 个 legacy 元数据；` +
              `回填 ${migrated.backfilledDb} 个 db 缺失项目`,
          });
        }

        // 8. --rebuild-fingerprints
        if (opts.rebuildFingerprints) {
          let count = 0;
          let failed = 0;
          for (const p of projects) {
            const localPaths = rowLocalPaths(p);
            const candidate = localPaths.find(Boolean);
            if (!candidate) {
              failed++;
              continue;
            }
            try {
              const fp = await collectFingerprint(candidate);
              persistFingerprints(p.id, fp.entries);
              count++;
            } catch {
              failed++;
            }
          }
          entries.push({
            item: '指纹重建',
            status: 'repaired',
            message: `重建 ${count}/${projects.length} 个项目的指纹${failed ? `（${failed} 个失败）` : ''}`,
          });
        }

        // 9. --recheck-scope-paths
        if (opts.recheckScopePaths) {
          const result = await recheckScopePaths(username);
          entries.push({
            item: '任务 scopePaths 复核',
            status: 'repaired',
            message: `检查 ${result.totalTasks} 个任务，提升 ${result.promoted} 个 scopePath 至关联项目`,
          });
        }

        closeDb();
        outputReport(entries, opts.json);
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

/**
 * 迁移：以磁盘 projects/<dir>/project.json 为真源，遍历所有目录
 * - 升级 legacy single-string localPath/gitRemote 为数组形式，升级后删除旧字段
 * - 回填 db 缺失的项目记录（孤儿目录也会被登记）
 */
async function runMigrate(username: string): Promise<{
  scannedDirs: number;
  upgradedMeta: number;
  backfilledDb: number;
}> {
  let scanned = 0;
  let upgraded = 0;
  let backfilled = 0;

  const projectsRoot = getUserProjectsDir(username);
  const dirEntries: string[] = await listDir(projectsRoot).catch(() => []);

  for (const dirName of dirEntries) {
    const metaPath = getProjectMetaPath(username, dirName);
    if (!(await fileExists(metaPath))) continue;
    scanned++;

    try {
      const meta = await readJSON<ProjectMeta>(metaPath);
      if (!meta || !meta.id) continue;

      // legacy 字段一次性迁移：localPath / gitRemote 字符串 → 数组，完成后删除旧字段
      const legacy = meta as unknown as { localPath?: string; gitRemote?: string };
      let changed = false;
      if (!Array.isArray(meta.localPaths) || meta.localPaths.length === 0) {
        meta.localPaths = legacy.localPath ? [legacy.localPath] : [];
        changed = true;
      }
      if (!meta.gitRemotes && legacy.gitRemote) {
        meta.gitRemotes = [legacy.gitRemote];
        changed = true;
      }
      // 任何场景下发现旧字段存在都要清理（不再兼容）
      if (legacy.localPath !== undefined) {
        delete legacy.localPath;
        changed = true;
      }
      if (legacy.gitRemote !== undefined) {
        delete legacy.gitRemote;
        changed = true;
      }
      if (changed) {
        await writeJSON(metaPath, meta);
        upgraded++;
      }

      // 检测 db 是否已有该 id（用 listProjects 已传入会过期，重新查 db 也可以）
      // 简化：每个 project.json 都 upsert，等价于「回填或刷新」
      const beforeRow = listProjects(username).find((p) => p.id === meta.id);
      upsertProject({
        id: meta.id,
        name: meta.name,
        local_path: JSON.stringify(meta.localPaths ?? []),
        description: meta.description ?? null,
        git_remote:
          meta.gitRemotes && meta.gitRemotes.length > 0 ? JSON.stringify(meta.gitRemotes) : null,
        git_first_commit: meta.gitFirstCommit ?? null,
        git_default_branch: meta.gitDefaultBranch ?? null,
        package_names: meta.packageNames?.length ? JSON.stringify(meta.packageNames) : null,
        monorepo_packages: meta.monorepoPackages?.length
          ? JSON.stringify(meta.monorepoPackages)
          : null,
        groups: meta.groups ? JSON.stringify(meta.groups) : null,
        tags: meta.tags ? JSON.stringify(meta.tags) : null,
        username,
        created: meta.created,
        updated: meta.updated ?? null,
      });
      if (!beforeRow) backfilled++;
    } catch {
      // ignore single-project failure
    }
  }

  return {
    scannedDirs: scanned,
    upgradedMeta: upgraded,
    backfilledDb: backfilled,
  };
}

/** scopePaths 复核：若已升格为已注册项目则迁出 */
async function recheckScopePaths(
  username: string,
): Promise<{ totalTasks: number; promoted: number }> {
  let total = 0;
  let promoted = 0;
  let tasks: TaskMeta[];
  try {
    tasks = await listTasks(username);
  } catch {
    return { totalTasks: 0, promoted: 0 };
  }
  for (const t of tasks) {
    total++;
    if (!t.scopePaths || t.scopePaths.length === 0) continue;
    const remaining: ScopePath[] = [];
    const newProjects = new Set(t.projects ?? []);
    let changed = false;
    for (const sp of t.scopePaths) {
      const cands = await findProjectsByPathSmart(sp.path);
      const top = cands[0];
      if (top && top.score >= CONFIDENCE_THRESHOLDS.high) {
        newProjects.add(top.projectId);
        promoted++;
        changed = true;
      } else {
        remaining.push(sp);
      }
    }
    if (changed) {
      await updateTask(username, t.id, {
        projects: [...newProjects],
        scopePaths: remaining,
      });
    }
  }
  return { totalTasks: total, promoted };
}

function outputReport(entries: DoctorEntry[], json: boolean): void {
  if (json) {
    logger.raw(JSON.stringify(entries, null, 2));
    return;
  }

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
