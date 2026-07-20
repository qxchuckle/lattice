import { Command } from 'commander';
import chalk from 'chalk';
import { resolve as pathResolve } from 'node:path';
import { confirm } from '@inquirer/prompts';
import {
  getUsername,
  listProjects,
  findProjectById,
  resolveProjectById,
  getAllUniqueRelations,
  parseProjectRow,
  getProjectMeta,
  updateProjectMeta,
  unregisterProject,
  initDb,
  closeDb,
  getTasksForProject,
  getRelationsByProject,
  getRelationsByProjectCrossUser,
  listRelationsCrossUser,
  listAllUsernames,
  upsertRelationFile,
  deleteRelationFile,
  listRelations,
  findProjectByPath,
  normalizeLocalPath,
  isPathPrefixOf,
  dirExists,
  mergeProjects,
  searchProjects,
  checkProfiles,
  checkSingleProfile,
  markProfileDone,
  readProfileTags,
  writeProfileTags,
  addProfileTags,
  removeProfileTags,
  getProfileShow,
  getProfileDirPath,
  getProfileBrief,
  updateRagIndex,
} from '@qcqx/lattice-core';
import type { ProjectRow, RelationWithSource, ProjectMatchProvenance } from '@qcqx/lattice-core';
import { logger, outputJson, shouldSkipConfirm } from '../utils';

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

function rowGitRemotes(row: ProjectRow): string[] {
  return parseJsonArray(row.git_remote);
}

