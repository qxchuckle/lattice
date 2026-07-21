import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  initDb,
  closeDb,
  getContextForProject,
  getSmartContext,
  formatContextAsMarkdown,
  resolveSpecScope,
  findProjectById,
  getProjectMeta,
  buildProfileSection,
  unifiedSearch,
  type ContextOptions,
  type AncestorProjectInfo,
  type ParsedSpec,
  type ProjectContext,
  type SearchResult,
} from '@qcqx/lattice-core';
import {
  logger,
  outputJson,
  resolveCurrentProject,
  resolveCurrentProjectWithAncestors,
} from '../utils';

/** 剥离 spec 的 content 和冗余字段，JSON 输出精简 */
function stripSpecContent(spec: ParsedSpec, scope?: string): Record<string, unknown> {
  const { id, title, description, tags } = spec.frontmatter;
  return {
    title: title ?? spec.fileName,
    filePath: spec.filePath,
    ...(description ? { description } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(scope ? { scope } : {}),
  };
}

/** 剥离 spec 数组中的 content */
function stripSpecs(specs: ParsedSpec[], scope?: string): Record<string, unknown>[] {
  return specs.map((s) => stripSpecContent(s, scope));
}

/** 剥离 cascadedSpecs 并自动标记 scope */
function stripCascadedSpecs(ctx: ProjectContext): Record<string, unknown>[] {
  return ctx.cascadedSpecs.map((spec) => stripSpecContent(spec, resolveSpecScope(spec, ctx)));
}

/** 截断搜索结果中的长小数 */
function truncateScores(results: SearchResult[]): SearchResult[] {
  return results.map((r) => ({
    ...r,
    score: Math.round((r.score ?? 0) * 10000) / 10000,
    meta: Object.fromEntries(
      Object.entries(r.meta as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === 'number' ? Math.round(v * 10000) / 10000 : v,
      ]),
    ),
  }));
}

/** 语义搜索节：调用 unifiedSearch 并格式化输出 */
async function performQuerySearch(
  query: string,
  opts?: { projectId?: string; usernames?: string[] },
): Promise<SearchResult[]> {
  try {
    const results = await unifiedSearch(query, {
      projectId: opts?.projectId,
      usernames: opts?.usernames,
      limit: 5,
      specLimit: 5,
      taskLimit: 3,
      projectLimit: 3,
    });
    return results;
  } catch {
    return [];
  }
}

function formatQuerySection(results: SearchResult[]): void {
  if (results.length === 0) return;

  const specs = results.filter((r) => r.type === 'spec');
  const tasks = results.filter((r) => r.type === 'task' || r.type === 'design');
  const projects = results.filter((r) => r.type === 'project');

  logger.raw(chalk.green.bold('\n语义关联（--query）\n'));

  if (specs.length > 0) {
    logger.raw(chalk.green(`  相关 Spec（${specs.length}）：`));
    for (const r of specs) {
      const meta = r.meta as Record<string, unknown>;
      const via = meta.matchedVia as { docTitle?: string } | undefined;
      const viaLabel = via ? chalk.dim(` ← 「${via.docTitle}」`) : '';
      logger.raw(`    ${chalk.bold(r.title)}${viaLabel}`);
      logger.raw(chalk.dim(`      ${(meta.filePath as string) ?? ''}`));
    }
    logger.raw('');
  }

  if (tasks.length > 0) {
    logger.raw(chalk.green(`  相关任务（${tasks.length}）：`));
    for (const r of tasks) {
      const meta = r.meta as Record<string, unknown>;
      const idTag = meta.taskId ? chalk.dim(` ${meta.taskId}`) : '';
      logger.raw(`    ${chalk.bold(r.title)} ${chalk.dim(`(${r.type})`)}${idTag}`);
    }
    logger.raw('');
  }

  if (projects.length > 0) {
    logger.raw(chalk.green(`  相关项目（${projects.length}）：`));
    for (const r of projects) {
      logger.raw(`    ${chalk.bold(r.title)}`);
    }
    logger.raw('');
  }
}

