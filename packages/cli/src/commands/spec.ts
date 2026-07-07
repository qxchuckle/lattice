import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'node:path';
import {
  getUsername,
  initDb,
  closeDb,
  readGlobalConfig,
  readLocalConfig,
  readResolvedConfig,
  writeGlobalConfig,
  writeLocalConfig,
  getProjectSpecs,
  getUserSpecs,
  getGlobalSpecs,
  detectSpecConflicts,
  listSpecTemplates,
  applySpecTemplate,
  parseSpec,
  writeSpec,
  specExists,
  findSpecByName,
  syncSpecTemplateRegistry,
  listSpecTemplateRegistries,
  removeSpecTemplateRegistry,
  validateSpecsScope,
  listAllUsernames,
  getGlobalSpecDir,
  getUserSpecDir,
  getProjectSpecDir,
  ensureDir,
  fileExists,
  lintSpecFrontmatter,
  lintSpecs,
  isValidSpecId,
  migrateSpecs,
  type SpecFrontmatter,
  type ParsedSpec,
  type SpecLintReport,
} from '@qcqx/lattice-core';
import { logger, outputJson, resolveCurrentProject } from '../utils';
import {
  resolveBundledSpecTemplateNames,
  syncBundledSpecTemplatesWithPrompt,
} from '../utils/spec-templates';

async function resolveCurrentProjectId(): Promise<string | null> {
  return (await resolveCurrentProject())?.id ?? null;
}

async function getConfiguredTemplateRegistries(): Promise<string[]> {
  const config = await readResolvedConfig();
  return [...new Set(config.registryTemplates ?? [])];
}

async function writeConfiguredTemplateRegistries(registryTemplates: string[]): Promise<void> {
  const globalConfig = await readGlobalConfig();
  await writeGlobalConfig({ ...globalConfig, registryTemplates });
}

async function removeLegacyLocalTemplateRegistry(repo: string): Promise<void> {
  const localConfig = await readLocalConfig();
  if (!localConfig?.registryTemplates?.includes(repo)) return;
  await writeLocalConfig({
    ...localConfig,
    registryTemplates: localConfig.registryTemplates.filter((item) => item !== repo),
  });
}

