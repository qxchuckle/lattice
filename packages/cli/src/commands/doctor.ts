import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  isInitialized,
  initDb,
  closeDb,
  listProjects,
  listTasks,
  getTaskMeta,
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
  getTaskMetaPath,
  upsertProject,
  deleteProject,
  listDir,
  listRelations,
  deleteRelationsByProject,
} from '@qcqx/lattice-core';
import type { DoctorEntry, ProjectRow, TaskMeta, ScopePath, ProjectMeta } from '@qcqx/lattice-core';
import { join } from 'node:path';
import { logger, outputJson } from '../utils';

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
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
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
          outputReport(entries, opts.json, opts.jsonFormat);
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

        // 5.1 磁盘/数据库一致性检查
        const consistencyResult = await checkDiskDbConsistency(username, projects, opts.fix);
        entries.push(...consistencyResult.entries);
        // --fix 回填后刷新 projects 列表供后续使用
        if (consistencyResult.backfilled > 0) {
          // 重新获取列表（db 已更新）
          const refreshed = listProjects(username);
          projects.length = 0;
          projects.push(...refreshed);
        }

        // 5.2 重复项目检测（同一 localPath 被多个项目 ID 引用）
        const duplicateEntries = checkDuplicateProjects(projects);
        entries.push(...duplicateEntries);

        // 5.3 lattice.json 引用一致性（项目 localPath 下的 lattice.json id 与注册 id 是否匹配）
        const latticeJsonEntries = await checkLatticeJsonConsistency(projects);
        entries.push(...latticeJsonEntries);

        // 5.4 数据库字段漂移检测（db 记录 vs project.json 真源）
        const driftResult = await checkDbFieldDrift(username, projects, opts.fix);
        entries.push(...driftResult.entries);

        // 5.5 任务关联项目有效性检测
        const taskAssocEntries = await checkTaskProjectAssociations(username, projects, opts.fix);
        entries.push(...taskAssocEntries);

        // 5.6 任务父子链有效性
        const parentChainEntries = await checkTaskParentChain(username, opts.fix);
        entries.push(...parentChainEntries);

        // 5.7 项目关系有效性
        const relationsEntries = await checkRelationsValidity(username, projects, opts.fix);
        entries.push(...relationsEntries);

        // 5.8 孤立任务目录
        const orphanTaskEntries = await checkOrphanedTaskDirs(username);
        entries.push(...orphanTaskEntries);

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
        outputReport(entries, opts.json, opts.jsonFormat);
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

// ─── 5.1 磁盘/数据库一致性检查 ───

