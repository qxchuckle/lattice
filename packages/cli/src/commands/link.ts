import { Command } from 'commander';
import chalk from 'chalk';
import { dirname, resolve as pathResolve, sep } from 'node:path';

import {
  applySpecTemplate,
  getSpecTemplate,
  listSpecTemplates,
  generateProjectId,
  getUsername,
  initDb,
  closeDb,
  collectFingerprint,
  computeProjectIds,
  normalizeLegacyId,
  registerProjectWithIds,
  updateProjectPaths,
  updateProjectMeta,
  findProjectByAnyId,
  getProjectMeta,
  getProjectMetaById,
  selectPrimaryId,
  resolveProjectIds,
  syncProjectIdsToDb,
  upsertRelationFile,
  deleteRelationsByFilter,
  fileExists,
  readJSON,
  writeJSON,
  type ProjectMeta,
  type FingerprintDerived,
  detectAndLinkNestedIn,
} from '@qcqx/lattice-core';
import { logger } from '../utils';

// ─── Debug ───

let _debugEnabled = false;

function debug(msg: string, ...args: unknown[]): void {
  if (_debugEnabled) {
    logger.raw(chalk.gray(`[debug] ${msg}`));
    if (args.length > 0) {
      logger.raw(chalk.gray(JSON.stringify(args)));
    }
  }
}

function setDebug(enabled: boolean): void {
  _debugEnabled = enabled;
}

