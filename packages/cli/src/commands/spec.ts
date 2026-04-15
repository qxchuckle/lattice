import { Command } from 'commander';
import chalk from 'chalk';
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
  syncSpecTemplateRegistry,
  listSpecTemplateRegistries,
  removeSpecTemplateRegistry,
} from '@qcqx/lattice-core';
import { logger, resolveCurrentProject } from '../utils';
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
          logger.raw(JSON.stringify(allSpecs, null, 2));
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
        logger.raw('');
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // show
  cmd
    .command('show <file>')
    .description('查看 spec 内容')
    .action(async (file: string) => {
      try {
        const spec = await parseSpec(file);
        if (!spec) {
          logger.raw(chalk.yellow(`未找到文件：${file}`));
          return;
        }

        const title = spec.frontmatter.title ?? spec.fileName;
        logger.raw(chalk.bold(`\n${title}`));
        if (spec.frontmatter.tags?.length) {
          logger.raw(chalk.dim(`标签：${spec.frontmatter.tags.join(', ')}`));
        }
        logger.raw(chalk.dim('─'.repeat(40)));
        logger.raw(spec.content);
        logger.raw('');
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
    .action(async (opts) => {
      try {
        const registries = await getConfiguredTemplateRegistries();

        if (registries.length === 0) {
          logger.raw(chalk.dim('暂无已注册模板仓库。'));
          return;
        }

        const infos = await listSpecTemplateRegistries(registries);

        if (opts.json) {
          logger.raw(JSON.stringify(infos, null, 2));
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
}
