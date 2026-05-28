import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import {
  getUsername,
  listTrashItems,
  resolveTrashById,
  restoreFromTrash,
  purgeTrashItem,
  emptyTrash,
  linkTaskProject,
  initDb,
  closeDb,
  registerProject,
} from '@qcqx/lattice-core';
import type { TrashMeta } from '@qcqx/lattice-core';
import { logger, shouldSkipConfirm } from '../utils';

export function registerTrashCommand(program: Command): void {
  const cmd = program.command('trash').description('垃圾桶管理（查看、恢复、清空已删除的内容）');

  // list
  cmd
    .command('list')
    .alias('ls')
    .description('列出垃圾桶中的内容')
    .option('--type <type>', '按类型筛选（task/project/spec）')
    .action(async (opts) => {
      try {
        const username = await getUsername();
        const items = await listTrashItems(username);

        const filtered = opts.type ? items.filter((i: TrashMeta) => i.type === opts.type) : items;

        if (filtered.length === 0) {
          logger.raw(chalk.dim('垃圾桶为空'));
          return;
        }

        logger.raw(chalk.bold(`垃圾桶中共 ${filtered.length} 项：\n`));

        for (const item of filtered) {
          const typeIcon = item.type === 'task' ? '📋' : item.type === 'project' ? '📦' : '📄';
          const age = getRelativeTime(item.trashedAt);
          logger.raw(`  ${typeIcon} ${chalk.white(item.title)} ${chalk.dim(`[${item.type}]`)}`);
          logger.raw(`    ${chalk.dim(`ID: ${item.id}`)}`);
          logger.raw(`    ${chalk.dim(`删除于: ${age}`)}`);
          logger.raw('');
        }

        logger.raw(chalk.dim('使用 lattice trash restore <id> 恢复，lattice trash purge 清空'));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // restore
  cmd
    .command('restore <id>')
    .description('从垃圾桶恢复已删除的内容')
    .action(async (id: string) => {
      try {
        const match = await resolveTrashById(id);
        if (!match) {
          logger.raw(chalk.yellow(`垃圾桶中未找到条目：${id}`));
          return;
        }

        await initDb();
        const restored = await restoreFromTrash(match.id);

        // 恢复数据库关联
        if (restored.type === 'task' && restored.restoreHints?.projects) {
          const projects = restored.restoreHints.projects as string[];
          for (const pid of projects) {
            try {
              linkTaskProject(restored.entityId, pid);
            } catch {
              // 项目可能已不存在
            }
          }
        }

        if (restored.type === 'project' && restored.restoreHints) {
          const username = await getUsername();
          const localPaths =
            (restored.restoreHints.localPaths as string[] | undefined) ??
            (restored.restoreHints.localPath ? [restored.restoreHints.localPath as string] : []);
          // 选取仍然存在的路径作为主路径
          let primary: string | null = null;
          for (const p of localPaths) {
            try {
              const { stat } = await import('node:fs/promises');
              await stat(p);
              primary = p;
              break;
            } catch {
              // 跳过不存在的路径
            }
          }
          if (primary) {
            try {
              await registerProject(username, restored.entityId, primary);
            } catch {
              // 注册可能失败（如路径已不存在），文件已恢复就行
            }
          }
        }

        closeDb();

        logger.raw(chalk.green(`✓ 已恢复：${restored.title}（${restored.type}）`));
        logger.raw(chalk.dim(`  原始位置：${restored.originalPath}`));
      } catch (err) {
        console.error(chalk.red('恢复失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // purge
  cmd
    .command('purge [id]')
    .description('彻底删除垃圾桶中的内容（不可恢复）')
    .option('-f, --force', '跳过确认')
    .option('--all', '清空整个垃圾桶')
    .action(async (id: string | undefined, opts) => {
      try {
        const username = await getUsername();

        if (id) {
          // 删除单个
          const match = await resolveTrashById(id);
          if (!match) {
            logger.raw(chalk.yellow(`垃圾桶中未找到条目：${id}`));
            return;
          }

          if (!shouldSkipConfirm(opts)) {
            const confirmed = await confirm({
              message: `确认彻底删除「${match.title}」？此操作不可恢复。`,
              default: false,
            });
            if (!confirmed) {
              logger.raw(chalk.dim('已取消'));
              return;
            }
          }

          await purgeTrashItem(match.id);
          logger.raw(chalk.green(`✓ 已彻底删除：${match.title}`));
        } else if (opts.all) {
          // 清空全部
          const items = await listTrashItems(username);
          if (items.length === 0) {
            logger.raw(chalk.dim('垃圾桶已经是空的'));
            return;
          }

          if (!shouldSkipConfirm(opts)) {
            const confirmed = await confirm({
              message: `确认清空垃圾桶？共 ${items.length} 项将被彻底删除，不可恢复。`,
              default: false,
            });
            if (!confirmed) {
              logger.raw(chalk.dim('已取消'));
              return;
            }
          }

          const count = await emptyTrash(username);
          logger.raw(chalk.green(`✓ 已清空垃圾桶，共删除 ${count} 项`));
        } else {
          logger.raw(chalk.yellow('请指定要删除的条目 ID，或使用 --all 清空整个垃圾桶'));
        }
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

function getRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHour < 24) return `${diffHour} 小时前`;
  if (diffDay < 30) return `${diffDay} 天前`;
  return new Date(isoString).toLocaleDateString('zh-CN');
}