export function registerLinkCommand(program: Command): void {
  program
    .command('link')
    .description('将当前项目注册到 Lattice（基于 git 指纹 + lattice.json）')
    .option('--name <name>', '手动指定项目名称')
    .option('--description <desc>', '项目描述')
    .option('--groups <groups>', '项目分组（逗号分隔）')
    .option('--tags <tags>', '标签（逗号分隔）')
    .option('--template <templates>', '应用 spec 模板（逗号分隔，或使用 all）')
    .option('--restore <id>', '绑定到已有项目 ID（用于 git 历史不同但确认为同一项目的场景）')
    .option('-y, --yes', '跳过交互确认')
    .action(async (opts) => {
      setDebug(!!opts.debug);
      try {
        const cwd = process.cwd();
        const groups = opts.groups
          ? (opts.groups as string).split(',').map((s: string) => s.trim())
          : undefined;
        const tags = opts.tags
          ? (opts.tags as string).split(',').map((s: string) => s.trim())
          : undefined;

        const username = await getUsername();
        await initDb();

        // ── --restore <id> 分支 ──
        if (opts.restore) {
          await handleRestore(opts.restore as string, cwd, username, opts, groups, tags);
          return;
        }

        // ── 主流程 ──
        // 1. 采集 git 指纹
        const { derived } = await collectFingerprint(cwd);
        debug('fingerprint derived', {
          gitFirstCommit: derived.gitFirstCommit?.slice(0, 16),
          gitRemotes: derived.gitRemotes,
        });

        // 2. 读取已有 lattice.json
        const existingLegacyId = await readLegacyIdFromLatticeJson(cwd);
        debug('existing lattice.json legacyId', existingLegacyId);

        // 3. 计算 IDs（git: + remote: + 已有 legacy:）
        const ids = computeProjectIds(derived, existingLegacyId);
        debug('computed ids', ids);

        if (ids.length === 0) {
          closeDb();
          logger.raw(chalk.yellow('当前目录不是 git 仓库，也没有 lattice.json，无法注册。'));
          logger.raw(
            chalk.dim('  提示：lattice 通过 git 指纹自动识别项目，请确保在 git 仓库中运行。'),
          );
          return;
        }

        // 4. 查 DB 是否已有项目匹配任意 ID
        const existing = findProjectByAnyId(ids);
        debug(
          'findProjectByAnyId result',
          existing ? { id: existing.id, username: existing.username } : null,
        );

        if (existing && existing.username === username) {
          // ── 分支 A：找到当前用户的已注册项目 ──
          const meta = await getProjectMeta(username, existing.id);
          const allIds = meta ? resolveProjectIds(meta) : [existing.id];
          const hasLegacyId = allIds.some((id) => id.startsWith('legacy:'));

          if (hasLegacyId) {
            // ── 分支 A1：有 legacy: ID → 幂等更新元数据，确保 lattice.json 写入该 ID ──
            debug('branch A1: has legacy ID, updating meta');
            await updateProjectPaths(existing.id, username, cwd);

            // 确保 lattice.json 包含 legacy ID
            const legacyId = allIds.find((id) => id.startsWith('legacy:'));
            if (legacyId) {
              await ensureLatticeJson(cwd, legacyId);
            }

            if (opts.name || opts.description || groups || tags) {
              await updateProjectMeta(username, existing.id, {
                ...(opts.name ? { name: opts.name } : {}),
                ...(opts.description ? { description: opts.description } : {}),
                ...(groups ? { groups } : {}),
                ...(tags ? { tags } : {}),
              });
            }

            await applyTemplatesIfRequested(username, existing.id, opts.template);
            const parentRelations = await detectAndLinkNestedIn(username, existing.id, cwd);
            closeDb();

            const updatedMeta = await getProjectMeta(username, existing.id);
            logger.raw(chalk.yellow('当前目录已注册为 Lattice 项目，已更新项目元数据'));
            printProjectInfo(updatedMeta, existing.id, cwd, derived);
            printParentRelations(parentRelations);
            return;
          }

          // ── 分支 A2：无 legacy: ID → 不修改原项目，新建项目 ──
          debug('branch A2: no legacy ID, creating new project with lattice.json');

          // 如果 lattice.json 已存在，用其中的 legacy ID；否则生成新的
          let normalizedLegacyId = existingLegacyId;
          if (!normalizedLegacyId) {
            const newLegacyId = generateProjectId(cwd);
            normalizedLegacyId = normalizeLegacyId(newLegacyId);
            // 写入 lattice.json
            await writeJSON(pathResolve(cwd, 'lattice.json'), { id: newLegacyId });
            debug('wrote new lattice.json', { id: newLegacyId });
          }
          // lattice.json 已存在时，legacy ID 已在其中，不需要重复写入

          // 新建项目（含 legacy: + git: + remote:）
          // 不修改原项目，新项目通过虚拟合并关联原项目的任务和 spec
          const newIds = computeProjectIds(derived, normalizedLegacyId);
          const newMeta = await registerProjectWithIds(username, newIds, cwd, derived);

          // 应用元数据更新
          let finalMeta = newMeta;
          if (opts.name || opts.description || groups || tags) {
            const primaryId = selectPrimaryId(newMeta.ids) ?? newMeta.ids[0];
            finalMeta =
              (await updateProjectMeta(username, primaryId, {
                ...(opts.name ? { name: opts.name } : {}),
                ...(opts.description ? { description: opts.description } : {}),
                ...(groups ? { groups } : {}),
                ...(tags ? { tags } : {}),
              })) ?? newMeta;
          }

          await applyTemplatesIfRequested(
            username,
            selectPrimaryId(finalMeta.ids) ?? finalMeta.ids[0],
            opts.template,
          );
          const primaryId = selectPrimaryId(finalMeta.ids) ?? finalMeta.ids[0];
          const parentRelations = await detectAndLinkNestedIn(username, primaryId, cwd);
          closeDb();

          logger.raw(chalk.green('✓ 项目已注册到 Lattice（新建，原项目通过虚拟合并关联）'));
          printProjectInfo(finalMeta, primaryId, cwd, derived);
          printParentRelations(parentRelations);
          return;
        }

        // ── 分支 B：未找到 或 其他用户的项目 → 新建项目 ──
        debug('branch B: not found or other user, creating new project');

        // 生成 legacy ID（如果 lattice.json 不存在）
        let legacyId = existingLegacyId;
        if (!legacyId) {
          const newLegacyId = generateProjectId(cwd);
          legacyId = normalizeLegacyId(newLegacyId);
          // 写入 lattice.json
          await writeJSON(pathResolve(cwd, 'lattice.json'), { id: newLegacyId });
          debug('wrote new lattice.json', { id: newLegacyId });
        }

        // 计算完整 IDs
        const newIds = computeProjectIds(derived, legacyId);
        const newMeta = await registerProjectWithIds(username, newIds, cwd, derived);

        // 应用元数据更新
        let finalMeta = newMeta;
        if (opts.name || opts.description || groups || tags) {
          const primaryId = selectPrimaryId(newMeta.ids) ?? newMeta.ids[0];
          finalMeta =
            (await updateProjectMeta(username, primaryId, {
              ...(opts.name ? { name: opts.name } : {}),
              ...(opts.description ? { description: opts.description } : {}),
              ...(groups ? { groups } : {}),
              ...(tags ? { tags } : {}),
            })) ?? newMeta;
        }

        await applyTemplatesIfRequested(
          username,
          selectPrimaryId(finalMeta.ids) ?? finalMeta.ids[0],
          opts.template,
        );
        const primaryId = selectPrimaryId(finalMeta.ids) ?? finalMeta.ids[0];
        const parentRelations = await detectAndLinkNestedIn(username, primaryId, cwd);
        closeDb();

        logger.raw(chalk.green('✓ 项目已注册到 Lattice'));
        printProjectInfo(finalMeta, primaryId, cwd, derived);
        printParentRelations(parentRelations);
      } catch (err) {
        debug('link error', (err as Error).message);
        console.error(chalk.red('注册失败：'), (err as Error).message);
        if (_debugEnabled && (err as Error).stack) {
          console.error(chalk.gray((err as Error).stack));
        }
        process.exitCode = 1;
      }
    });
}