async function checkDiskDbConsistency(
  username: string,
  dbProjects: ProjectRow[],
  fix?: boolean,
): Promise<{ entries: DoctorEntry[]; backfilled: number }> {
  const entries: DoctorEntry[] = [];
  let diskOnlyCount = 0;
  let dbOnlyCount = 0;
  let backfilled = 0;

  const projectsRoot = getUserProjectsDir(username);
  const dirEntries: string[] = await listDir(projectsRoot).catch(() => []);

  // 收集磁盘上所有 project.json 的 id
  const diskProjectIds = new Map<string, string>(); // id → dirName
  for (const dirName of dirEntries) {
    if (dirName.startsWith('.')) continue;
    const metaPath = getProjectMetaPath(username, dirName);
    if (!(await fileExists(metaPath))) continue;
    const meta = await readJSON<ProjectMeta>(metaPath);
    if (meta?.id) {
      diskProjectIds.set(meta.id, dirName);
    }
  }

  // 数据库中有哪些项目 ID
  const dbProjectIds = new Set(dbProjects.map((p) => p.id));

  // 磁盘有但数据库无
  const missingInDb: string[] = [];
  for (const [id] of diskProjectIds) {
    if (!dbProjectIds.has(id)) {
      missingInDb.push(id);
      diskOnlyCount++;
    }
  }

  // 数据库有但磁盘无
  const missingOnDisk: string[] = [];
  for (const p of dbProjects) {
    if (!diskProjectIds.has(p.id)) {
      missingOnDisk.push(p.id);
      dbOnlyCount++;
    }
  }

  // --fix: 回填磁盘有但 db 无的项目
  if (fix && missingInDb.length > 0) {
    for (const id of missingInDb) {
      const dirName = diskProjectIds.get(id)!;
      const meta = await readJSON<ProjectMeta>(getProjectMetaPath(username, dirName));
      if (!meta) continue;
      try {
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
        backfilled++;
      } catch {
        // ignore
      }
    }
  }

  // --fix: 清理数据库中磁盘已无对应 project.json 的记录
  if (fix && missingOnDisk.length > 0) {
    for (const id of missingOnDisk) {
      try {
        deleteProject(id, username);
      } catch {
        // ignore
      }
    }
  }

  const total = diskOnlyCount + dbOnlyCount;
  if (total === 0) {
    entries.push({
      item: '磁盘/数据库一致性',
      status: 'healthy',
      message: `磁盘 ${diskProjectIds.size} 个项目与数据库完全一致`,
    });
  } else {
    const parts: string[] = [];
    if (diskOnlyCount > 0) parts.push(`${diskOnlyCount} 个磁盘项目未同步到数据库`);
    if (dbOnlyCount > 0) parts.push(`${dbOnlyCount} 个数据库记录在磁盘无对应`);
    entries.push({
      item: '磁盘/数据库一致性',
      status: fix ? 'repaired' : 'stale',
      message: fix
        ? `已修复：回填 ${backfilled} 个项目到数据库${dbOnlyCount > 0 ? `，清理 ${dbOnlyCount} 个悬空记录` : ''}`
        : parts.join('；'),
      fix: fix
        ? undefined
        : '运行 lattice doctor --fix 自动修复，或 lattice doctor --migrate 手动迁移',
    });
  }

  return { entries, backfilled };
}

// ─── 5.2 重复项目检测 ───

function checkDuplicateProjects(projects: ProjectRow[]): DoctorEntry[] {
  const entries: DoctorEntry[] = [];

  // 检测同一 localPath 被多个项目引用
  const pathToProjects = new Map<string, { id: string; name: string }[]>();
  for (const p of projects) {
    const paths = parseJsonArray(p.local_path);
    for (const path of paths) {
      if (!pathToProjects.has(path)) pathToProjects.set(path, []);
      pathToProjects.get(path)!.push({ id: p.id, name: p.name });
    }
  }

  const duplicatePaths: { path: string; projects: { id: string; name: string }[] }[] = [];
  for (const [path, projs] of pathToProjects) {
    if (projs.length > 1) {
      duplicatePaths.push({ path, projects: projs });
    }
  }

  if (duplicatePaths.length === 0) {
    entries.push({
      item: '重复项目检测',
      status: 'healthy',
      message: '无重复路径引用',
    });
  } else {
    const detail = duplicatePaths
      .map((d) => `${d.path} \u2192 ${d.projects.map((p) => `${p.name}(${p.id})`).join(', ')}`)
      .join('；');
    entries.push({
      item: '重复项目检测',
      status: 'stale',
      message: `${duplicatePaths.length} 个路径被多个项目引用：${detail}`,
      fix: '使用 lattice project remove <id> -f 移除重复项目',
    });
  }

  return entries;
}

// ─── 5.3 lattice.json 引用一致性 ───