export function registerProjectCommand(program: Command): void {
  const cmd = program.command('project').description('管理已注册的项目');

  // ─── list ───
  cmd
    .command('list')
    .alias('ls')
    .description('列出所有已注册项目')
    .option('--group <group>', '按分组过滤')
    .option('--tag <tag>', '按标签过滤')
    .option(
      '--search <keyword>',
      '按关键词搜索（名称/ID/路径/Git/包名/分组/标签），默认附带语义搜索',
    )
    .option('--keyword-only', '仅使用关键词匹配，跳过语义搜索')
    .option('--has-git', '只显示含 git remote 的项目')
    .option('--orphaned', '只显示所有 localPath 都已失效的项目')
    .option('--with-relations', '附带显示项目关系')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        let projects: ProjectRow[];
        let semanticFallback = false;
        let matchProvenance: Record<string, ProjectMatchProvenance> = {};

        if (opts.search) {
          const searchResult = await searchProjects([username], opts.search, {
            group: opts.group,
            tag: opts.tag,
            keywordOnly: opts.keywordOnly,
          });
          projects = searchResult.projects;
          semanticFallback = searchResult.semanticFallback;
          matchProvenance = searchResult.matchProvenance;
        } else {
          projects = listProjects(username, {
            group: opts.group,
            tag: opts.tag,
          });
        }

        // --has-git 过滤
        if (opts.hasGit) {
          projects = projects.filter((p) => rowGitRemotes(p).length > 0);
        }

        // --orphaned 过滤：所有 localPaths 都不存在
        if (opts.orphaned) {
          const filtered: typeof projects = [];
          for (const p of projects) {
            const paths = rowLocalPaths(p);
            if (paths.length === 0) {
              filtered.push(p);
              continue;
            }
            let anyExists = false;
            for (const path of paths) {
              if (await dirExists(path)) {
                anyExists = true;
                break;
              }
            }
            if (!anyExists) filtered.push(p);
          }
          projects = filtered;
        }

        // 收集关系信息（relations.json 真源）
        const relationsMap = new Map<
          string,
          { id: string; projectA: string; projectB: string; type: string; description?: string }[]
        >();
        if (opts.withRelations) {
          for (const p of projects) {
            const rels = await getRelationsByProject(username, p.id);
            relationsMap.set(p.id, rels);
          }
        }

        closeDb();

        if (opts.json) {
          const result = projects.map((p) => ({
            ...p,
            localPaths: rowLocalPaths(p),
            gitRemotes: rowGitRemotes(p),
            packageNames: parseJsonArray(p.package_names),
            monorepoPackages: parseJsonArray(p.monorepo_packages),
            matchedVia: matchProvenance[p.id] ?? null,
            ...(opts.withRelations ? { relations: relationsMap.get(p.id) ?? [] } : {}),
          }));
          outputJson(result, opts.jsonFormat);
          return;
        }

        if (projects.length === 0) {
          logger.raw(chalk.dim('暂无符合条件的项目。使用 lattice link 注册项目。'));
          if (opts.search && opts.keywordOnly) {
            logger.raw(chalk.dim('  提示：尝试去掉 --keyword-only 以启用语义搜索。'));
          }
          return;
        }

        if (semanticFallback) {
          const hasIndirect = projects.some((p) => matchProvenance[p.id]);
          logger.raw(
            chalk.yellow(
              hasIndirect
                ? '关键词未匹配，以下为语义搜索结果（含通过任务文档反查的项目）：\n'
                : '关键词未匹配，以下为语义搜索结果：\n',
            ),
          );
        }
        logger.raw(chalk.blue(`共 ${projects.length} 个项目：\n`));
        for (const p of projects) {
          const { parsedGroups: groups, parsedTags: tags } = parseProjectRow(p);
          const localPaths = rowLocalPaths(p);
          const gitRemotes = rowGitRemotes(p);
          const pkgNames = parseJsonArray(p.package_names);
          logger.raw(`  ${chalk.bold(p.name)} ${chalk.dim(`(${p.id})`)}`);
          const provenance = matchProvenance[p.id];
          if (provenance) {
            logger.raw(
              `    ${chalk.cyan('匹配来源：')}${provenance.docType} - ${provenance.docTitle}`,
            );
          }
          if (localPaths.length === 0) {
            logger.raw(`    ${chalk.dim('(无路径记录)')}`);
          } else if (localPaths.length === 1) {
            logger.raw(`    ${chalk.dim(localPaths[0])}`);
          } else {
            logger.raw(`    ${chalk.cyan('路径：')}${localPaths.length} 个`);
            for (const path of localPaths) {
              logger.raw(`      ${chalk.dim(path)}`);
            }
          }
          if (gitRemotes.length) {
            logger.raw(`    ${chalk.cyan('Git：')}${gitRemotes.join(', ')}`);
          }
          if (pkgNames.length) {
            logger.raw(`    ${chalk.cyan('Package：')}${pkgNames.join(', ')}`);
          }
          if (groups.length) logger.raw(`    ${chalk.cyan('分组：')}${groups.join(', ')}`);
          if (tags.length) logger.raw(`    ${chalk.cyan('标签：')}${tags.join(', ')}`);
          if (opts.withRelations) {
            const relations = relationsMap.get(p.id) ?? [];
            if (relations.length > 0) {
              const relStrs = relations.map((r) => {
                const otherId = r.projectA === p.id ? r.projectB : r.projectA;
                const other = projects.find((pp) => pp.id === otherId);
                return `${other?.name ?? otherId}(${r.type})`;
              });
              logger.raw(`    ${chalk.cyan('关系：')}${relStrs.join(', ')}`);
            }
          }
          logger.raw('');
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── info ───
  cmd
    .command('info <id>')
    .description('查看项目详情')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const row = findProjectById(id);
        if (!row) {
          // 尝试前缀匹配
          const match = resolveProjectById(username, id);
          if (!match) {
            logger.raw(chalk.yellow(`未找到项目：${id}`));
            closeDb();
            return;
          }
          id = match.id;
        }

        const meta = await getProjectMeta(username, id);
        const relations = await getRelationsByProject(username, id);
        const taskIds = getTasksForProject(id);

        closeDb();

        if (opts.json) {
          outputJson({ meta, relations, taskIds }, opts.jsonFormat);
          return;
        }

        if (!meta) {
          logger.raw(chalk.yellow('项目元数据不存在'));
          return;
        }

        logger.raw(chalk.bold(`\n${meta.name}`));
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(`  ID：${meta.id}`);
        if (meta.localPaths?.length) {
          if (meta.localPaths.length === 1) {
            logger.raw(`  路径：${meta.localPaths[0]}`);
          } else {
            logger.raw(`  路径（${meta.localPaths.length} 个）：`);
            for (const p of meta.localPaths) {
              const exists = await dirExists(p);
              logger.raw(`    ${exists ? chalk.green('●') : chalk.red('○')} ${p}`);
            }
          }
        } else {
          logger.raw(`  路径：${chalk.dim('(无)')}`);
        }
        if (meta.description) logger.raw(`  描述：${meta.description}`);
        if (meta.gitRemotes?.length) {
          logger.raw(`  Git remote：${meta.gitRemotes.join(', ')}`);
        }
        if (meta.gitFirstCommit) {
          logger.raw(`  Git 首次 commit：${meta.gitFirstCommit.slice(0, 12)}`);
        }
        if (meta.gitDefaultBranch) {
          logger.raw(`  默认分支：${meta.gitDefaultBranch}`);
        }
        if (meta.packageNames?.length) {
          logger.raw(`  Package：${meta.packageNames.join(', ')}`);
        }
        if (meta.monorepoPackages?.length) {
          logger.raw(`  Monorepo 包：${meta.monorepoPackages.length} 个`);
        }
        if (meta.groups?.length) logger.raw(`  分组：${meta.groups.join(', ')}`);
        if (meta.tags?.length) logger.raw(`  标签：${meta.tags.join(', ')}`);
        logger.raw(`  创建：${meta.created}`);
        if (meta.updated) logger.raw(`  更新：${meta.updated}`);
        if (meta.fingerprintsUpdated) {
          logger.raw(`  指纹更新：${meta.fingerprintsUpdated}`);
        }
        if (taskIds.length) logger.raw(`  关联任务：${taskIds.length} 个`);
        if (relations.length) logger.raw(`  项目关系：${relations.length} 个`);
        logger.raw('');
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── update ───
  cmd
    .command('update <id>')
    .description('更新项目元数据')
    .option('--name <name>', '项目名称')
    .option('--description <desc>', '项目描述')
    .option('--groups <groups>', '项目分组（逗号分隔）')
    .option('--tags <tags>', '标签（逗号分隔）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }

        const updates: Record<string, unknown> = {};
        if (opts.name) updates.name = opts.name;
        if (opts.description) updates.description = opts.description;
        if (opts.groups)
          updates.groups = (opts.groups as string).split(',').map((s: string) => s.trim());
        if (opts.tags) updates.tags = (opts.tags as string).split(',').map((s: string) => s.trim());

        const updated = await updateProjectMeta(username, match.id, updates);
        closeDb();

        if (updated) {
          logger.raw(chalk.green(`✓ 项目 ${updated.name} 已更新`));
        } else {
          logger.raw(chalk.yellow('更新失败'));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── remove ───
  cmd
    .command('remove <id>')
    .alias('rm')
    .description('删除项目数据（移入垃圾桶，可恢复）')
    .action(async (id: string) => {
      try {
        const username = await getUsername();
        await initDb();

        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }

        await unregisterProject(username, match.id);
        closeDb();

        logger.raw(chalk.green(`✓ 项目 ${match.name} 已移入垃圾桶（含关系与指纹）`));
        logger.raw(chalk.dim('  使用 lattice trash list 查看，lattice trash restore <id> 恢复'));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── where <path> ───
  cmd
    .command('where <path>')
    .description('查询指定路径属于哪个已注册项目（含父目录前缀匹配与指纹回退）')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (rawPath: string, opts) => {
      try {
        const absPath = normalizeLocalPath(pathResolve(rawPath));
        const username = await getUsername();
        await initDb();

        // 1. 精确路径匹配
        const exact = findProjectByPath(absPath);
        // 2. 父目录前缀匹配
        const prefixMatches: { row: ReturnType<typeof findProjectById>; matchedPath: string }[] =
          [];
        const all = listProjects(username);
        for (const p of all) {
          if (exact && p.id === exact.id) continue;
          for (const lp of rowLocalPaths(p)) {
            if (isPathPrefixOf(lp, absPath)) {
              prefixMatches.push({ row: p as ProjectRow, matchedPath: lp });
              break;
            }
          }
        }
        // 3. 指纹回退（智能查找）
        const smart = findProjectByPath(absPath);
        closeDb();

        if (opts.json) {
          outputJson(
            {
              queryPath: absPath,
              exact: exact ?? null,
              prefixMatches: prefixMatches.map((m) => ({
                id: m.row?.id,
                matchedPath: m.matchedPath,
              })),
              fingerprintCandidates: smart ? [{ id: smart.id, name: smart.name }] : [],
            },
            opts.jsonFormat,
          );
          return;
        }

        logger.raw(chalk.bold(`\n查询路径：${absPath}\n`));

        if (exact) {
          logger.raw(chalk.green(`✓ 精确匹配：${exact.name} (${exact.id})`));
        }

        if (prefixMatches.length > 0) {
          logger.raw(chalk.cyan(`\n父目录前缀匹配（${prefixMatches.length}）：`));
          for (const m of prefixMatches) {
            if (m.row) {
              logger.raw(`  ${m.row.name} ${chalk.dim(`(${m.row.id})`)}`);
              logger.raw(`    ${chalk.dim(`命中：${m.matchedPath}`)}`);
            }
          }
        }

        if (smart) {
          logger.raw(chalk.cyan(`\n路径匹配：`));
          logger.raw(`  ${smart.name} ${chalk.dim(`(${smart.id})`)}`);
        }

        if (!exact && prefixMatches.length === 0 && !smart) {
          logger.raw(chalk.yellow('未找到与该路径匹配的已注册项目'));
        }
        logger.raw('');
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── relation 子命令组 ───
  const relationCmd = cmd.command('relation').description('管理项目间关系');

  // relation list
  relationCmd
    .command('list [id]')
    .alias('ls')
    .description('查看项目关系（默认聚合所有用户定义的关系）')
    .option('--current-user', '仅显示当前用户定义的关系')
    .option('--user <users>', '仅显示指定用户定义的关系（逗号分隔多个用户名）')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (id: string | undefined, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const projects = listProjects(username);

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

        // --current-user 与 --user 互斥
        if (opts.currentUser && filterUsernames) {
          logger.raw(chalk.yellow('--current-user 与 --user 不能同时使用'));
          closeDb();
          return;
        }

        if (id) {
          const match = resolveProjectById(username, id);
          if (!match) {
            logger.raw(chalk.yellow(`未找到项目：${id}`));
            closeDb();
            return;
          }

          const relations: RelationWithSource[] = opts.currentUser
            ? (await getRelationsByProject(username, match.id)).map((r) => ({
                ...r,
                sourceUser: username,
              }))
            : await getRelationsByProjectCrossUser(username, match.id, filterUsernames);
          closeDb();

          if (opts.json) {
            outputJson(relations, opts.jsonFormat);
            return;
          }
          if (relations.length === 0) {
            logger.raw(chalk.dim(`项目 ${match.name} 暂无关系。`));
            return;
          }

          logger.raw(
            chalk.blue(`\n项目 ${chalk.bold(match.name)} 的关系（${relations.length} 个）：\n`),
          );
          for (const r of relations) {
            const otherId = r.projectA === match.id ? r.projectB : r.projectA;
            const otherProject = projects.find((p) => p.id === otherId);
            const otherName = otherProject?.name ?? otherId;
            const sourceTag = r.sourceUser !== username ? chalk.magenta(` [${r.sourceUser}]`) : '';
            logger.raw(
              `  ${chalk.dim(r.id)}  ${chalk.bold(otherName)} ${chalk.dim(`(${otherId})`)}${sourceTag}`,
            );
            logger.raw(
              `    ${chalk.cyan('类型：')}${r.type}${r.description ? `  ${chalk.dim(r.description)}` : ''}`,
            );
            if (r.createdBy) {
              logger.raw(
                `    ${chalk.dim(`来源：${r.createdBy}${r.createdFromTaskId ? ` / ${r.createdFromTaskId}` : ''}`)}`,
              );
            }
          }
          logger.raw('');
        } else {
          // 列出所有关系（跨用户聚合）
          const relationsAll: RelationWithSource[] = opts.currentUser
            ? (await listRelations(username)).map((r) => ({ ...r, sourceUser: username }))
            : await listRelationsCrossUser(username, filterUsernames);
          closeDb();

          if (opts.json) {
            outputJson(relationsAll, opts.jsonFormat);
            return;
          }
          if (relationsAll.length === 0) {
            // 兼容显示 db 中的去重关系（理论上 relations.json 已是真源）
            const fallback = await getAllUniqueRelations(username);
            if (fallback.length === 0) {
              logger.raw(chalk.dim('暂无项目关系。使用 lattice project relation add 创建。'));
              return;
            }
          }

          logger.raw(chalk.blue(`\n共 ${relationsAll.length} 条项目关系：\n`));
          for (const r of relationsAll) {
            const nameA = projects.find((p) => p.id === r.projectA)?.name ?? r.projectA;
            const nameB = projects.find((p) => p.id === r.projectB)?.name ?? r.projectB;
            const sourceTag = r.sourceUser !== username ? chalk.magenta(` [${r.sourceUser}]`) : '';
            logger.raw(
              `  ${chalk.dim(r.id)}  ${chalk.bold(nameA)} ↔ ${chalk.bold(nameB)}${sourceTag}`,
            );
            logger.raw(
              `    ${chalk.cyan('类型：')}${r.type}${r.description ? `  ${chalk.dim(r.description)}` : ''}`,
            );
            if (r.createdBy) {
              logger.raw(
                `    ${chalk.dim(`来源：${r.createdBy}${r.createdFromTaskId ? ` / ${r.createdFromTaskId}` : ''}`)}`,
              );
            }
          }
          logger.raw('');
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // relation add
  relationCmd
    .command('add <project-a> <project-b>')
    .description('创建项目间关系（重复 a/b/type 视为同一条会更新描述）')
    .option('--type <type>', '关系类型', 'related')
    .option('--description <desc>', '关系描述')
    .option('--from-task <taskId>', '记录来源任务 ID')
    .option('--ai-inferred', '标记为 AI 推断的关系')
    .action(async (projectA: string, projectB: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const matchA = resolveProjectById(username, projectA);
        const matchB = resolveProjectById(username, projectB);

        if (!matchA) {
          logger.raw(chalk.yellow(`未找到项目 A：${projectA}`));
          closeDb();
          return;
        }
        if (!matchB) {
          logger.raw(chalk.yellow(`未找到项目 B：${projectB}`));
          closeDb();
          return;
        }
        if (matchA.id === matchB.id) {
          logger.raw(chalk.yellow('不能创建项目与自身的关系'));
          closeDb();
          return;
        }

        const saved = await upsertRelationFile(username, {
          projectA: matchA.id,
          projectB: matchB.id,
          type: opts.type as string,
          description: opts.description as string | undefined,
          createdBy: opts.aiInferred ? 'ai-inferred' : 'manual',
          createdFromTaskId: opts.fromTask as string | undefined,
        });
        closeDb();

        logger.raw(
          chalk.green(
            `✓ 已${saved.updated ? '更新' : '创建'}关系：${matchA.name} ↔ ${matchB.name}`,
          ),
        );
        logger.raw(chalk.dim(`  ID：${saved.id}`));
        logger.raw(chalk.dim(`  类型：${saved.type}`));
        if (saved.description) logger.raw(chalk.dim(`  描述：${saved.description}`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // relation remove <id>
  relationCmd
    .command('remove <relation-id>')
    .alias('rm')
    .description('按 id 删除项目间关系（id 见 lattice project relation list）')
    .option('-f, --force', '跳过确认')
    .action(async (relationId: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const all = await listRelations(username);
        const target = all.find((r) => r.id === relationId);
        if (!target) {
          logger.raw(chalk.yellow(`未找到关系：${relationId}`));
          closeDb();
          return;
        }

        const projects = listProjects(username);
        const nameA = projects.find((p) => p.id === target.projectA)?.name ?? target.projectA;
        const nameB = projects.find((p) => p.id === target.projectB)?.name ?? target.projectB;

        if (!shouldSkipConfirm(opts)) {
          const ok = await confirm({
            message: `确认删除 ${nameA} ↔ ${nameB}（${target.type}）这条关系？`,
            default: false,
          });
          if (!ok) {
            logger.raw(chalk.dim('已取消'));
            closeDb();
            return;
          }
        }

        const deleted = await deleteRelationFile(username, relationId);
        closeDb();
        if (deleted) {
          logger.raw(chalk.green(`✓ 已删除关系：${nameA} ↔ ${nameB}`));
        } else {
          logger.raw(chalk.yellow(`删除失败：${relationId}`));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── merge ───
  cmd
    .command('merge')
    .description('将两个项目物理合并为一个（from → to）')
    .argument('<from>', '源项目 ID')
    .argument('<to>', '目标项目 ID')
    .option('-f, --force', '跳过确认')
    .action(async (fromId: string, toId: string, opts: { force?: boolean }) => {
      try {
        await initDb();

        // 确认
        if (!opts.force) {
          const confirmed = await confirm({
            message: `确认将项目 ${fromId} 合并到 ${toId}？此操作不可撤销。`,
            default: false,
          });
          if (!confirmed) {
            logger.raw(chalk.dim('已取消'));
            closeDb();
            return;
          }
        }

        logger.raw(chalk.cyan('正在合并...'));
        const result = await mergeProjects(fromId, toId);
        closeDb();

        if (result.success) {
          logger.raw(chalk.green(`✓ ${result.message}`));
          if (result.steps) {
            for (const step of result.steps) {
              logger.raw(chalk.dim(`  ${step}`));
            }
          }
        } else {
          logger.raw(chalk.red(`✗ ${result.message}`));
          if (result.steps) {
            logger.raw(chalk.dim('已完成步骤：'));
            for (const step of result.steps) {
              logger.raw(chalk.dim(`  ${step}`));
            }
          }
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  // ─── profile ───
  const profileCmd = cmd.command('profile').description('管理项目画像（标签、描述、缓存）');

  // profile check
  profileCmd
    .command('check')
    .description('检测哪些项目的画像需要更新')
    .option('--project <id>', '检查指定项目')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        if (opts.project) {
          const match = resolveProjectById(username, opts.project);
          if (!match) {
            logger.raw(chalk.yellow(`未找到项目：${opts.project}`));
            closeDb();
            return;
          }
          const item = await checkSingleProfile(username, match.id, match.id, match.name);
          closeDb();
          if (opts.json) {
            outputJson(item, opts.jsonFormat);
            return;
          }
          if (item.status === 'fresh') {
            logger.raw(chalk.green(`✓ ${item.name} — 已是最新`));
          } else {
            logger.raw(chalk.yellow(`△ ${item.name} — ${item.reasons.join('，')}`));
          }
          return;
        }

        const result = await checkProfiles(username);
        closeDb();

        if (opts.json) {
          outputJson(result, opts.jsonFormat);
          return;
        }

        if (result.stale.length > 0) {
          logger.raw(chalk.yellow(`需要更新（${result.stale.length}）：`));
          for (const item of result.stale) {
            logger.raw(chalk.yellow(`  ${item.name} — ${item.reasons.join('，')}`));
          }
          logger.raw('');
        }
        if (result.fresh > 0) {
          logger.raw(chalk.green(`已是最新（${result.fresh}）：跳过`));
        }
        if (result.noProfile.length > 0) {
          logger.raw(
            chalk.dim(
              `未生成画像（${result.noProfile.length}）：${result.noProfile.map((p) => p.name).join(', ')}`,
            ),
          );
        }
        if (result.stale.length === 0 && result.noProfile.length === 0) {
          logger.raw(chalk.green('✓ 所有项目画像均为最新'));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  // profile done
  profileCmd
    .command('done <id>')
    .description('标记画像生成完成（采集缓存 + 同步 profileUpdated + 触发 rag update）')
    .action(async (id: string) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }
        await markProfileDone(username, match.id, match.id);
        closeDb();
        // 触发增量 rag update（不阻塞）
        try {
          await updateRagIndex();
        } catch {
          // ignore
        }
        logger.raw(chalk.green(`✓ ${match.name} 画像缓存已更新`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  // profile show
  profileCmd
    .command('show <id>')
    .description('查看项目画像（summary + tags + cache 状态 + 文件路径）')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }
        const profile = await getProfileShow(username, match.id);
        closeDb();

        if (opts.json) {
          outputJson(profile, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.bold(`项目画像：${match.name}`));
        logger.raw('');
        logger.raw(`标签：${profile.tags.length > 0 ? profile.tags.join(', ') : chalk.dim('无')}`);
        logger.raw(`画像目录：${profile.profileDir}`);
        logger.raw(`summary：${profile.summaryPath}`);
        logger.raw(`tags：${profile.tagsPath}`);
        if (profile.cache) {
          logger.raw(`缓存时间：${profile.cache.generatedAt}`);
        } else {
          logger.raw(chalk.dim('缓存：未生成'));
        }
        if (profile.summary) {
          logger.raw('');
          logger.raw(chalk.dim('─── summary.md ───'));
          logger.raw(profile.summary);
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  // profile path
  profileCmd
    .command('path <id>')
    .description('输出项目 profile 目录路径')
    .action(async (id: string) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }
        const profileDir = getProfileDirPath(username, match.id);
        closeDb();
        logger.raw(profileDir);
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  // profile brief
  profileCmd
    .command('brief <id>')
    .description('一次性获取项目画像所需的所有 lattice 内部信息')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }
        const brief = await getProfileBrief(username, match.id, match.id);
        closeDb();
        if (!brief) {
          logger.raw(chalk.yellow(`无法获取项目信息：${id}`));
          return;
        }

        if (opts.json) {
          outputJson(brief, opts.jsonFormat);
          return;
        }

        // 文本输出
        logger.raw(chalk.bold(`项目：${brief.project.name}`));
        logger.raw(`ID：${brief.project.id}`);
        if (brief.project.description) logger.raw(`描述：${brief.project.description}`);
        logger.raw(`本地路径：${brief.project.localPaths.join(', ') || '无'}`);
        if (brief.project.groups?.length) logger.raw(`分组：${brief.project.groups.join(', ')}`);
        if (brief.project.packageNames?.length)
          logger.raw(`包名：${brief.project.packageNames.join(', ')}`);
        if (brief.project.monorepoPackages?.length)
          logger.raw(`monorepo 包：${brief.project.monorepoPackages.join(', ')}`);
        logger.raw(`画像目录：${brief.profileDir}`);
        logger.raw('');

        // 已有画像
        logger.raw(chalk.bold(`标签：${brief.tags.length > 0 ? brief.tags.join(', ') : '无'}`));
        if (brief.summary) {
          logger.raw(chalk.dim('─── 已有 summary.md ───'));
          logger.raw(brief.summary);
          logger.raw('');
        } else {
          logger.raw(chalk.dim('summary.md：未生成'));
          logger.raw('');
        }

        // Spec 清单
        logger.raw(chalk.bold(`项目级 Spec（${brief.specs.length}）：`));
        for (const s of brief.specs) {
          logger.raw(`  ${s.title}${s.description ? chalk.dim(` — ${s.description}`) : ''}`);
        }
        logger.raw('');

        // 任务清单
        logger.raw(chalk.bold(`关联任务（${brief.tasks.length}）：`));
        for (const t of brief.tasks) {
          logger.raw(`  [${t.status}] ${t.title} (${t.id})`);
        }
        logger.raw('');

        // 关系
        if (brief.relations.length > 0) {
          logger.raw(chalk.bold(`项目关系（${brief.relations.length}）：`));
          for (const r of brief.relations) {
            logger.raw(
              `  ${r.projectName} — ${r.type}${r.description ? ` (${r.description})` : ''}`,
            );
          }
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  // profile tags
  const tagsCmd = profileCmd.command('tags').description('管理项目标签');

  tagsCmd
    .command('show <id>')
    .description('查看项目标签')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }
        const tags = await readProfileTags(username, match.id);
        const profileDir = getProfileDirPath(username, match.id);
        closeDb();
        if (opts.json) {
          outputJson({ tags, path: `${profileDir}/tags.json` });
          return;
        }
        logger.raw(`标签：${tags.length > 0 ? tags.join(', ') : chalk.dim('无')}`);
        logger.raw(`文件：${profileDir}/tags.json`);
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  tagsCmd
    .command('set <id>')
    .description('替换项目标签（全量）')
    .requiredOption('--tags <tags>', '标签列表（逗号分隔）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }
        const tags = [
          ...new Set(
            (opts.tags as string)
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ];
        await writeProfileTags(username, match.id, tags);
        closeDb();
        logger.raw(chalk.green(`✓ 标签已设置：${tags.join(', ')}`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  tagsCmd
    .command('add <id>')
    .description('追加标签（去重）')
    .requiredOption('--tags <tags>', '标签列表（逗号分隔）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }
        const newTags = (opts.tags as string)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const result = await addProfileTags(username, match.id, newTags);
        closeDb();
        logger.raw(chalk.green(`✓ 标签已追加，当前：${result.join(', ')}`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });

  tagsCmd
    .command('remove <id>')
    .description('删除指定标签')
    .requiredOption('--tags <tags>', '标签列表（逗号分隔）')
    .action(async (id: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const match = resolveProjectById(username, id);
        if (!match) {
          logger.raw(chalk.yellow(`未找到项目：${id}`));
          closeDb();
          return;
        }
        const tagsToRemove = (opts.tags as string)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const result = await removeProfileTags(username, match.id, tagsToRemove);
        closeDb();
        logger.raw(
          chalk.green(`✓ 标签已删除，剩余：${result.length > 0 ? result.join(', ') : '无'}`),
        );
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        closeDb();
        process.exitCode = 1;
      }
    });
}