// ── --restore 分支 ──

async function handleRestore(
  restoreId: string,
  cwd: string,
  username: string,
  opts: { name?: string; description?: string; template?: string },
  groups: string[] | undefined,
  tags: string[] | undefined,
): Promise<void> {
  const target = findProjectByAnyId([restoreId]);
  if (!target) {
    closeDb();
    logger.raw(chalk.red(`未找到项目：${restoreId}`));
    process.exitCode = 1;
    return;
  }

  debug('restore: target found', { id: target.id, username: target.username });

  // 采集当前目录指纹，合并 IDs
  const { derived } = await collectFingerprint(cwd);
  const legacyId = await readLegacyIdFromLatticeJson(cwd);
  const currentIds = computeProjectIds(derived, legacyId);

  // 合并目标项目的 IDs 和当前目录的 IDs
  const targetMeta = await getProjectMeta(username, target.id);
  const targetIds = targetMeta ? resolveProjectIds(targetMeta) : [target.id];
  const mergedIdSet = new Set([...targetIds, ...currentIds, target.id]);

  // 更新目标项目的 localPaths
  await updateProjectPaths(target.id, username, cwd);
  // 同步合并后的 IDs 到 DB
  syncProjectIdsToDb(target.id, [...mergedIdSet]);

  // 确保 lattice.json 包含 legacy ID（如果有）
  const targetLegacyId = [...mergedIdSet].find((id) => id.startsWith('legacy:'));
  if (targetLegacyId) {
    const rawId = targetLegacyId.replace(/^legacy:/, '');
    await writeJSON(pathResolve(cwd, 'lattice.json'), { id: rawId });
    debug('restore: wrote lattice.json', { id: rawId });
  }

  // 应用元数据更新
  if (opts.name || opts.description || groups || tags) {
    await updateProjectMeta(username, target.id, {
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.description ? { description: opts.description } : {}),
      ...(groups ? { groups } : {}),
      ...(tags ? { tags } : {}),
    });
  }

  await applyTemplatesIfRequested(username, target.id, opts.template);
  const parentRelations = await detectAndLinkNestedIn(username, target.id, cwd);
  closeDb();

  const finalMeta = await getProjectMeta(username, target.id);
  logger.raw(chalk.green(`✓ 已将当前目录关联到项目：${finalMeta?.name ?? target.id}`));
  printProjectInfo(finalMeta, target.id, cwd, derived);
  printParentRelations(parentRelations);
}