async function checkLatticeJsonConsistency(projects: ProjectRow[]): Promise<DoctorEntry[]> {
  const entries: DoctorEntry[] = [];
  const mismatches: {
    localPath: string;
    latticeJsonId: string;
    registeredId: string;
    registeredName: string;
  }[] = [];

  for (const p of projects) {
    const paths = parseJsonArray(p.local_path);
    for (const localPath of paths) {
      if (!(await dirExists(localPath))) continue;
      const latticeJsonPath = join(localPath, 'lattice.json');
      if (!(await fileExists(latticeJsonPath))) continue;
      const data = await readJSON<{ id?: string }>(latticeJsonPath);
      if (!data?.id) continue;
      if (data.id !== p.id) {
        mismatches.push({
          localPath,
          latticeJsonId: data.id,
          registeredId: p.id,
          registeredName: p.name,
        });
      }
    }
  }

  if (mismatches.length === 0) {
    entries.push({
      item: 'lattice.json 引用一致性',
      status: 'healthy',
      message: '所有可达项目目录的 lattice.json 与注册 ID 一致',
    });
  } else {
    const detail = mismatches
      .slice(0, 3)
      .map(
        (m) =>
          `${m.localPath}/lattice.json \u5f15\u7528 ${m.latticeJsonId} \u4f46\u76ee\u5f55\u6ce8\u518c\u4e3a ${m.registeredName}(${m.registeredId})`,
      )
      .join('；');
    const fixHint = mismatches
      .slice(0, 2)
      .map(
        (m) =>
          `保留 ${m.latticeJsonId} → lattice project remove ${m.registeredId} -f；` +
          `保留 ${m.registeredId} → 修改 ${m.localPath}/lattice.json 的 id`,
      )
      .join('。');
    entries.push({
      item: 'lattice.json 引用一致性',
      status: 'stale',
      message: `${mismatches.length} 个不一致：${detail}${mismatches.length > 3 ? '…' : ''}`,
      fix: fixHint,
    });
  }

  return entries;
}

// ─── 5.4 数据库字段漂移检测 ───

async function checkDbFieldDrift(
  username: string,
  projects: ProjectRow[],
  fix?: boolean,
): Promise<{ entries: DoctorEntry[] }> {
  const entries: DoctorEntry[] = [];
  let driftCount = 0;
  let fixedCount = 0;

  for (const p of projects) {
    const meta = await getProjectMeta(username, p.id);
    if (!meta) continue;

    // 比较关键字段
    const metaLocalPath = JSON.stringify(meta.localPaths ?? []);
    const metaGitRemote =
      meta.gitRemotes && meta.gitRemotes.length > 0 ? JSON.stringify(meta.gitRemotes) : null;
    const metaPackageNames = meta.packageNames?.length ? JSON.stringify(meta.packageNames) : null;
    const metaMonorepoPackages = meta.monorepoPackages?.length
      ? JSON.stringify(meta.monorepoPackages)
      : null;

    const hasDrift =
      p.name !== meta.name ||
      p.local_path !== metaLocalPath ||
      (p.description ?? null) !== (meta.description ?? null) ||
      (p.git_remote ?? null) !== (metaGitRemote ?? null) ||
      (p.git_first_commit ?? null) !== (meta.gitFirstCommit ?? null) ||
      (p.git_default_branch ?? null) !== (meta.gitDefaultBranch ?? null) ||
      (p.package_names ?? null) !== (metaPackageNames ?? null) ||
      (p.monorepo_packages ?? null) !== (metaMonorepoPackages ?? null);

    if (hasDrift) {
      driftCount++;
      if (fix) {
        try {
          upsertProject({
            id: meta.id,
            name: meta.name,
            local_path: metaLocalPath,
            description: meta.description ?? null,
            git_remote: metaGitRemote,
            git_first_commit: meta.gitFirstCommit ?? null,
            git_default_branch: meta.gitDefaultBranch ?? null,
            package_names: metaPackageNames,
            monorepo_packages: metaMonorepoPackages,
            groups: meta.groups ? JSON.stringify(meta.groups) : null,
            tags: meta.tags ? JSON.stringify(meta.tags) : null,
            username,
            created: meta.created,
            updated: meta.updated ?? null,
          });
          fixedCount++;
        } catch {
          // ignore
        }
      }
    }
  }

  if (driftCount === 0) {
    entries.push({
      item: '数据库字段同步',
      status: 'healthy',
      message: '数据库记录与 project.json 真源一致',
    });
  } else {
    entries.push({
      item: '数据库字段同步',
      status: fix ? 'repaired' : 'stale',
      message: fix
        ? `已修复 ${fixedCount}/${driftCount} 个项目的数据库字段漂移`
        : `${driftCount} 个项目的数据库记录与 project.json 不一致`,
      fix: fix ? undefined : '运行 lattice doctor --fix 从 project.json 真源刷新数据库',
    });
  }

  return { entries };
}