export function registerContextCommand(program: Command): void {
  program
    .command('context')
    .description('输出当前项目的聚合上下文')
    .option('--task <id>', '指定任务 ID')
    .option('--project <id>', '指定项目 ID')
    .option('--query <text>', '语义化查询（主题/意图/任务描述）：补充搜索相关的 spec、任务、项目')
    .option('--current-user', '仅显示当前用户数据，禁用跨用户聚合')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const contextOpts: ContextOptions = {
          crossUser: !opts.currentUser,
        };

        if (opts.task) {
          // 任务关联上下文
          const ctx = await getSmartContext(username, opts.task, contextOpts);

          // --query 语义搜索补充
          let queryResults: SearchResult[] = [];
          if (opts.query) {
            queryResults = await performQuerySearch(opts.query, {
              usernames: opts.currentUser ? [username] : undefined,
            });
          }
          closeDb();

          if (opts.json) {
            const jsonCtx = {
              task: ctx.task,
              directSpecs: stripSpecs(ctx.directSpecs, 'project'),
              relatedSpecs: stripSpecs(ctx.relatedSpecs, 'related'),
              semanticSpecs: stripSpecs(ctx.semanticSpecs, 'semantic'),
              crossUserData: ctx.crossUserData?.map((d) => ({
                ...d,
                directSpecs: stripSpecs(d.directSpecs, 'project'),
              })),
              querySearch: queryResults.length > 0 ? truncateScores(queryResults) : undefined,
            };
            outputJson(jsonCtx, opts.jsonFormat);
            return;
          }

          logger.raw(chalk.bold(`\n任务上下文：${ctx.task.title}\n`));

          if (ctx.directSpecs.length > 0) {
            logger.raw(chalk.blue(`直接关联 Spec（${ctx.directSpecs.length}）：`));
            for (const s of ctx.directSpecs) {
              const title = s.frontmatter.title ?? s.fileName;
              const description =
                typeof s.frontmatter.description === 'string' && s.frontmatter.description.trim()
                  ? s.frontmatter.description.trim()
                  : chalk.yellow('[缺失摘要]');
              logger.raw(`  ${chalk.bold(title)}`);
              logger.raw(chalk.dim(`    路径：${s.filePath}`));
              logger.raw(`    摘要：${description}`);
              logger.raw('');
            }
          }

          if (ctx.relatedSpecs.length > 0) {
            logger.raw(chalk.blue(`同组项目 Spec（${ctx.relatedSpecs.length}）：`));
            for (const s of ctx.relatedSpecs) {
              const title = s.frontmatter.title ?? s.fileName;
              const description =
                typeof s.frontmatter.description === 'string' && s.frontmatter.description.trim()
                  ? s.frontmatter.description.trim()
                  : chalk.yellow('[缺失摘要]');
              logger.raw(`  ${chalk.bold(title)} — ${description}`);
              logger.raw(chalk.dim(`    路径：${s.filePath}`));
            }
            logger.raw('');
          }

          if (ctx.semanticSpecs.length > 0) {
            logger.raw(chalk.green(`语义关联 Spec（${ctx.semanticSpecs.length}）：`));
            for (const s of ctx.semanticSpecs) {
              const title = s.frontmatter.title ?? s.fileName;
              const description =
                typeof s.frontmatter.description === 'string' && s.frontmatter.description.trim()
                  ? s.frontmatter.description.trim()
                  : chalk.yellow('[缺失摘要]');
              logger.raw(`  ${chalk.bold(title)} — ${description}`);
              logger.raw(chalk.dim(`    路径：${s.filePath}`));
            }
            logger.raw('');
          }

          // 跨用户聚合数据
          if (ctx.crossUserData && ctx.crossUserData.length > 0) {
            logger.raw(chalk.magenta.bold(`\n跨用户聚合：`));
            for (const userData of ctx.crossUserData) {
              logger.raw(chalk.magenta(`\n  来源用户：${userData.username}`));

              if (userData.directSpecs.length > 0) {
                logger.raw(chalk.blue(`  项目级 Spec（${userData.directSpecs.length}）：`));
                for (const s of userData.directSpecs) {
                  logger.raw(`    ${s.frontmatter.title ?? s.fileName}`);
                }
              }

              if (userData.activeTasks.length > 0) {
                logger.raw(chalk.blue(`  活跃任务（${userData.activeTasks.length}）：`));
                for (const t of userData.activeTasks) {
                  logger.raw(`    ${t.title} (${t.status}) — ${t.id}`);
                }
              }
            }
            logger.raw('');
          }

          // --query 语义搜索节
          if (queryResults.length > 0) {
            formatQuerySection(queryResults);
          }

          return;
        }

        // 项目上下文
        let projectId = opts.project as string | undefined;
        let ancestors: AncestorProjectInfo[] | undefined;

        if (!projectId) {
          // 解析当前项目及祖先
          const resolved = await resolveCurrentProjectWithAncestors();
          if (!resolved) {
            logger.raw(chalk.yellow('当前目录不是 Lattice 项目。请指定 --project 或 --task'));
            closeDb();
            return;
          }
          projectId = resolved.current.id;

          // 构建祖先信息
          if (resolved.ancestors.length > 0) {
            ancestors = [];
            for (const a of resolved.ancestors) {
              const meta = await getProjectMeta(username, a.id);
              ancestors.push({
                id: a.id,
                name: meta?.name ?? undefined,
                root: a.root,
              });
            }
          }
        }

        if (!projectId) {
          logger.raw(chalk.yellow('无法确定项目 ID'));
          closeDb();
          return;
        }

        // 绑定丢失自检：db 中不存在该项目时给出修复建议
        const dbRow = findProjectById(projectId);
        if (!dbRow) {
          closeDb();
          logger.raw(
            chalk.yellow(
              `⚠ 未在 Lattice 中找到项目 ${projectId.slice(0, 8)}… （lattice.json 指向的 id 不存在）`,
            ),
          );
          logger.raw(
            chalk.dim(
              '  修复建议：\n    1) lattice link --restore <id>  恢复绑定\n    2) lattice link              走指纹识别选单\n    3) lattice link --force-new   强制创建新项目',
            ),
          );
          process.exitCode = 1;
          return;
        }

        // 传入祖先信息用于 spec 级联继承
        if (ancestors && ancestors.length > 0) {
          contextOpts.ancestorProjectIds = ancestors.map((a) => a.id);
          contextOpts.ancestors = ancestors;
        }

        const ctx = await getContextForProject(username, projectId, contextOpts);

        // --query 语义搜索：标记匹配的 spec + 补充非已有结果
        const queryResults: SearchResult[] = [];
        const queryMatchedPaths: Set<string> = new Set();
        if (opts.query) {
          const cascadedPaths = new Set<string>((ctx.cascadedSpecs ?? []).map((s) => s.filePath));
          // 单次搜索（不限项目范围），按结果拆分用途
          const allResults = await performQuerySearch(opts.query, {
            usernames: opts.currentUser ? [username] : undefined,
          });
          for (const r of allResults) {
            const fp = (r.meta as Record<string, unknown>).filePath as string | undefined;
            if (r.type === 'spec' && fp && cascadedPaths.has(fp)) {
              // 已在 context spec 列表中 → 仅标记匹配
              queryMatchedPaths.add(fp);
            } else {
              // 补充结果（任务/项目/不在 context 中的 spec）
              queryResults.push(r);
            }
          }
        }
        closeDb();

        if (opts.json) {
          const profileData = await buildProfileSection(username, projectId);
          const specs = stripCascadedSpecs(ctx)
            .map((s) => (queryMatchedPaths.has(s.filePath as string) ? { ...s, query: true } : s))
            .sort((a, b) => (b.query ? 1 : 0) - (a.query ? 1 : 0));
          const jsonCtx = {
            profile: profileData ?? undefined,
            specs,
            activeTasks: ctx.activeTasks,
            relatedProjects: ctx.relatedProjects.length > 0 ? ctx.relatedProjects : undefined,
            crossUserData: ctx.crossUserData?.map((d) => ({
              ...d,
              projectSpecs: stripSpecs(d.projectSpecs, 'project'),
              userSpecs: stripSpecs(d.userSpecs, 'user'),
            })),
            ancestors: ctx.ancestors?.length ? ctx.ancestors : undefined,
            querySearch: queryResults.length > 0 ? truncateScores(queryResults) : undefined,
          };
          outputJson(jsonCtx, opts.jsonFormat);
          return;
        }

        logger.raw(
          formatContextAsMarkdown(
            ctx,
            (await buildProfileSection(username, projectId)) ?? undefined,
            queryMatchedPaths.size > 0 ? queryMatchedPaths : undefined,
          ),
        );

        // --query 语义搜索节
        if (queryResults.length > 0) {
          formatQuerySection(queryResults);
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
