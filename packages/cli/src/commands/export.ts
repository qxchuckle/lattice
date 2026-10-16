import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  initDb,
  closeDb,
  exportSkill,
  verifyExport,
  type ExportKind,
  type SpecExportScope,
  type TaskExportDepth,
  type TaskStatus,
} from '@qcqx/lattice-core';
import { logger, outputJson } from '../utils';

/** commander 多值收集器：重复 flag；标识符/枚举类同时支持逗号分隔 */
function multi(value: string, prev: string[]): string[] {
  return [
    ...(prev ?? []),
    ...value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ];
}

/** 自由文本多值：仅重复，不按逗号拆分（值可能含逗号） */
function multiRaw(value: string, prev: string[]): string[] {
  return [...(prev ?? []), value];
}

function nonEmpty(v: string[] | undefined): string[] | undefined {
  return v && v.length > 0 ? v : undefined;
}

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description(
      '导出 spec 与 tasks 为标准 Agent Skills 目录（SKILL.md + manifest.yaml + 分区 + tasks/）',
    )
    .option('--only <kind>', '资源类型：spec / task（重复或逗号；默认全部已注册类型）', multi, [])
    .option(
      '--scope <level>',
      'spec 层级：global / user / project（重复或逗号；默认全部）',
      multi,
      [],
    )
    .option('--spec <v>', 'spec 精确条目：id / 文件名（前缀或 * 通配；可重复）', multi, [])
    .option('--exclude-spec <v>', 'spec 精确条目黑名单（可重复）', multi, [])
    .option('--tag <tag>', 'spec 标签白名单（可重复）', multi, [])
    .option('--exclude-tag <tag>', 'spec 标签黑名单（可重复）', multi, [])
    .option('--task <v>', '任务 id 白名单（前缀或 * 通配；可重复）', multi, [])
    .option('--exclude-task <v>', '任务 id 黑名单（可重复）', multi, [])
    .option(
      '--task-status <s>',
      '任务状态：planning / in_progress / completed / archived / all（重复或逗号；默认 archived）',
      multi,
      [],
    )
    .option('--task-since <date>', '任务创建时间 >= 日期（YYYY-MM-DD，UTC）')
    .option('--task-until <date>', '任务创建时间 <= 日期（YYYY-MM-DD，UTC）')
    .option('--task-depth <d>', '任务深度：digest（默认）/ prd / full')
    .option('--user <name>', '用户白名单（重复或逗号；all=全部用户），默认当前用户', multi, [])
    .option('--exclude-user <name>', '用户黑名单（重复或逗号）', multi, [])
    .option('--project <v>', '项目白名单：id / 名称 / 包名（子串或 * 通配；可重复）', multi, [])
    .option('--exclude-project <v>', '项目黑名单：涉及即剔除（子串或 * 通配；可重复）', multi, [])
    .option(
      '--filter <kw>',
      '关键词白名单（可重复；spec 元数据 / task 标题+PRD+checkpoint）',
      multiRaw,
      [],
    )
    .option('--exclude-filter <kw>', '关键词黑名单（可重复）', multiRaw, [])
    .option('--dry-run', '只预演：筛选/统计/警告，不写盘')
    .option('--prune', '删除旧 manifest 记录、本次未导出的陈旧文件（与 --clean 互斥）')
    .option('--name <name>', 'skill 名（kebab-case），默认 lattice-knowledge')
    .option('--description <d>', '覆盖自动生成的 description')
    .option('-o, --output <dir>', '输出目录，默认 ~/.lattice/.cache/export-skill/<skill名>/')
    .option('--clean', '清空目标目录后重导（不限本工具产物；与 --overwrite/--prune 互斥）')
    .option(
      '--overwrite',
      '目标非空且非本工具管理时覆盖合并写入（同名路径覆盖、其余保留；与 --clean 互斥）',
    )
    .option('--verify <dir>', '不导出，仅校验已有导出目录与 manifest 一致性')
    .option('--strict', '警告升为错误（退出码非零）')
    .action(async (opts) => {
      try {
        // 校验模式：纯文件操作，不触 DB
        if (opts.verify) {
          const result = await verifyExport(opts.verify);
          if (opts.json) {
            outputJson(result, opts.jsonFormat);
          } else if (result.ok) {
            logger.raw(chalk.green(`✓ 校验通过：${result.checked} 个文件与 manifest 一致`));
          } else {
            logger.raw(chalk.red(`✗ 发现 ${result.issues.length} 个问题：`));
            for (const issue of result.issues) {
              logger.raw(`  • [${issue.type}] ${issue.path} — ${issue.message}`);
            }
            process.exitCode = 1;
          }
          return;
        }

        await initDb();
        const username = await getUsername();

        const result = await exportSkill({
          kinds: nonEmpty(opts.only) as ExportKind[] | undefined,
          scope: nonEmpty(opts.scope) as SpecExportScope[] | undefined,
          tags: nonEmpty(opts.tag),
          excludeTags: nonEmpty(opts.excludeTag),
          specs: nonEmpty(opts.spec),
          excludeSpecs: nonEmpty(opts.excludeSpec),
          tasks: nonEmpty(opts.task),
          excludeTasks: nonEmpty(opts.excludeTask),
          taskStatuses: nonEmpty(opts.taskStatus) as (TaskStatus | 'all')[] | undefined,
          taskSince: opts.taskSince,
          taskUntil: opts.taskUntil,
          taskDepth: opts.taskDepth as TaskExportDepth | undefined,
          filters: nonEmpty(opts.filter),
          excludeFilters: nonEmpty(opts.excludeFilter),
          projects: nonEmpty(opts.project),
          excludeProjects: nonEmpty(opts.excludeProject),
          users: nonEmpty(opts.user) ?? [username],
          excludeUsers: nonEmpty(opts.excludeUser),
          skillName: opts.name,
          description: opts.description,
          outputDir: opts.output,
          clean: opts.clean,
          overwrite: opts.overwrite,
          prune: opts.prune,
          dryRun: opts.dryRun,
          execUser: username,
        });
        closeDb();

        if (opts.json) {
          outputJson(result, opts.jsonFormat);
          return;
        }

        const s = result.stats;
        const ms = result.manifest.stats;
        logger.raw(
          result.dryRun
            ? chalk.yellow(
                `[dry-run] 将导出 ${s.exportedSpecs} 份规范 + ${s.exportedTasks} 份任务到 ${result.outputDir}`,
              )
            : chalk.green(
                `✓ 已导出 ${s.exportedSpecs} 份规范 + ${s.exportedTasks} 份任务到 ${result.outputDir}`,
              ),
        );
        logger.raw(
          chalk.dim(
            `  扫描：spec ${s.scannedSpecs} / task ${s.scannedTasks}；排除：spec ${s.excludedSpecs} / task ${s.excludedTasks}`,
          ),
        );
        logger.raw(
          chalk.dim(`  分区：global ${ms.global} · user ${ms.user} · project ${ms.project}`),
        );
        logger.raw(
          chalk.dim(
            `  写入 ${result.written.length} · 跳过 ${result.skipped.length}（hash 未变更）${
              result.dryRun
                ? result.wouldDelete.length
                  ? ` · 将清理 ${result.wouldDelete.length}（--prune）`
                  : ''
                : result.deleted.length
                  ? ` · 清理 ${result.deleted.length}（--prune）`
                  : ''
            }`,
          ),
        );
        if (result.projectMatches.length > 0) {
          logger.raw(chalk.dim('  项目过滤命中：'));
          for (const m of result.projectMatches) {
            const label = m.filter === 'include' ? 'include' : 'exclude';
            logger.raw(
              chalk.dim(
                `    ${label}「${m.value}」→ ${m.projects.length ? m.projects.join('、') : '（无匹配）'}`,
              ),
            );
          }
        }
        for (const k of result.emptyKinds) {
          logger.raw(chalk.yellow(`  ⚠ --only 含 ${k} 但无匹配内容，对应章节输出为「无」`));
        }
        if (result.warnings.length > 0) {
          const byType = new Map<string, number>();
          for (const w of result.warnings) byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
          const summary = [...byType.entries()].map(([t, n]) => `${t} ${n}`).join(' / ');
          const head = opts.strict
            ? chalk.red(
                `\n✗ 独立分发警告 ${result.warnings.length} 条（--strict，视为错误）：${summary}`,
              )
            : chalk.yellow(`\n⚠ 独立分发警告 ${result.warnings.length} 条：${summary}`);
          logger.raw(head);
          for (const w of result.warnings.slice(0, 10)) {
            logger.raw(`  • [${w.type}] ${w.file} — ${w.message}`);
          }
          if (result.warnings.length > 10) {
            logger.raw(chalk.dim(`  ... 其余 ${result.warnings.length - 10} 条见 --json 输出`));
          }
          if (opts.strict) process.exitCode = 1;
        }
        if (result.missingDescriptions.length > 0) {
          logger.raw(
            chalk.yellow(
              `\n⚠ ${result.missingDescriptions.length} 个 spec 缺 description（目录选读依据缺失，建议 ltc spec suggest-description 补齐后重导）：`,
            ),
          );
          for (const m of result.missingDescriptions) {
            const idTag = m.specId ? chalk.dim(` id：${m.specId}`) : '';
            logger.raw(chalk.dim(`  • ${m.path}${idTag}`));
          }
        }
      } catch (err) {
        logger.stderr(chalk.red('export 失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
