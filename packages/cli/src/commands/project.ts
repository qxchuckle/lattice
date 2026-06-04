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
  findProjectsByPathSmart,
  normalizeLocalPath,
  isPathPrefixOf,
  dirExists,
} from '@qcqx/lattice-core';
import type { ProjectRow, RelationWithSource } from '@qcqx/lattice-core';
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
    .option('--has-git', '只显示含 git remote 的项目')
    .option('--orphaned', '只显示所有 localPath 都已失效的项目')
    .option('--with-relations', '附带显示项目关系')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        let projects = listProjects(username, {
          group: opts.group,
          tag: opts.tag,
        });

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
            ...(opts.withRelations ? { relations: relationsMap.get(p.id) ?? [] } : {}),
          }));
          outputJson(result, opts.jsonFormat);
          return;
        }

        if (projects.length === 0) {
          logger.raw(chalk.dim('暂无符合条件的项目。使用 lattice link 注册项目。'));
          return;
        }

        logger.raw(chalk.blue(`共 ${projects.length} 个项目：\n`));
        for (const p of projects) {
          const { parsedGroups: groups, parsedTags: tags } = parseProjectRow(p);
          const localPaths = rowLocalPaths(p);
          const gitRemotes = rowGitRemotes(p);
          const pkgNames = parseJsonArray(p.package_names);
          logger.raw(`  ${chalk.bold(p.name)} ${chalk.dim(`(${p.id})`)}`);
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
        const smart = await findProjectsByPathSmart(absPath);
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
              fingerprintCandidates: smart,
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

        if (smart.length > 0) {
          logger.raw(chalk.cyan(`\n指纹候选（${smart.length}）：`));
          for (const c of smart.slice(0, 5)) {
            logger.raw(
              `  ${c.projectName} ${chalk.dim(`(${c.projectId})`)} ${chalk.cyan(`[${c.confidence}]`)} score=${c.score}`,
            );
            logger.raw(chalk.dim(`    证据：${c.evidence.map((e) => e.key).join(', ')}`));
          }
        }

        if (!exact && prefixMatches.length === 0 && smart.length === 0) {
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
}