export function registerSpecCommand(program: Command): void {
  const cmd = program.command('spec').description('管理 Spec 文件');

  // list
  cmd
    .command('list')
    .alias('ls')
    .description('列出 spec 文件')
    .option('--scope <scope>', '过滤层级（project / user / global）')
    .option('--tag <tag>', '按标签过滤')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        await initDb();

        const projectId = await resolveCurrentProjectId();
        const scopeFilter = opts.scope as string | undefined;

        const allSpecs: { scope: string; specs: Awaited<ReturnType<typeof getGlobalSpecs>> }[] = [];

        if (!scopeFilter || scopeFilter === 'global') {
          allSpecs.push({ scope: 'global', specs: await getGlobalSpecs() });
        }
        if (!scopeFilter || scopeFilter === 'user') {
          allSpecs.push({ scope: 'user', specs: await getUserSpecs(username) });
        }
        if (projectId && (!scopeFilter || scopeFilter === 'project')) {
          allSpecs.push({ scope: 'project', specs: await getProjectSpecs(username, projectId) });
        }

        closeDb();

        // 按标签过滤
        if (opts.tag) {
          for (const group of allSpecs) {
            group.specs = group.specs.filter((s) => s.frontmatter.tags?.includes(opts.tag));
          }
        }

        if (opts.json) {
          outputJson(allSpecs, opts.jsonFormat);
          return;
        }

        const total = allSpecs.reduce((n, g) => n + g.specs.length, 0);
        if (total === 0) {
          logger.raw(chalk.dim('暂无 spec 文件。'));
          return;
        }

        for (const group of allSpecs) {
          if (group.specs.length === 0) continue;
          logger.raw(chalk.blue(`\n[${group.scope}] ${group.specs.length} 个 spec：`));
          for (const spec of group.specs) {
            const title = spec.frontmatter.title ?? spec.fileName.replace('.md', '');
            const tags = spec.frontmatter.tags?.join(', ') ?? '';
            logger.raw(`  ${chalk.bold(title)} ${chalk.dim(`(${spec.relativePath})`)}`);
            if (tags) logger.raw(`    ${chalk.dim(`标签：${tags}`)}`);
          }
        }

        // 校验 user/global 级 spec 的适用范围声明
        const scopeWarnings = [];
        for (const group of allSpecs) {
          if (group.scope === 'user' || group.scope === 'global') {
            scopeWarnings.push(
              ...validateSpecsScope(group.specs, group.scope as 'user' | 'global'),
            );
          }
        }
        if (scopeWarnings.length > 0) {
          logger.raw(chalk.yellow(`\n⚠ ${scopeWarnings.length} 个 spec 缺少「适用范围」声明：`));
          for (const w of scopeWarnings) {
            logger.raw(chalk.yellow(`  • ${w.message}`));
          }
        }

        logger.raw('');
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // show
  cmd
    .command('show <file>')
    .description('查看 spec 信息（支持文件名、标题模糊匹配和 glob 语法）')
    .option('--scope <scope>', '限定层级（project / user / global）')
    .option('--user <username>', '查看指定用户的 spec（默认当前用户）')
    .option('--detail', '输出文件内容')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (file: string, opts) => {
      try {
        const currentUsername = await getUsername();
        const targetUsername = (opts.user as string) ?? currentUsername;
        await initDb();

        // 校验指定用户是否存在
        if (opts.user) {
          const allUsernames = await listAllUsernames();
          if (!allUsernames.includes(targetUsername)) {
            logger.raw(
              chalk.yellow(`用户不存在：${targetUsername}。可用用户：${allUsernames.join(', ')}`),
            );
            closeDb();
            return;
          }
        }

        const projectId = await resolveCurrentProjectId();

        const matches = await findSpecByName(targetUsername, projectId, file, {
          scope: opts.scope,
        });

        closeDb();

        if (matches.length === 0) {
          logger.raw(chalk.yellow(`未找到 spec：${file}`));
          return;
        }

        // JSON 输出
        if (opts.json) {
          const result = matches.map((m) => ({
            scope: m.scope,
            filePath: m.spec.filePath,
            relativePath: m.spec.relativePath,
            fileName: m.spec.fileName,
            title: m.spec.frontmatter.title ?? m.spec.fileName,
            tags: m.spec.frontmatter.tags ?? [],
            description: m.spec.frontmatter.description ?? null,
            ...(targetUsername !== currentUsername ? { sourceUser: targetUsername } : {}),
            ...(opts.detail ? { content: m.spec.content } : {}),
          }));
          outputJson(result, opts.jsonFormat);
          return;
        }

        // 普通输出
        const userTag =
          targetUsername !== currentUsername ? chalk.magenta(` [${targetUsername}]`) : '';
        for (const m of matches) {
          const s = m.spec;
          const title = s.frontmatter.title ?? s.fileName;
          logger.raw(chalk.bold(`\n${title}`) + userTag);
          logger.raw(`  层级：${chalk.cyan(m.scope)}`);
          logger.raw(`  路径：${chalk.dim(s.filePath)}`);
          if (s.frontmatter.tags?.length) {
            logger.raw(`  标签：${s.frontmatter.tags.join(', ')}`);
          }
          if (s.frontmatter.description) {
            logger.raw(`  描述：${s.frontmatter.description}`);
          }

          if (opts.detail) {
            logger.raw(chalk.dim('\n' + '─'.repeat(40)));
            logger.raw(s.content);
          }
          logger.raw('');
        }

        if (matches.length > 1) {
          // 判断是同名跨层级冲突还是模糊/glob 多匹配
          const uniquePaths = new Set(matches.map((m) => m.spec.relativePath));
          if (uniquePaths.size === 1) {
            logger.raw(
              chalk.yellow(
                `ℹ 在 ${matches.length} 个层级找到同名 spec，高优先级覆盖低优先级（project > user > global）`,
              ),
            );
          } else {
            logger.raw(chalk.dim(`\nℹ 共匹配 ${matches.length} 个 spec`));
          }
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // conflicts
  cmd
    .command('conflicts')
    .description('检测多层级同名 spec 冲突')
    .action(async () => {
      try {
        const username = await getUsername();
        const projectId = await resolveCurrentProjectId();
        if (!projectId) {
          logger.raw(chalk.yellow('当前目录不是 Lattice 项目'));
          return;
        }

        const conflicts = await detectSpecConflicts(username, projectId);

        if (conflicts.length === 0) {
          logger.raw(chalk.green('✓ 未检测到 spec 冲突'));
          return;
        }

        logger.raw(chalk.yellow(`\n检测到 ${conflicts.length} 个冲突：\n`));
        for (const c of conflicts) {
          logger.raw(chalk.bold(`  ${c.fileName}`));
          for (const level of c.levels) {
            logger.raw(`    [${level.scope}] ${chalk.dim(level.filePath)}`);
            logger.raw(`    ${chalk.dim(level.snippet)}`);
          }
          logger.raw('');
        }
        logger.raw(chalk.dim('提示：项目级 spec 优先级最高，会覆盖同名的用户级和全局级 spec。'));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // template
  const templateCmd = cmd.command('template').description('管理 spec 模板');

  templateCmd
    .command('list')
    .alias('ls')
    .description('列出可用的 spec 模板')
    .action(async () => {
      const templates = await listSpecTemplates();
      if (templates.length === 0) {
        logger.raw(chalk.yellow('当前没有可用模板。可先运行 lattice spec template sync-builtins'));
        return;
      }
      logger.raw(chalk.blue(`\n共 ${templates.length} 个模板：\n`));
      for (const t of templates) {
        logger.raw(
          `  ${chalk.bold(t.name)} — ${t.description} ${chalk.dim(`[${t.defaultScope}] [${t.source}] [${t.files.length} 文件]`)}`,
        );
      }
      logger.raw('');
    });

  templateCmd
    .command('apply <name>')
    .description('应用模板到当前项目')
    .action(async (name: string) => {
      try {
        const username = await getUsername();
        await initDb();

        const projectId = await resolveCurrentProjectId();
        if (!projectId) {
          logger.raw(chalk.yellow('当前目录不是 Lattice 项目'));
          closeDb();
          return;
        }

        const filePath = await applySpecTemplate(username, projectId, name);
        closeDb();

        if (filePath) {
          logger.raw(chalk.green(`✓ 模板 ${name} 已应用`));
          logger.raw(chalk.dim(`  ${filePath}`));
        } else {
          logger.raw(
            chalk.yellow(`未找到模板：${name}。可先运行 lattice spec template sync-builtins`),
          );
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  templateCmd
    .command('sync-builtins')
    .description('同步内置 spec 模板到全局模板目录')
    .option('--template <names>', '同步指定内置模板（逗号分隔）')
    .option('--all', '同步全部内置模板')
    .action(async (opts) => {
      try {
        const templateInput = opts.all ? 'all' : (opts.template as string | undefined);
        const templateNames = await resolveBundledSpecTemplateNames(templateInput);
        const result = await syncBundledSpecTemplatesWithPrompt(templateNames);

        logger.raw(chalk.green(`✓ 已同步 ${result.synced.length} 个内置模板`));
        if (result.skipped.length > 0) {
          logger.raw(chalk.yellow(`  跳过：${result.skipped.join(', ')}`));
        }
        if (result.missing.length > 0) {
          logger.raw(chalk.yellow(`  未找到：${result.missing.join(', ')}`));
        }
      } catch (err) {
        console.error(chalk.red('同步内置模板失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  templateCmd
    .command('pull <repo>')
    .description('从 Git 仓库拉取自定义模板')
    .action(async (repo: string) => {
      try {
        const result = await syncSpecTemplateRegistry(repo);
        const nextRegistries = [...new Set([...(await getConfiguredTemplateRegistries()), repo])];
        await writeConfiguredTemplateRegistries(nextRegistries);

        logger.raw(chalk.green(`✓ 已拉取模板仓库：${repo}`));
        logger.raw(chalk.dim(`  本地目录：${result.registryDir}`));
        logger.raw(chalk.dim(`  模板源目录：${result.templateSourceDir}`));
        logger.raw(chalk.dim(`  导入模板：${result.importedTemplates.join(', ') || '无'}`));
      } catch (err) {
        console.error(chalk.red('拉取模板失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  templateCmd
    .command('sync')
    .description('同步已配置的模板仓库')
    .option('--repo <repo>', '只同步指定仓库')
    .action(async (opts) => {
      try {
        const registries = opts.repo
          ? [opts.repo as string]
          : await getConfiguredTemplateRegistries();

        if (registries.length === 0) {
          logger.raw(
            chalk.yellow('当前没有已配置的模板仓库。可先运行 lattice spec template pull <repo>'),
          );
          return;
        }

        for (const repo of registries) {
          const result = await syncSpecTemplateRegistry(repo);
          logger.raw(chalk.green(`✓ ${repo}（导入 ${result.importedTemplates.length} 个模板）`));
        }
      } catch (err) {
        console.error(chalk.red('同步模板失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  const registryCmd = templateCmd.command('registry').description('管理模板仓库');

  registryCmd
    .command('list')
    .alias('ls')
    .description('列出已注册的模板仓库')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        const registries = await getConfiguredTemplateRegistries();

        if (registries.length === 0) {
          logger.raw(chalk.dim('暂无已注册模板仓库。'));
          return;
        }

        const infos = await listSpecTemplateRegistries(registries);

        if (opts.json) {
          outputJson(infos, opts.jsonFormat);
          return;
        }

        logger.raw(chalk.blue(`\n共 ${infos.length} 个模板仓库：\n`));
        for (const info of infos) {
          logger.raw(
            `  ${chalk.bold(info.repoUrl)} ${chalk.dim(info.exists ? '[已拉取]' : '[缺失]')}`,
          );
          logger.raw(`    ${chalk.dim(info.registryDir)}`);
          logger.raw(`    ${chalk.dim(`模板数：${info.importedTemplates.length}`)}`);
          if (info.importedTemplates.length > 0) {
            logger.raw(`    ${chalk.dim(`模板：${info.importedTemplates.join(', ')}`)}`);
          }
        }
        logger.raw('');
      } catch (err) {
        console.error(chalk.red('列出模板仓库失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  registryCmd
    .command('remove <repo>')
    .description('删除已注册的模板仓库')
    .action(async (repo: string) => {
      try {
        const registries = await getConfiguredTemplateRegistries();

        if (!registries.includes(repo)) {
          logger.raw(chalk.yellow(`未注册该模板仓库：${repo}`));
          return;
        }

        const remainingRepoUrls = registries.filter((item) => item !== repo);
        const removed = await removeSpecTemplateRegistry(repo, remainingRepoUrls);
        await writeConfiguredTemplateRegistries(remainingRepoUrls);
        await removeLegacyLocalTemplateRegistry(repo);

        logger.raw(chalk.green(`✓ 已删除模板仓库：${repo}`));
        logger.raw(chalk.dim(`  缓存目录：${removed.registryDir}`));
        logger.raw(chalk.dim(`  移除模板：${removed.importedTemplates.join(', ') || '无'}`));
      } catch (err) {
        console.error(chalk.red('删除模板仓库失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // ─── init / set / lint：frontmatter 收口写入命令 ───
  // 设计原则：frontmatter 改动只能通过这些命令；正文改动直接用 search_replace 等编辑工具
  // 详见 task 2026-05-28-2f08 PRD 第三节

  cmd
    .command('init <relative-path>')
    .description('创建 spec 文件（仅写 frontmatter + 占位标题；正文由 AI 用 search_replace 编辑）')
    .option('--scope <scope>', '层级（project / user / global），默认 project（当前在项目内时）')
    .option('--title <title>', '标题（必填）')
    .option('--description <description>', '摘要（强烈建议提供，三段式：作用范围+约束+作用）')
    .option('--tags <tags>', '标签，逗号分隔')
    .option('--force', '若文件已存在则覆盖')
    .action(async (relativePath: string, opts) => {
      try {
        const username = await getUsername();
        const scope = await resolveSpecScope(opts.scope);
        const baseDir = await resolveSpecScopeDir(scope, username);
        if (!baseDir) {
          logger.raw(
            chalk.red(
              `无法确定 spec 写入目录。当前若不在 lattice 项目目录，请显式指定 --scope user 或 --scope global。`,
            ),
          );
          process.exitCode = 1;
          return;
        }

        // 标准化 relativePath，保证以 .md 结尾且不能逃逸
        const normalized = normalizeSpecRelativePath(relativePath);
        if (!normalized) {
          logger.raw(chalk.red(`非法的相对路径：${relativePath}`));
          process.exitCode = 1;
          return;
        }
        const filePath = path.join(baseDir, normalized);

        if (await fileExists(filePath)) {
          if (!opts.force) {
            logger.raw(
              chalk.yellow(
                `spec 已存在：${filePath}\n如需覆盖，加 --force（仅覆盖 frontmatter 与占位标题，建议改用 spec set）`,
              ),
            );
            process.exitCode = 1;
            return;
          }
        }

        if (!opts.title || String(opts.title).trim() === '') {
          logger.raw(chalk.red('错误：必须提供 --title'));
          process.exitCode = 1;
          return;
        }

        const tags = parseTagsOption(opts.tags);
        const frontmatter: SpecFrontmatter = {
          title: String(opts.title).trim(),
        };
        if (opts.description) frontmatter.description = String(opts.description).trim();
        if (tags && tags.length > 0) frontmatter.tags = tags;

        // 占位正文：仅一行 H1，避免空文件
        const placeholderContent = `# ${frontmatter.title}\n\n<!-- 正文请用 search_replace 等编辑工具补充。CLI 不会再写入正文。 -->\n`;

        await ensureDir(path.dirname(filePath));
        await writeSpec(filePath, frontmatter, placeholderContent);

        // 重新读回，拿到自动生成的 id 与 lint 结果
        const parsed = await parseSpec(filePath);
        if (!parsed) {
          logger.raw(chalk.red(`已写入但回读失败：${filePath}`));
          process.exitCode = 1;
          return;
        }

        logger.raw(chalk.green(`✓ 已创建 spec：${filePath}`));
        logger.raw(chalk.dim(`  id: ${parsed.frontmatter.id ?? '(missing)'}`));
        logger.raw(chalk.dim(`  title: ${parsed.frontmatter.title ?? ''}`));
        if (parsed.frontmatter.description) {
          logger.raw(chalk.dim(`  description: ${parsed.frontmatter.description}`));
        }
        const report = lintSpecFrontmatter(parsed);
        printLintReport(report, { compact: true });
      } catch (err) {
        console.error(chalk.red('创建 spec 失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  cmd
    .command('set <file>')
    .description('修改 spec frontmatter（支持模糊匹配和 glob）')
    .option('--scope <scope>', '限定层级（project / user / global）')
    .option('--title <title>', '新标题')
    .option('--description <description>', '新摘要（覆盖整个 description 字段）')
    .option('--add-tag <tag>', '新增标签（可重复使用）', collectArg, [])
    .option('--rm-tag <tag>', '移除标签（可重复使用）', collectArg, [])
    .option('--id <id>', '强制指定 id（一般不需要，谨慎使用）')
    .action(async (file: string, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const projectId = (await resolveCurrentProject())?.id ?? null;
        const matches = await findSpecByName(username, projectId, file, {
          scope: opts.scope,
        });
        closeDb();

        if (matches.length === 0) {
          logger.raw(chalk.yellow(`未找到 spec：${file}`));
          process.exitCode = 1;
          return;
        }
        if (matches.length > 1) {
          const uniquePaths = new Set(matches.map((m) => m.spec.relativePath));
          const hint =
            uniquePaths.size === 1
              ? '请显式指定 --scope <project|user|global>'
              : '请使用更精确的名称或 --scope 缩小范围';
          logger.raw(chalk.yellow(`匹配到 ${matches.length} 个 spec，${hint}`));
          for (const m of matches) {
            logger.raw(chalk.dim(`  [${m.scope}] ${m.spec.filePath}`));
          }
          process.exitCode = 1;
          return;
        }

        const spec = matches[0].spec;
        const fm: SpecFrontmatter = { ...spec.frontmatter };

        if (opts.id !== undefined) {
          if (!isValidSpecId(opts.id)) {
            logger.raw(chalk.red(`非法 id：${opts.id}（应为 spec-{8 位 base36}）`));
            process.exitCode = 1;
            return;
          }
          fm.id = opts.id;
        }
        if (opts.title !== undefined) fm.title = String(opts.title).trim();
        if (opts.description !== undefined) fm.description = String(opts.description).trim();

        const addTags: string[] = Array.isArray(opts.addTag) ? opts.addTag : [];
        const rmTags: string[] = Array.isArray(opts.rmTag) ? opts.rmTag : [];
        if (addTags.length > 0 || rmTags.length > 0) {
          const current = new Set<string>(Array.isArray(fm.tags) ? fm.tags : []);
          for (const t of addTags) current.add(String(t).trim());
          for (const t of rmTags) current.delete(String(t).trim());
          fm.tags = [...current];
        }

        await writeSpec(spec.filePath, fm, spec.content);

        const reread = await parseSpec(spec.filePath);
        logger.raw(chalk.green(`✓ 已更新 spec：${spec.filePath}`));
        if (reread) {
          logger.raw(chalk.dim(`  id: ${reread.frontmatter.id ?? '(missing)'}`));
          logger.raw(chalk.dim(`  title: ${reread.frontmatter.title ?? ''}`));
          if (reread.frontmatter.description) {
            logger.raw(chalk.dim(`  description: ${reread.frontmatter.description}`));
          }
          printLintReport(lintSpecFrontmatter(reread), { compact: true });
        }
      } catch (err) {
        console.error(chalk.red('修改 spec 失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  cmd
    .command('lint [file]')
    .description('校验 spec frontmatter 完整性（支持模糊匹配和 glob）')
    .option('--scope <scope>', '限定层级（project / user / global）')
    .option('--all', '扫描全部 spec（含 project + user + global）')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (file: string | undefined, opts) => {
      try {
        const username = await getUsername();
        await initDb();
        const projectId = (await resolveCurrentProject())?.id ?? null;

        let reports: SpecLintReport[] = [];

        if (opts.all) {
          const collected: ParsedSpec[] = [];
          if (!opts.scope || opts.scope === 'global') {
            collected.push(...(await getGlobalSpecs()));
          }
          if (!opts.scope || opts.scope === 'user') {
            collected.push(...(await getUserSpecs(username)));
          }
          if (projectId && (!opts.scope || opts.scope === 'project')) {
            collected.push(...(await getProjectSpecs(username, projectId)));
          }
          reports = lintSpecs(collected);
        } else if (file) {
          const matches = await findSpecByName(username, projectId, file, {
            scope: opts.scope,
          });
          if (matches.length === 0) {
            closeDb();
            logger.raw(chalk.yellow(`未找到 spec：${file}`));
            process.exitCode = 1;
            return;
          }
          reports = matches.map((m) => lintSpecFrontmatter(m.spec));
          if (matches.length > 1) {
            const uniquePaths = new Set(matches.map((m) => m.spec.relativePath));
            if (uniquePaths.size > 1) {
              logger.raw(
                chalk.dim(`ℹ "${file}" 模糊匹配到 ${matches.length} 个 spec，全部 lint：`),
              );
            }
          }
        } else {
          closeDb();
          logger.raw(chalk.yellow('用法：lattice spec lint <file> 或 lattice spec lint --all'));
          process.exitCode = 1;
          return;
        }

        closeDb();

        if (opts.json) {
          outputJson(reports, opts.jsonFormat);
          // 有 error 时退出码非 0
          if (reports.some((r) => !r.ok)) process.exitCode = 1;
          return;
        }

        let totalErrors = 0;
        let totalWarnings = 0;
        for (const r of reports) {
          totalErrors += r.issues.filter((i) => i.severity === 'error').length;
          totalWarnings += r.issues.filter((i) => i.severity === 'warning').length;
          printLintReport(r, { compact: false });
        }

        const summary =
          totalErrors === 0 && totalWarnings === 0
            ? chalk.green(`✓ ${reports.length} 个 spec 全部通过`)
            : chalk.yellow(
                `共 ${reports.length} 个 spec，error: ${totalErrors}，warning: ${totalWarnings}`,
              );
        logger.raw(`\n${summary}`);
        if (totalErrors > 0) process.exitCode = 1;
      } catch (err) {
        console.error(chalk.red('lint 失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // migrate
  cmd
    .command('migrate')
    .description('批量迁移历史 spec：自动补 id / updated / title（不自动补 description）')
    .option('--scope <scope>', '限定层级（all / global / user / project），默认 all')
    .option('--dry-run', '仅报告不写入')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        await initDb();
        const projectId = (await resolveCurrentProject())?.id ?? null;
        const result = await migrateSpecs({
          scope: opts.scope ?? 'all',
          dryRun: opts.dryRun ?? false,
          projectId,
        });
        closeDb();

        if (opts.json) {
          outputJson(result, opts.jsonFormat);
          if (result.errors.length > 0) process.exitCode = 1;
          return;
        }

        if (opts.dryRun) {
          logger.raw(chalk.dim('(dry-run 模式，不写入文件)\n'));
        }

        if (result.migrated.length > 0) {
          logger.raw(chalk.green(`✓ 已迁移 ${result.migrated.length} 个 spec：`));
          for (const m of result.migrated) {
            logger.raw(chalk.dim(`  ${m.filePath}  [+${m.addedFields.join(', +')}]`));
          }
        }
        if (result.skipped.length > 0) {
          logger.raw(chalk.dim(`\n跳过（已合规）：${result.skipped.length} 个`));
        }
        if (result.needsDescription.length > 0) {
          logger.raw(
            chalk.yellow(
              `\n⚠ ${result.needsDescription.length} 个 spec 缺 description（需手动补）：`,
            ),
          );
          for (const p of result.needsDescription.slice(0, 10)) {
            logger.raw(chalk.dim(`  ${p}`));
          }
          if (result.needsDescription.length > 10) {
            logger.raw(chalk.dim(`  ... 还有 ${result.needsDescription.length - 10} 个`));
          }
        }
        if (result.errors.length > 0) {
          logger.raw(chalk.red(`\n✗ ${result.errors.length} 个出错：`));
          for (const e of result.errors) {
            logger.raw(chalk.red(`  ${e.filePath}: ${e.message}`));
          }
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(chalk.red('migrate 失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
  // suggest-description
  cmd
    .command('suggest-description')
    .alias('suggest-desc')
    .description('列出缺少 description 的 spec，并展示上下文帮助补写')
    .option('--scope <scope>', '限定层级（all / global / user / project），默认 all')
    .option('--limit <n>', '最多展示几条（默认 20）', '20')
    .option('--json', 'JSON 格式输出')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (opts) => {
      try {
        await initDb();
        const username = await getUsername();
        const projectId = (await resolveCurrentProject())?.id ?? null;
        const scope = (opts.scope ?? 'all') as string;

        const allSpecs: ParsedSpec[] = [];
        if (scope === 'all' || scope === 'global') {
          allSpecs.push(...(await getGlobalSpecs()));
        }
        if (scope === 'all' || scope === 'user') {
          allSpecs.push(...(await getUserSpecs(username)));
        }
        if (projectId && (scope === 'all' || scope === 'project')) {
          allSpecs.push(...(await getProjectSpecs(username, projectId)));
        }
        closeDb();

        const missing = allSpecs.filter(
          (s) =>
            !s.frontmatter.description ||
            (typeof s.frontmatter.description === 'string' &&
              s.frontmatter.description.trim() === ''),
        );

        if (missing.length === 0) {
          logger.raw(chalk.green('✓ 所有 spec 都已有 description'));
          return;
        }

        const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
        const shown = missing.slice(0, limit);

        if (opts.json) {
          const data = shown.map((s) => ({
            filePath: s.filePath,
            relativePath: s.relativePath,
            title: s.frontmatter.title ?? s.fileName.replace(/\.md$/i, ''),
            contentSnippet: extractSnippet(s.content, 3),
          }));
          outputJson({ total: missing.length, shown: data.length, specs: data }, opts.jsonFormat);
          return;
        }

        logger.raw(
          chalk.yellow(
            `\n⚠ ${missing.length} 个 spec 缺少 description（展示前 ${shown.length} 个）：\n`,
          ),
        );
        logger.raw(
          chalk.dim('  description 格式建议：三段式 — "适用于…；约束/规则…；目的/效果…"\n'),
        );

        for (const s of shown) {
          const title = s.frontmatter.title ?? s.fileName.replace(/\.md$/i, '');
          logger.raw(`  ${chalk.bold(title)}`);
          logger.raw(chalk.dim(`    路径：${s.filePath}`));
          const snippet = extractSnippet(s.content, 3);
          if (snippet) {
            logger.raw(chalk.dim(`    内容预览：`));
            for (const line of snippet.split('\n')) {
              logger.raw(chalk.dim(`      ${line}`));
            }
          }
          logger.raw(
            chalk.cyan(`    → lattice spec set "${s.relativePath}" --description "<你的摘要>"\n`),
          );
        }

        if (missing.length > limit) {
          logger.raw(chalk.dim(`  ... 还有 ${missing.length - limit} 个，使用 --limit 调整`));
        }
      } catch (err) {
        console.error(chalk.red('suggest-description 失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ─── 辅助函数 ───

/** commander 多次出现的选项收集器 */
function collectArg(value: string, prev: string[]): string[] {
  return [...(prev ?? []), value];
}

/**
 * 解析 spec scope。
 *
 * - 显式指定 --scope 时直接采用
 * - 未指定时：当前若在 lattice 项目目录则默认 project；否则需要用户显式指定，返回 null
 */
async function resolveSpecScope(
  explicit: string | undefined,
): Promise<'project' | 'user' | 'global' | null> {
  if (explicit === 'project' || explicit === 'user' || explicit === 'global') return explicit;
  if (explicit !== undefined) return null;
  const cur = await resolveCurrentProject();
  return cur ? 'project' : null;
}

/** 解析 spec scope 对应的写入根目录 */
async function resolveSpecScopeDir(
  scope: 'project' | 'user' | 'global' | null,
  username: string,
): Promise<string | null> {
  if (scope === 'global') return getGlobalSpecDir();
  if (scope === 'user') return getUserSpecDir(username);
  if (scope === 'project') {
    const cur = await resolveCurrentProject();
    if (!cur) return null;
    return getProjectSpecDir(username, cur.id);
  }
  return null;
}

/** 标准化 spec 相对路径：保证 .md 结尾、禁止 .. 逃逸 */
function normalizeSpecRelativePath(relative: string): string | null {
  if (!relative) return null;
  let p = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.split('/').some((seg) => seg === '..')) return null;
  if (!p.toLowerCase().endsWith('.md')) p = `${p}.md`;
  return p;
}

/** 解析 --tags 字符串为字符串数组（支持逗号分隔，去空） */
function parseTagsOption(input: unknown): string[] | undefined {
  if (input === undefined) return undefined;
  if (Array.isArray(input)) {
    return input.map((t) => String(t).trim()).filter((t) => t.length > 0);
  }
  return String(input)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** 提取正文前 N 行有意义内容（跳过空行和注释行）作为 snippet */
function extractSnippet(content: string, maxLines: number): string {
  const lines = content.split('\n').filter((l) => {
    const trimmed = l.trim();
    return trimmed.length > 0 && !trimmed.startsWith('<!--');
  });
  return lines.slice(0, maxLines).join('\n');
}

/** 打印 lint 报告 */
function printLintReport(report: SpecLintReport, opts: { compact: boolean }): void {
  const errors = report.issues.filter((i) => i.severity === 'error');
  const warnings = report.issues.filter((i) => i.severity === 'warning');

  if (opts.compact) {
    if (errors.length === 0 && warnings.length === 0) {
      logger.raw(chalk.green('  ✓ frontmatter 通过 lint'));
      return;
    }
    if (errors.length > 0) {
      logger.raw(chalk.red(`  ✗ ${errors.length} 条 error，${warnings.length} 条 warning`));
    } else {
      logger.raw(chalk.yellow(`  ⚠ ${warnings.length} 条 warning`));
    }
    for (const i of report.issues) {
      const tag = i.severity === 'error' ? chalk.red('error') : chalk.yellow('warn');
      logger.raw(`    ${tag} [${i.field}] ${i.message}`);
    }
    return;
  }

  // 完整模式：每个 spec 一段
  const status = report.ok ? chalk.green('OK') : chalk.red('ERROR');
  logger.raw(`\n${status} ${chalk.bold(report.relativePath)} ${chalk.dim(report.filePath)}`);
  if (report.issues.length === 0) {
    logger.raw(chalk.green('  ✓ frontmatter 完整'));
    return;
  }
  for (const i of report.issues) {
    const tag = i.severity === 'error' ? chalk.red('error') : chalk.yellow('warn');
    logger.raw(`  ${tag} [${i.field}] ${i.message}`);
  }
}