// ─── 5.5 任务关联项目有效性检测 ───

async function checkTaskProjectAssociations(
  username: string,
  validProjects: ProjectRow[],
  fix?: boolean,
): Promise<DoctorEntry[]> {
  const entries: DoctorEntry[] = [];
  const validIds = new Set(validProjects.map((p) => p.id));

  let tasks: TaskMeta[];
  try {
    tasks = await listTasks(username);
  } catch {
    return entries;
  }

  const invalidRefs: { taskId: string; taskTitle: string; deadIds: string[] }[] = [];

  for (const t of tasks) {
    if (!t.projects || t.projects.length === 0) continue;
    const dead = t.projects.filter((pid) => !validIds.has(pid));
    if (dead.length > 0) {
      invalidRefs.push({ taskId: t.id, taskTitle: t.title, deadIds: dead });
    }
  }

  if (invalidRefs.length === 0) {
    entries.push({
      item: '任务关联项目有效性',
      status: 'healthy',
      message: '所有任务关联的项目 ID 均有效',
    });
  } else {
    if (fix) {
      let fixedCount = 0;
      for (const ref of invalidRefs) {
        const meta = await getTaskMeta(username, ref.taskId);
        if (!meta) continue;
        const cleaned = (meta.projects ?? []).filter((pid) => validIds.has(pid));
        await updateTask(username, ref.taskId, { projects: cleaned });
        fixedCount++;
      }
      entries.push({
        item: '任务关联项目有效性',
        status: 'repaired',
        message: `已从 ${fixedCount} 个任务中移除失效的项目关联`,
      });
    } else {
      const detail = invalidRefs
        .slice(0, 3)
        .map((r) => `${r.taskTitle} 引用了不存在的项目 ${r.deadIds.join(', ')}`)
        .join('；');
      entries.push({
        item: '任务关联项目有效性',
        status: 'stale',
        message: `${invalidRefs.length} 个任务关联了已不存在的项目：${detail}${invalidRefs.length > 3 ? '…' : ''}`,
        fix: '运行 lattice doctor --fix 自动移除失效关联，或手动 lattice task update <taskId> --project <新ID>',
      });
    }
  }

  return entries;
}

// ─── 5.6 任务父子链有效性 ───

async function checkTaskParentChain(username: string, fix?: boolean): Promise<DoctorEntry[]> {
  const entries: DoctorEntry[] = [];

  let tasks: TaskMeta[];
  try {
    tasks = await listTasks(username);
  } catch {
    return entries;
  }

  const taskIds = new Set(tasks.map((t) => t.id));
  const dangling: { taskId: string; taskTitle: string; parentId: string }[] = [];

  for (const t of tasks) {
    if (!t.parentTaskId) continue;
    if (!taskIds.has(t.parentTaskId)) {
      dangling.push({ taskId: t.id, taskTitle: t.title, parentId: t.parentTaskId });
    }
  }

  if (dangling.length === 0) {
    entries.push({
      item: '任务父子链有效性',
      status: 'healthy',
      message: '所有任务的 parentTaskId 均指向有效任务',
    });
  } else {
    if (fix) {
      let fixedCount = 0;
      for (const d of dangling) {
        await updateTask(username, d.taskId, { parentTaskId: '' });
        fixedCount++;
      }
      entries.push({
        item: '任务父子链有效性',
        status: 'repaired',
        message: `已清除 ${fixedCount} 个任务的悬空 parentTaskId`,
      });
    } else {
      const detail = dangling
        .slice(0, 3)
        .map((d) => `${d.taskTitle} 的父任务 ${d.parentId} 已不存在`)
        .join('；');
      entries.push({
        item: '任务父子链有效性',
        status: 'stale',
        message: `${dangling.length} 个任务的 parentTaskId 指向已删除的任务：${detail}${dangling.length > 3 ? '…' : ''}`,
        fix: '运行 lattice doctor --fix 自动清除悬空的父任务引用',
      });
    }
  }

  return entries;
}

