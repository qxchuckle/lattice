import { Command } from 'commander';
import chalk from 'chalk';
import { select, confirm } from '@inquirer/prompts';
import {
  generateProjectId,
  registerProject,
  applySpecTemplate,
  getSpecTemplate,
  listSpecTemplates,
  writeJSON,
  removeFile,
  getUsername,
  initDb,
  closeDb,
  collectFingerprint,
  findCandidatesByFingerprint,
  findProjectById,
  getProjectMeta,
  CONFIDENCE_THRESHOLDS,
} from '@qcqx/lattice-core';
import type { ProjectMatchCandidate } from '@qcqx/lattice-core';
import { logger, resolveProjectAtDirectory } from '../utils';

export function registerLinkCommand(program: Command): void {
  program
    .command('link')
    .description('将当前项目注册到 Lattice（含指纹识别与选单）')
    .option('--name <name>', '手动指定项目名称')
    .option('--description <desc>', '项目描述')
    .option('--groups <groups>', '项目分组（逗号分隔）')
    .option('--tags <tags>', '标签（逗号分隔）')
    .option('--template <templates>', '应用 spec 模板（逗号分隔，或使用 all）')
    .option('--restore <id>', '恢复到已有项目 ID（不交互）')
    .option('--force-new', '强制创建新项目，跳过相似检测（若当前目录已有 lattice.json 将被覆盖）')
    .option(
      '--no-auto-restore',
      '--yes 下检测到唯一 high score 候选时默认自动恢复；添加该选项可关闭此行为',
    )
    .option('-y, --yes', '跳过交互确认，默认创建新项目（启用 auto-restore 时可能恢复）')
    .action(async (opts) => {
      try {
        const cwd = process.cwd();
        const groups = opts.groups
          ? (opts.groups as string).split(',').map((s: string) => s.trim())
          : undefined;
        const tags = opts.tags
          ? (opts.tags as string).split(',').map((s: string) => s.trim())
          : undefined;

        // 1. 检查当前目录是否已有 lattice.json
        //    - 默认：幂等更新元数据
        //    - --force-new：覆盖原绑定，走新建分支
        //    - --restore：同样覆盖原绑定
        const project = await resolveProjectAtDirectory(cwd);
        if (project && !opts.forceNew && !opts.restore) {
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
          if (meta.gitRemotes?.length) {
            logger.raw(chalk.dim(`  Git：${meta.gitRemotes.join(', ')}`));
          }
          return;
        }

        // 如果 --force-new 且存在原 lattice.json，先刪掉让其走新建分支
        if (project && opts.forceNew) {
          await removeFile(project.latticeJsonPath);
          logger.raw(
            chalk.yellow(
              `⚠ --force-new：已移除原绑定 lattice.json（原项目 ${project.id.slice(0, 8)}… 本地数据在 Lattice 中仍保留）`,
            ),
          );
        }

        // 如果 --restore 且存在原 lattice.json，先刪掉让其走明确恢复分支
        if (project && opts.restore) {
          await removeFile(project.latticeJsonPath);
        }

        const username = await getUsername();
        await initDb();

        // 2. --restore <id>：直接绑定到已有项目
        if (opts.restore) {
          const target = findProjectById(opts.restore as string);
          if (!target) {
            closeDb();
            logger.raw(chalk.red(`未找到项目：${opts.restore}`));
            process.exitCode = 1;
            return;
          }
          await writeJSON(`${cwd}/lattice.json`, { id: target.id });
          const meta = await registerProject(username, target.id, cwd, {
            name: opts.name,
            description: opts.description,
            groups,
            tags,
          });
          closeDb();
          logger.raw(chalk.green(`✓ 已将当前目录关联到项目：${meta.name}`));
          logger.raw(chalk.dim(`  ID：${target.id}`));
          logger.raw(chalk.dim(`  路径：${cwd}`));
          return;
        }

        // 3. 指纹采集 + 相似检测
        let chosenId: string | null = null;
        if (!opts.forceNew) {
          const fp = await collectFingerprint(cwd);
          const candidates = findCandidatesByFingerprint(fp.entries);

          if (candidates.length > 0) {
            if (opts.yes) {
              const highOnes = candidates.filter((c) => c.score >= CONFIDENCE_THRESHOLDS.high);
              // --yes + 唯一 high 候选 + auto-restore 未关闭 → 自动恢复避免重复创建
              if (highOnes.length === 1 && opts.autoRestore !== false) {
                chosenId = highOnes[0].projectId;
                logger.raw(
                  chalk.green(
                    `✓ --yes 检测到唯一 high score 候选 ${highOnes[0].projectName} (${highOnes[0].projectId.slice(0, 8)}…, score=${highOnes[0].score})，已自动恢复绑定。`,
                  ),
                );
                logger.raw(
                  chalk.dim('  如需强制新建请使用 --force-new，或加 --no-auto-restore 跳过此行为'),
                );
              } else {
                logger.raw(
                  chalk.yellow(
                    `⚠ 检测到 ${candidates.length} 个可能重复的已有项目，--yes 下跳过选单，将创建新项目。`,
                  ),
                );
                for (const c of candidates.slice(0, 5)) {
                  logger.raw(
                    chalk.dim(
                      `  - ${c.projectName} (${c.projectId.slice(0, 8)}…, ${c.confidence}, score=${c.score})`,
                    ),
                  );
                }
                logger.raw(
                  chalk.dim('  提示：若想恢复到其中某个项目，请使用 lattice link --restore <id>'),
                );
              }
            } else {
              chosenId = await promptCandidateSelection(candidates, username);
            }
          }
        }

        // 4. 根据选择创建或绑定
        let id: string;
        if (chosenId) {
          id = chosenId;
          logger.raw(chalk.dim(`  关联到已有项目：${id}`));
        } else {
          id = generateProjectId(cwd);
        }

        await writeJSON(`${cwd}/lattice.json`, { id });

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

        logger.raw(
          chalk.green(chosenId ? '✓ 项目已重新关联（恢复到已有项目）' : '✓ 项目已注册到 Lattice'),
        );
        logger.raw(chalk.dim(`  名称：${meta.name}`));
        logger.raw(chalk.dim(`  ID：${id}`));
        logger.raw(chalk.dim(`  路径：${cwd}`));
        if (meta.gitRemotes?.length) {
          logger.raw(chalk.dim(`  Git：${meta.gitRemotes.join(', ')}`));
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

/**
 * 根据候选信度决定交互方式：
 * - high：仅 1 个 high 则默认选择它；N 个 high 则让用户选择
 * - medium：列出候选，默认创建新项目
 * - low：提示但默认创建新项目
 * 返回选中的 projectId，null 表示选择创建新项目
 */
async function promptCandidateSelection(
  candidates: ProjectMatchCandidate[],
  username: string,
): Promise<string | null> {
  const top = candidates.slice(0, 5);
  const high = top.filter((c) => c.score >= CONFIDENCE_THRESHOLDS.high);

  logger.raw(chalk.yellow('⚠ 检测到当前目录与以下已有项目可能重复：\n'));
  for (const c of top) {
    const meta = await getProjectMeta(username, c.projectId).catch(() => null);
    const paths = meta?.localPaths?.length ? meta.localPaths.join(', ') : '(无路径记录)';
    logger.raw(
      `  ${chalk.bold(c.projectName)} ${chalk.dim(`(${c.projectId.slice(0, 8)}…)`)} ${chalk.cyan(`[${c.confidence}]`)} score=${c.score}`,
    );
    logger.raw(chalk.dim(`    证据：${c.evidence.map((e) => e.key).join(', ')}`));
    logger.raw(chalk.dim(`    路径：${paths}`));
  }
  logger.raw('');

  // 如果仅有一个 high，默认选择该项
  if (high.length === 1) {
    const ok = await confirm({
      message: `是否将当前目录关联到“${high[0].projectName}”？`,
      default: true,
    });
    return ok ? high[0].projectId : null;
  }

  // 多个候选，弹选单
  const choices = [
    ...top.map((c) => ({
      name: `${c.projectName} (${c.confidence}, score=${c.score})`,
      value: c.projectId,
    })),
    { name: chalk.green('创建新项目'), value: '__new__' },
  ];
  const answer = await select<string>({
    message: '请选择操作：',
    choices,
    default: high.length > 0 ? high[0].projectId : '__new__',
  });
  return answer === '__new__' ? null : answer;
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
