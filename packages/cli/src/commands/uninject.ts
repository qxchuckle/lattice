import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { homedir } from 'node:os';
import {
  getAIToolConfigs,
  scanInjections,
  executeUninjectPlan,
  readInitMeta,
  type InjectionFinding,
} from '@qcqx/lattice-core';
import { logger, shouldSkipConfirm } from '../utils';

export function registerUninjectCommand(program: Command): void {
  program
    .command('uninject')
    .description(
      '清除 ltc init 注入到外部 AI 客户端的文档（rules 标记块 / skills-lattice / commands-lattice / agents-lattice-*.md）；不动 ~/.lattice 数据。默认先报告将删清单再确认执行',
    )
    .option('-f, --force', '跳过确认直接清除')
    .option('--tool <ids>', '仅清除指定平台（逗号分隔，如 qoder,cursor）')
    .option('--dry-run', '只报告将清除的内容，不实际执行')
    .action(async (opts) => {
      try {
        const home = homedir();

        // 校验 --tool 平台 id
        const validIds = getAIToolConfigs(home).map((t) => t.id);
        let toolIds: string[] | undefined;
        if (opts.tool) {
          toolIds = String(opts.tool)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const unknown = toolIds.filter((id) => !validIds.includes(id));
          if (unknown.length > 0) {
            logger.raw(chalk.red(`未知平台 id：${unknown.join(', ')}`));
            logger.raw(chalk.dim(`  可选：${validIds.join(', ')}`));
            process.exitCode = 1;
            return;
          }
        }

        logger.raw(chalk.blue('正在排查 lattice 对 AI 客户端的注入残留...'));
        // 全量排查为唯一真源：从足迹表反推 + 标记/命名自识别，不依赖任何记录
        const plan = await scanInjections({ home, toolIds });

        // init-meta 仅作提示（清除正确性不依赖它）
        try {
          const meta = await readInitMeta();
          if (meta) {
            const date = meta.injectedAt ? meta.injectedAt.slice(0, 10) : '未知时间';
            logger.raw(
              chalk.dim(
                `  注入记录：${date} 用 v${meta.version} 注入了 ${
                  meta.platforms.join(', ') || '（空）'
                }（仅提示，清除以实际排查为准）`,
              ),
            );
          }
        } catch {
          // init-meta 读取失败不影响排查
        }

        if (plan.findings.length === 0) {
          logger.raw(chalk.green('\n✓ 未发现 lattice 注入残留，无需清除。'));
          if (plan.scannedRoots.length > 0) {
            logger.raw(chalk.dim(`  已排查 ${plan.scannedRoots.length} 个客户端根目录`));
          }
          return;
        }

        // 报告将删清单（按客户端根分组）
        logger.raw(chalk.yellow(`\n将清除以下内容（共 ${plan.findings.length} 项）：`));
        const byTool = new Map<string, InjectionFinding[]>();
        for (const f of plan.findings) {
          const key = `${f.toolName} (${f.targetRoot})`;
          const arr = byTool.get(key) ?? [];
          arr.push(f);
          byTool.set(key, arr);
        }
        for (const [toolLabel, items] of byTool) {
          logger.raw(chalk.cyan(`\n  ${toolLabel}`));
          const kindWidth = Math.max(...items.map((i) => i.kind.length));
          const pathWidth = Math.max(...items.map((i) => i.path.length));
          for (const item of items) {
            logger.raw(
              chalk.dim(
                `    ${item.kind.padEnd(kindWidth)}  ${item.path.padEnd(pathWidth)}  ${
                  item.detail
                }`,
              ),
            );
          }
        }

        if (opts.dryRun) {
          logger.raw(chalk.dim('\n（--dry-run：仅报告，未执行清除）'));
          return;
        }

        if (!shouldSkipConfirm(opts)) {
          const confirmed = await confirm({
            message: `\n确认清除以上 ${plan.findings.length} 项？（共享文件仅移除 LATTICE 标记块，保留你的内容）`,
            default: false,
          });
          if (!confirmed) {
            logger.raw(chalk.dim('已取消'));
            return;
          }
        }

        const result = await executeUninjectPlan(plan);
        logger.raw(
          chalk.green(
            `\n✓ 清除完成：删除 ${result.deletedDirs.length} 个目录、${result.deletedFiles.length} 个文件，从 ${result.removedBlocks.length} 个共享文件移除标记块。`,
          ),
        );
        logger.raw(chalk.dim('  ~/.lattice 数据未改动；如需重新注入运行 ltc init。'));
      } catch (err) {
        logger.stderr(chalk.red('清除失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
