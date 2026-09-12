import { Command } from 'commander';
import chalk from 'chalk';
import {
  syncAll,
  pullRebase,
  pushGit,
  readLocalConfig,
  readSyncDomains,
  writeSyncDomains,
  resolveDomainRef,
  domainHashOf,
  peekDomain,
  joinDomain,
  unlinkDomain,
  listDomains,
  syncDomains,
  validateRoute,
} from '@qcqx/lattice-core';
import type { DomainSummary } from '@qcqx/lattice-core';
import { logger, outputJson } from '../utils';

/**
 * `ltc sync` 双轨编排（D21）：
 *   origin 单仓 = 一个用户多机器间全量同步（现状行为，未配域时完全一致）；
 *   域 = 多用户经验包协作（pull 全部 + push 有 routes/指纹的域）。
 * 子命令：sync domain join|unlink|list|route（cli-command-surface：不新增一级命令）。
 */

export function registerSyncCommand(program: Command): void {
  const sync = program
    .command('sync')
    .description('同步数据（origin 单仓多机同步 + 域经验包协作）');

  sync
    .option('--pull', '仅拉取（origin 单仓）')
    .option('--push', '仅推送（origin 单仓）')
    .option('--only <target>', '只执行指定轨道：origin | domains')
    .action(async (opts) => {
      try {
        if (opts.pull || opts.push) {
          await runOriginOnly(opts.pull ? 'pull' : 'push');
          return;
        }
        await runFullSync(opts);
      } catch (err) {
        logger.stderr(chalk.red('同步失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  const domain = sync.command('domain').description('域（经验包）管理');

  domain
    .command('join <remote>')
    .description('关联一个域（经验包仓库）：默认 use=trusted、无 routes=只读消费')
    .option('--branch <branch>', '经验包分支（默认 main；建议经验包分支只 fast-forward）')
    .option('--label <label>', '本机备注名')
    .option(
      '--route <rule>',
      '推送白名单规则（可多次）："*" | project:<glob> | user-spec:<glob> | global-spec:<glob>',
    )
    .option(
      '--use <mode>',
      '消费策略：trusted（默认，读取+约束生效）| reference（只读不注入）| off（只同步不读取）',
    )
    .option('--peek', '预览域内容后不关联（临时浅克隆，读完即删）')
    .action(async (remote, opts) => {
      try {
        const username = await currentUsername();
        if (opts.peek) {
          const result = await peekDomain(remote, opts.branch ?? 'main', username);
          printSummary(`预览 ${remote}`, result.summary, result.warnings);
          logger.raw(chalk.dim('  （--peek 仅预览，未关联。去掉 --peek 正式 join）'));
          return;
        }
        const routes = opts.route ? collectRoutes(opts.route) : undefined;
        const result = await joinDomain(
          {
            remote,
            branch: opts.branch,
            label: opts.label,
            use: opts.use,
            ...(routes ? { routes } : {}),
          },
          username,
        );
        logger.raw(
          chalk.green(`✓ 已关联域 ${result.domainHash}${opts.label ? `（${opts.label}）` : ''}`),
        );
        if (!routes || routes.length === 0) {
          logger.raw(
            chalk.dim(
              `  当前为只读消费。要推送自己的内容：ltc sync domain route add ${result.domainHash} '<规则>'`,
            ),
          );
        }
        logger.raw(chalk.dim(`  镜像：${result.mirrorDir}`));
        printSummary(remote, result.summary, result.warnings);
      } catch (err) {
        const msg = (err as Error).message;
        logger.stderr(chalk.red('关联失败：'), msg);
        if (msg.includes('域已存在')) {
          logger.stderr(
            chalk.dim('  已关联过该域：改用 route add 加推送规则，或 unlink 后重新 join'),
          );
        }
        process.exitCode = 1;
      }
    });

  domain
    .command('unlink <hash>')
    .description(
      '解除域关联：移除配置与本地镜像（主数据毫发无伤）；hash 支持完整 16 位或 ≥4 位前缀',
    )
    .action(async (hash) => {
      try {
        const resolved = await resolveDomainRef(hash);
        if (resolved.error || !resolved.domain) throw new Error(resolved.error);
        const r = await unlinkDomain(domainHashOf(resolved.domain));
        logger.raw(
          chalk.green(
            `✓ 已解除域 ${r.label ?? r.remote}：配置、镜像、指纹已清理（主数据毫发无伤）`,
          ),
        );
      } catch (err) {
        logger.stderr(chalk.red('解除失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  domain
    .command('list')
    .description('域列表（数组顺序 = 读时遮蔽优先级）')
    .option('--json', 'JSON 输出')
    .action(async (opts) => {
      try {
        const domains = await listDomains();
        if (opts.json) {
          outputJson(domains);
          return;
        }
        if (domains.length === 0) {
          logger.raw(chalk.dim('尚未关联任何域。ltc sync domain join <remote> 关联经验包。'));
          return;
        }
        for (const d of domains) {
          const labelPart = d.label ? ` ${chalk.cyan(`(${d.label})`)}` : '';
          logger.raw(`  ${chalk.bold(d.hash)}${labelPart} ${chalk.dim(`优先级 ${d.priority}`)}`);
          logger.raw(
            chalk.dim(
              `    ${d.remote}#${d.branch} · ${d.use} · ${d.pushState} · 镜像${d.mirrorExists ? '就绪' : '缺失'}` +
                (d.lastPushAt ? ` · 上次推送 ${new Date(d.lastPushAt).toLocaleString()}` : ''),
            ),
          );
        }
      } catch (err) {
        logger.stderr(chalk.red('读取失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  const route = domain.command('route').description('推送白名单规则管理');

  route
    .command('add <hash> <rule>')
    .description("添加推送规则：'*' | project:<glob> | user-spec:<glob> | global-spec:<glob>")
    .action(async (hash: string, rule: string) => {
      try {
        validateRoute(rule);
        const resolved = await resolveDomainRef(hash);
        if (resolved.error || resolved.domain === undefined) throw new Error(resolved.error);
        const domains = await readSyncDomains();
        const idx = domains.findIndex((d) => domainHashOf(d) === domainHashOf(resolved.domain!));
        const routes = [...(domains[idx].routes ?? []), rule];
        domains[idx] = { ...domains[idx], routes };
        await writeSyncDomains(domains);
        logger.raw(
          chalk.green(`✓ 已添加规则 ${rule}（现 ${routes.length} 条，ltc sync 推送生效）`),
        );
      } catch (err) {
        logger.stderr(chalk.red('添加失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  route
    .command('remove <hash> <rule>')
    .description('移除推送规则')
    .action(async (hash: string, rule: string) => {
      try {
        const resolved = await resolveDomainRef(hash);
        if (resolved.error || resolved.domain === undefined) throw new Error(resolved.error);
        const domains = await readSyncDomains();
        const idx = domains.findIndex((d) => domainHashOf(d) === domainHashOf(resolved.domain!));
        const routes = (domains[idx].routes ?? []).filter((r) => r !== rule);
        domains[idx] = { ...domains[idx], routes };
        await writeSyncDomains(domains);
        logger.raw(chalk.green(`✓ 已移除规则 ${rule}（剩 ${routes.length} 条）`));
      } catch (err) {
        logger.stderr(chalk.red('移除失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ─── 内部 ───

async function currentUsername(): Promise<string> {
  const config = await readLocalConfig();
  if (!config?.username) throw new Error('config-local.json 缺 username：请先 lattice init');
  return config.username;
}

function collectRoutes(v: unknown): string[] {
  // commander 可重复 option 产出数组，单次为字符串
  return Array.isArray(v) ? (v as string[]) : [v as string];
}

function printSummary(_title: string, summary: DomainSummary | null, warnings: string[]): void {
  if (summary) {
    logger.raw(
      chalk.dim(
        `  内容：${summary.users} 用户 · ${summary.projects} 项目 · ${summary.specs} spec · 全局 spec ${summary.globalSpecTitles.length}+`,
      ),
    );
    if (summary.globalSpecTitles.length > 0) {
      logger.raw(chalk.dim(`    全局 spec：${summary.globalSpecTitles.slice(0, 3).join('、')}`));
    }
  }
  for (const w of warnings) {
    logger.raw(chalk.yellow(`  ⚠ ${w}`));
  }
}

async function runOriginOnly(mode: 'pull' | 'push'): Promise<void> {
  logger.raw(chalk.blue(mode === 'pull' ? '正在拉取远程变更...' : '正在推送本地变更...'));
  const result = mode === 'pull' ? await pullRebase() : await pushGit();
  if (result.success) {
    logger.raw(chalk.green(`✓ ${result.message}`));
    if (result.output) logger.raw(chalk.dim(`  ${result.output}`));
  } else {
    logger.raw(chalk.yellow(result.message));
  }
}

async function runFullSync(opts: { only?: string; json?: boolean }): Promise<void> {
  const only = opts.only as string | undefined;
  if (only && only !== 'origin' && only !== 'domains') {
    logger.raw(chalk.yellow('--only 须为 origin 或 domains'));
    process.exitCode = 1;
    return;
  }

  // 轨道一：origin 单仓多机同步（未配域/未启用 git 时保持现状语义）
  if (!only || only === 'origin') {
    const config = await readLocalConfig();
    if (config?.gitEnabled) {
      logger.raw(chalk.blue('正在同步 origin 单仓...'));
      const results = await syncAll();
      logger.raw(
        results.pull.success && results.push.success
          ? chalk.green(`  ✓ ${results.pull.message}；${results.push.message}`)
          : chalk.yellow(
              `  ${[results.commit.message, results.pull.message, results.push.message].join('；')}`,
            ),
      );
    } else if (!only) {
      logger.raw(chalk.dim('  origin 单仓未启用（gitEnabled=false），跳过'));
    }
  }

  // 轨道二：域经验包同步
  if (!only || only === 'domains') {
    const domains = await readSyncDomains();
    if (domains.length === 0) {
      if (!only) logger.raw(chalk.dim('  未关联域，跳过域同步'));
      return;
    }
    logger.raw(chalk.blue(`正在同步 ${domains.length} 个域...`));
    const username = await currentUsername();
    const outcomes = await syncDomains(username);
    let allOk = true;
    for (const o of outcomes) {
      const label = o.label ? `（${o.label}）` : '';
      const pullPart = o.pulled ? chalk.green('✓ 拉取') : chalk.yellow(`⚠ 拉取：${o.pullMessage}`);
      const pushPart = o.push ? formatPush(o.push) : chalk.dim('（只读消费，未推送）');
      if (
        !o.pulled ||
        (o.push && !['pushed', 'no-changes', 'skipped-no-routes'].includes(o.push.status))
      ) {
        allOk = false;
      }
      logger.raw(`  ${o.domainHash}${label} ${pullPart} ${pushPart}`);
      if (o.push?.conflicts?.length) {
        logger.raw(
          chalk.yellow(
            `    冲突文件：${o.push.conflicts.slice(0, 3).join('；')}${o.push.conflicts.length > 3 ? '…' : ''}`,
          ),
        );
        logger.raw(
          chalk.dim(
            '    指引：手动解决 ~/.lattice/.sync-domains/' +
              o.domainHash +
              ' 内的冲突后重新 sync，或 unlink 后重新 join',
          ),
        );
      }
    }
    logger.raw(allOk ? chalk.green('\n✓ 域同步完成') : chalk.yellow('\n⚠ 域同步部分失败（见上）'));
  }
}

function formatPush(p: { status: string; message: string }): string {
  if (p.status === 'pushed') return chalk.green(`✓ ${p.message}`);
  if (p.status === 'no-changes' || p.status === 'skipped-no-routes') return chalk.dim(p.message);
  return chalk.yellow(`⚠ ${p.message}`);
}