// ─── 辅助函数 ───

/** 读取 lattice.json 中的 id */
async function readLegacyIdFromLatticeJson(dir: string): Promise<string | null> {
  try {
    const latticeJsonPath = pathResolve(dir, 'lattice.json');
    if (!(await fileExists(latticeJsonPath))) return null;
    const data = await readJSON<{ id?: string }>(latticeJsonPath);
    if (!data?.id) return null;
    return normalizeLegacyId(data.id);
  } catch (err) {
    debug('readLegacyIdFromLatticeJson error', (err as Error).message);
    return null;
  }
}

/** 确保 lattice.json 存在且包含指定的 legacy ID */
async function ensureLatticeJson(dir: string, legacyId: string): Promise<void> {
  try {
    const latticeJsonPath = pathResolve(dir, 'lattice.json');
    const rawId = legacyId.replace(/^legacy:/, '');

    // 如果已存在且 id 一致，不需要写入
    if (await fileExists(latticeJsonPath)) {
      const data = await readJSON<{ id?: string }>(latticeJsonPath);
      if (data?.id === rawId || normalizeLegacyId(data?.id ?? '') === legacyId) return;
    }

    await writeJSON(latticeJsonPath, { id: rawId });
    debug('ensureLatticeJson: wrote', { id: rawId });
  } catch (err) {
    debug('ensureLatticeJson error', (err as Error).message);
  }
}

/** 应用 spec 模板（如果指定了 --template） */
async function applyTemplatesIfRequested(
  username: string,
  projectId: string,
  templateOpt: string | undefined,
): Promise<void> {
  if (!templateOpt) return;

  try {
    const templateNames = await resolveTemplateNames(templateOpt);
    if (templateNames.length === 0) {
      logger.raw(chalk.yellow('未匹配到任何可用模板。'));
      return;
    }

    for (const templateName of templateNames) {
      const filePath = await applySpecTemplate(username, projectId, templateName);
      if (filePath) {
        logger.raw(chalk.dim(`  模板：${filePath}`));
      }
    }
  } catch (err) {
    debug('applyTemplatesIfRequested error', (err as Error).message);
    throw err;
  }
}

async function resolveTemplateNames(input: string): Promise<string[]> {
  const raw = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (raw.length === 1 && raw[0] === 'all') {
    const templates = await listSpecTemplates();
    return templates.map((template) => template.name);
  }

  const validNames: string[] = [];
  for (const name of raw) {
    const template = await getSpecTemplate(name);
    if (!template) {
      throw new Error(
        `未找到模板：${name}。可先运行 lattice spec template sync-builtins 或 lattice spec template list 查看可用模板。`,
      );
    }
    validNames.push(template.name);
  }

  return [...new Set(validNames)];
}

interface ParentRelationResult {
  id: string;
  name: string;
  type: 'direct' | 'ancestor';
}

// detectAndLinkNestedIn 已下沉到 core（nested-in.ts），link.ts 直接调用 core 导出

function printProjectInfo(
  meta: ProjectMeta | null,
  primaryId: string,
  cwd: string,
  derived: FingerprintDerived,
): void {
  logger.raw(chalk.dim(`  名称：${meta?.name ?? primaryId}`));
  logger.raw(chalk.dim(`  ID：${primaryId}`));
  if (meta?.ids && meta.ids.length > 1) {
    logger.raw(chalk.dim(`  IDs：${meta.ids.join(', ')}`));
  }
  logger.raw(chalk.dim(`  路径：${cwd}`));
  if (derived.gitRemotes.length > 0) {
    logger.raw(chalk.dim(`  Git：${derived.gitRemotes.join(', ')}`));
  }
}

function printParentRelations(parents: ParentRelationResult[]): void {
  if (parents.length > 0) {
    logger.raw(chalk.cyan(`\n✓ 检测到嵌套项目关系：`));
    for (const r of parents) {
      logger.raw(chalk.dim(`  ← ${r.name} (${r.type === 'direct' ? '直接父级' : '祖先'})`));
    }
  }
}