// ─── 5.7 项目关系有效性 ───

async function checkRelationsValidity(
  username: string,
  validProjects: ProjectRow[],
  fix?: boolean,
): Promise<DoctorEntry[]> {
  const entries: DoctorEntry[] = [];
  const validIds = new Set(validProjects.map((p) => p.id));

  let relations;
  try {
    relations = await listRelations(username);
  } catch {
    return entries;
  }

  const orphaned = relations.filter((r) => !validIds.has(r.projectA) || !validIds.has(r.projectB));

  if (orphaned.length === 0) {
    entries.push({
      item: '项目关系有效性',
      status: 'healthy',
      message: relations.length === 0 ? '无项目关系' : `${relations.length} 条关系全部有效`,
    });
  } else {
    if (fix) {
      // 收集涉及的无效项目 ID，通过 deleteRelationsByProject 清理
      const deadIds = new Set<string>();
      for (const r of orphaned) {
        if (!validIds.has(r.projectA)) deadIds.add(r.projectA);
        if (!validIds.has(r.projectB)) deadIds.add(r.projectB);
      }
      let removed = 0;
      for (const id of deadIds) {
        removed += await deleteRelationsByProject(username, id);
      }
      entries.push({
        item: '项目关系有效性',
        status: 'repaired',
        message: `已移除 ${removed} 条引用已删除项目的关系`,
      });
    } else {
      const deadIds = new Set<string>();
      for (const r of orphaned) {
        if (!validIds.has(r.projectA)) deadIds.add(r.projectA);
        if (!validIds.has(r.projectB)) deadIds.add(r.projectB);
      }
      entries.push({
        item: '项目关系有效性',
        status: 'stale',
        message: `${orphaned.length} 条关系引用了已不存在的项目（${[...deadIds].join(', ')}）`,
        fix: '运行 lattice doctor --fix 自动清理涉及已删除项目的关系',
      });
    }
  }

  return entries;
}

// ─── 5.8 孤立任务目录 ───

async function checkOrphanedTaskDirs(username: string): Promise<DoctorEntry[]> {
  const entries: DoctorEntry[] = [];
  const tasksDir = getUserTasksDir(username);

  let dirEntries: string[];
  try {
    dirEntries = await listDir(tasksDir);
  } catch {
    return entries;
  }

  const orphaned: string[] = [];
  for (const dirName of dirEntries) {
    if (dirName.startsWith('.')) continue; // 跳过隐藏文件如 .DS_Store
    const metaPath = getTaskMetaPath(username, dirName);
    if (!(await fileExists(metaPath))) {
      orphaned.push(dirName);
    }
  }

  if (orphaned.length === 0) {
    entries.push({
      item: '任务目录完整性',
      status: 'healthy',
      message: `${dirEntries.length} 个任务目录均有有效的 task.json`,
    });
  } else {
    entries.push({
      item: '任务目录完整性',
      status: 'stale',
      message: `${orphaned.length} 个任务目录缺少 task.json：${orphaned.slice(0, 3).join('、')}${orphaned.length > 3 ? '…' : ''}`,
      fix: '手动检查并清理无效目录，或恢复缺失的 task.json',
    });
  }

  return entries;
}

function outputReport(entries: DoctorEntry[], json: boolean, jsonFormat?: boolean): void {
  if (json) {
    outputJson(entries, jsonFormat);
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
