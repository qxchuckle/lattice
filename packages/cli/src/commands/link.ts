import { Command } from 'commander';
import chalk from 'chalk';
import {
  generateProjectId,
  registerProject,
  applySpecTemplate,
  getSpecTemplate,
  listSpecTemplates,
  writeJSON,
  getUsername,
  initDb,
  closeDb,
} from '@qcqx/lattice-core';
import { logger, resolveProjectAtDirectory } from '../utils';

export function registerLinkCommand(program: Command): void {
  program
    .command('link')
    .description('将当前项目注册到 Lattice')
    .option('--name <name>', '手动指定项目名称')
    .option('--description <desc>', '项目描述')
    .option('--groups <groups>', '项目分组（逗号分隔）')
    .option('--tags <tags>', '标签（逗号分隔）')
    .option('--template <templates>', '应用 spec 模板（逗号分隔，或使用 all）')
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const groups = opts.groups
          ? (opts.groups as string).split(',').map((s: string) => s.trim())
          : undefined;
        const tags = opts.tags
          ? (opts.tags as string).split(',').map((s: string) => s.trim())
          : undefined;

        // 检查是否已存在 lattice.json
        const project = await resolveProjectAtDirectory(cwd);
        if (project) {
          const username = await getUsername();
          await initDb();
          const meta = await registerProject(username, project.id, project.root, {
            name: opts.name,
            description: opts.description,
            groups,
            tags,
          });
          closeDb();

          logger.raw(chalk.yellow('当前目录已注册为 Lattice 项目，已更新项目元数据'));
          logger.raw(chalk.dim(`  名称：${meta.name}`));
          logger.raw(chalk.dim(`  ID：${project.id}`));
          logger.raw(chalk.dim(`  路径：${project.root}`));
          if (meta.gitRemote) {
            logger.raw(chalk.dim(`  Git：${meta.gitRemote}`));
          }
          return;
        }

        const username = await getUsername();
        await initDb();

        // 生成 ID 并写入 lattice.json
        const id = generateProjectId(cwd);
        await writeJSON(`${cwd}/lattice.json`, { id });

        // 注册项目
        const meta = await registerProject(username, id, cwd, {
          name: opts.name,
          description: opts.description,
          groups,
          tags,
        });

        const appliedTemplatePaths: string[] = [];
        if (opts.template) {
          const templateNames = await resolveTemplateNames(opts.template as string);

          if (templateNames.length === 0) {
            closeDb();
            logger.raw(chalk.yellow('未匹配到任何可用模板。'));
            return;
          }

          for (const templateName of templateNames) {
            const filePath = await applySpecTemplate(username, id, templateName);
            if (filePath) {
              appliedTemplatePaths.push(filePath);
            }
          }
        }

        closeDb();

        logger.raw(chalk.green('✓ 项目已注册到 Lattice'));
        logger.raw(chalk.dim(`  名称：${meta.name}`));
        logger.raw(chalk.dim(`  ID：${id}`));
        logger.raw(chalk.dim(`  路径：${cwd}`));
        if (meta.gitRemote) {
          logger.raw(chalk.dim(`  Git：${meta.gitRemote}`));
        }
        if (appliedTemplatePaths.length > 0) {
          logger.raw(chalk.green(`\n✓ 已应用 ${appliedTemplatePaths.length} 个模板文件`));
          for (const filePath of appliedTemplatePaths) {
            logger.raw(chalk.dim(`  ${filePath}`));
          }
        }
      } catch (err) {
        console.error(chalk.red('注册失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
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
