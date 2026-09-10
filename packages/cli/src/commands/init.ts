import { Command } from 'commander';
import chalk from 'chalk';
import { checkbox, confirm, input } from '@inquirer/prompts';
import { cp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  getLatticeRoot,
  getConfigDir,
  getGlobalSpecDir,
  getSpecTemplatesDir,
  getUserDir,
  getUserSpecDir,
  getUserProjectsDir,
  getUserTasksDir,
  getCacheDir,
  ensureDir,
  dirExists,
  isInitialized,
  readGlobalConfig,
  readLocalConfig,
  writeGlobalConfig,
  writeLocalConfig,
  initDb,
  rebuildProjectsCache,
  updateRagIndex,
  closeDb,
  scanForProjects,
  type ScanProgress,
  readScanCache,
  writeScanCache,
  readResolvedConfig,
  getUsername,
  syncSpecTemplateRegistry,
  generateEmbedding,
  isModelInstalled,
  isModelLoadNetworkError,
  formatModelNetworkHint,
  removeInstalledModel,
  initLatticeGit,
  writeInitMeta,
  getAIToolConfigs,
  injectToToolRoot,
} from '@qcqx/lattice-core';
import { logger } from '../utils';
import { cliVersion } from '../version';
import {
  resolveBundledSpecTemplateNames,
  syncBundledSpecTemplatesWithPrompt,
} from '../utils/spec-templates';
import { shouldSkipConfirm } from '../utils';
import { ensureGitignore } from '@qcqx/lattice-core';

export function registerInitCommand(program: Command): void {
  const initCmd: Command = program.command('init');
  initCmd
    .description('初始化 Lattice（~/.lattice/）')
    .option('-f, --force', '跳过确认')
    .option('--username <name>', '指定用户名')
    .option('--git [boolean]', '是否使用 git 管理', true)
    .option('--git-remote <url>', 'git 远程仓库地址')
    .option('--scan-dirs <dirs>', '初始扫描目录（逗号分隔）')
    .option('--registry-template <urls>', '自定义 spec 模板仓库地址（逗号分隔）')
    .option('--download-model', '初始化后立即下载并预热 embedding 模型')
    .option(
      '--builtin-spec-templates <names>',
      '初始化时导入内置 spec 模板（逗号分隔，默认 all）',
      'all',
    )
    .action(async (opts) => {
      try {
        const root = getLatticeRoot();
        const initialized = await isInitialized();
        const [existingGlobalConfig, existingLocalConfig] = await Promise.all([
          readGlobalConfig(),
          readLocalConfig(),
        ]);

        if (initialized) {
          logger.raw(chalk.yellow('Lattice 已初始化，接下来将重新初始化并更新配置。'));
        }

        // 1. 获取用户名
        let username = opts.username as string | undefined;
        const previousUsername = existingLocalConfig?.username?.trim();
        if (!username) {
          username = await input({
            message: '请输入你的用户名：',
            default: previousUsername,
            validate: (v) => (v.trim().length > 0 ? true : '用户名不能为空'),
          });
        }
        username = username.trim();

        const scanDirs = opts.scanDirs
          ? parseCommaSeparatedOption(opts.scanDirs as string)
          : existingLocalConfig?.scanDirs;
        const registryTemplates = opts.registryTemplate
          ? parseCommaSeparatedOption(opts.registryTemplate as string)
          : existingGlobalConfig.registryTemplates;
        await ensureDir(root);
        const bundledSpecTemplateNames = await resolveBundledSpecTemplateNames(
          opts.builtinSpecTemplates as string | undefined,
        );
        const gitOptionProvided = process.argv.some(
          (arg) => arg === '--git' || arg.startsWith('--git='),
        );
        const gitEnabled = gitOptionProvided
          ? opts.git !== false && opts.git !== 'false'
          : (existingLocalConfig?.gitEnabled ?? true);
        const gitRemote = (opts.gitRemote as string | undefined) ?? existingLocalConfig?.gitRemote;

        // 2. 创建目录结构
        logger.raw(chalk.blue(initialized ? '正在重新初始化目录与配置...' : '正在创建目录结构...'));
        await ensureDir(getConfigDir());
        await ensureDir(getCacheDir());
        await ensureDir(getGlobalSpecDir());
        await ensureDir(getSpecTemplatesDir());

        if (previousUsername && previousUsername !== username) {
          const previousUserDir = getUserDir(previousUsername);
          const nextUserDir = getUserDir(username);
          if (await dirExists(previousUserDir)) {
            if (await dirExists(nextUserDir)) {
              throw new Error(`无法更新用户名：目标用户目录已存在（${username}）`);
            }
            logger.raw(chalk.blue(`正在迁移用户数据：${previousUsername} -> ${username}...`));
            await cp(previousUserDir, nextUserDir, { recursive: true });
            await rm(previousUserDir, { recursive: true, force: true });
          }
        }

        await ensureDir(getUserDir(username));
        await ensureDir(getUserSpecDir(username));
        await ensureDir(getUserProjectsDir(username));
        await ensureDir(getUserTasksDir(username));

        // 3. 写入配置
        await writeGlobalConfig({
          ...existingGlobalConfig,
          version: existingGlobalConfig.version ?? '0.1.0',
          registryTemplates,
        });

        await writeLocalConfig({
          ...existingLocalConfig,
          username,
          scanDirs,
          gitEnabled,
          gitRemote,
        });

        // 4. 更新 .gitignore
        await ensureGitignore(join(root, '.gitignore'));

        // 5. 安装内置 spec 模板
        if (bundledSpecTemplateNames.length > 0) {
          logger.raw(chalk.blue('正在安装内置 spec 模板...'));
          const result = await syncBundledSpecTemplatesWithPrompt(bundledSpecTemplateNames);
          logger.raw(chalk.green(`  ✓ 已安装 ${result.synced.length} 个内置模板`));
          if (result.skipped.length > 0) {
            logger.raw(chalk.yellow(`  跳过：${result.skipped.join(', ')}`));
          }
          if (result.missing.length > 0) {
            logger.raw(chalk.yellow(`  未找到：${result.missing.join(', ')}`));
          }
        }

        // 6. Git 初始化
        if (gitEnabled && !(await dirExists(join(root, '.git')))) {
          logger.raw(chalk.blue('正在初始化 Git 仓库...'));
          try {
            await initLatticeGit(root, opts.gitRemote);
          } catch {
            logger.raw(chalk.yellow('Git 初始化时出现警告（可能已存在仓库）'));
          }
        }

        // 7. 检测 AI 工具
        logger.raw(chalk.blue('正在检测已安装的 AI 工具...'));
        await detectAndConfigureAITools();

        // 8. 拉取模板仓库
        if (registryTemplates?.length) {
          logger.raw(chalk.blue('正在拉取自定义模板仓库...'));
          for (const repoUrl of registryTemplates) {
            const result = await syncSpecTemplateRegistry(repoUrl);
            logger.raw(
              chalk.green(`  ✓ ${repoUrl}（导入 ${result.importedTemplates.length} 个模板）`),
            );
          }
        }

        // 9. 初始化数据库 + 全用户项目回填
        await initDb();
        await rebuildProjectsCache();

        // 10. 扫描项目
        if (scanDirs?.length) {
          let doScan = shouldSkipConfirm(opts);
          if (!doScan) {
            doScan = await confirm({
              message: `将扫描以下目录：\n${scanDirs.map((d) => `  ${d}`).join('\n')}\n确认开始扫描？`,
              default: true,
            });
          }
          if (doScan) {
            logger.raw(chalk.blue('正在扫描项目...'));
            const result = await scanForProjects(username, scanDirs, (p: ScanProgress) => {
              const dirShort =
                p.currentDir.length > 60 ? '...' + p.currentDir.slice(-57) : p.currentDir;
              process.stdout.write(
                `\r${chalk.dim('扫描')} ${dirShort.padEnd(60)} ${chalk.green('+' + p.added)} ${chalk.blue('~' + p.updated)} ${chalk.dim('(' + p.found + ')')}`.slice(
                  0,
                  120,
                ) + '\r',
              );
            });
            process.stdout.write('\r' + ' '.repeat(120) + '\r');
            logger.raw(
              chalk.green(
                `扫描完成：新增 ${result.added.length} 个，更新 ${result.updated.length} 个`,
              ),
            );
          } else {
            logger.raw(chalk.dim('已跳过项目扫描'));
          }
        }

        const modelInstalled = await isModelInstalled();
        let shouldDownloadModel = opts.downloadModel === true || shouldSkipConfirm(opts);
        if (!shouldDownloadModel) {
          shouldDownloadModel = await confirm({
            message: modelInstalled
              ? '检测到 embedding 模型已安装，是否重新下载并预热？'
              : '是否现在下载 embedding 模型？如果跳过，将在首次搜索时再下载。',
            default: false,
          });
        }

        if (shouldDownloadModel) {
          if (modelInstalled) {
            logger.spin('检测到已安装的 embedding 模型，正在清理旧缓存...');
            await removeInstalledModel();
          }
          logger.spin('正在下载并预热 embedding 模型...');
          const embedding = await generateEmbedding('lattice init model warmup');
          if (embedding) {
            logger.spinSuccess('embedding 模型已就绪');
          } else {
            logger.spinWarn('embedding 模型预热失败，可在首次搜索时重试下载');
            if (isModelLoadNetworkError()) {
              logger.raw(chalk.yellow(formatModelNetworkHint()));
            }
          }
        }

        // 11. 增量更新 RAG 索引（项目数据已回填，需同步索引）
        if (shouldDownloadModel || (await isModelInstalled())) {
          try {
            logger.spin('正在更新搜索索引...');
            const result = await updateRagIndex((p) => {
              const pct = Math.round((p.current / p.total) * 100);
              const chunkInfo =
                p.chunksProcessed > 0 ? chalk.cyan(`${p.chunksProcessed}chunks`) : '';
              process.stdout.write(
                `\r${chalk.dim('索引')} ${String(p.current).padStart(4)}/${p.total} ${chalk.green('+' + p.added)} ${chalk.yellow('~' + p.updated)} ${chunkInfo} ${pct}%`.slice(
                  0,
                  120,
                ) + '\r',
              );
            });
            process.stdout.write('\r' + ' '.repeat(120) + '\r');
            if (result.mode === 'rebuild') {
              logger.spinSuccess(
                result.reason === 'model_changed'
                  ? '检测到模型变更，已自动全量重建搜索索引'
                  : result.reason === 'fts_version_expired'
                    ? '检测到索引版本过期，已自动全量重建搜索索引'
                    : '搜索索引全量重建完成',
              );
            } else {
              const parts: string[] = [];
              if (result.added > 0) parts.push(`新增 ${result.added}`);
              if (result.updated > 0) parts.push(`更新 ${result.updated}`);
              if (result.removed > 0) parts.push(`删除 ${result.removed}`);
              parts.push(`跳过 ${result.skipped}`);
              logger.spinSuccess(`搜索索引更新完成（${parts.join('，')}）`);
            }
          } catch {
            logger.spinWarn('搜索索引更新失败，可稍后运行 `ltc rag update`');
          }
        }

        closeDb();

        logger.raw(chalk.green(`\n✓ Lattice${initialized ? '重新' : ''}初始化完成！`));
        logger.raw(chalk.dim(`  用户名：${username}`));
        logger.raw(chalk.dim(`  目录：${root}`));
      } catch (err) {
        console.error(chalk.red('初始化失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // 注册 init scan 子命令
  registerInitScanSubcommand(initCmd);
}

function parseCommaSeparatedOption(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// AIToolConfig 足迹表、标记块注入/移除、commands→skills 转化等注入领域逻辑已下沉到
// @qcqx/lattice-core 的 injection 模块（getAIToolConfigs / injectToToolRoot），
// 与 ltc uninject 的清除逻辑共享同一真源，注入与清除永不脱节。

async function detectAndConfigureAITools(): Promise<void> {
  const home = homedir();

  const tools = getAIToolConfigs(home);

  const detectedToolIds = new Set<string>();
  // 收集每个 tool 所有已存在的候选根（first-match 升级为 all-matched），
  // 避免同一个 tool 同时存在多个别名目录（如 ~/.agents 与 ~/.agent）时仅注入一份。
  const detectedToolMatchedRoots = new Map<string, string[]>();
  for (const tool of tools) {
    const candidates = [tool.detectPath, ...(tool.detectPaths ?? [])];
    const seen = new Set<string>();
    const matchedRoots: string[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (await dirExists(candidate)) {
        matchedRoots.push(candidate);
      }
    }

    if (matchedRoots.length > 0) {
      detectedToolIds.add(tool.id);
      detectedToolMatchedRoots.set(tool.id, matchedRoots);
      const suffix = matchedRoots.length > 1 ? `（${matchedRoots.length} 个候选根）` : '';
      logger.raw(chalk.green(`  ✓ 检测到 ${tool.name}${suffix}`));
    } else {
      logger.raw(chalk.dim(`  - 未检测到 ${tool.name}（可手动选择注入）`));
    }
  }

  const selectedToolIds = await checkbox({
    message: '请选择要注入的 AI 工具（可多选）：',
    choices: tools.map((tool) => {
      const detected = detectedToolIds.has(tool.id);
      return {
        name: detected ? `${tool.name}（已检测）` : `${tool.name}（未检测）`,
        value: tool.id,
        checked: detected || tool.defaultChecked === true,
      };
    }),
  });

  if (selectedToolIds.length === 0) {
    logger.raw(chalk.yellow('  已跳过 AI 工具注入。'));
    return;
  }

  for (const tool of tools) {
    if (!selectedToolIds.includes(tool.id)) {
      continue;
    }

    // 未检测到但用户手动勾选时，回退到 detectPath 单个根创建；
    // 检测到多个候选根时（如 ~/.agents + ~/.agent 均存在）逐个注入。
    const matchedRoots = detectedToolMatchedRoots.get(tool.id) ?? [tool.detectPath];

    for (const targetRoot of matchedRoots) {
      // 注入执行（rules 块 / skill / commands / agents / codex 命令转 skill）已下沉 core，
      // 与 ltc uninject 共享 getAIToolConfigs 足迹表；此处只做落盘路径收集与展示。
      const injectedPaths = await injectToToolRoot(tool, targetRoot);

      const detected = detectedToolIds.has(tool.id);
      const suffix = matchedRoots.length > 1 ? `（${targetRoot}）` : '';
      if (detected) {
        logger.raw(chalk.green(`  ✓ 已注入 ${tool.name}${suffix}`));
      } else {
        logger.raw(chalk.green(`  ✓ 已为 ${tool.name} 创建目录并注入${suffix}`));
      }
      // 展示本次注入的具体文件/目录，~ 替换用户家目录以缩短输出
      const homePrefix = home + '/';
      const kindWidth = Math.max(...injectedPaths.map((p) => p.kind.length));
      for (const { kind, path } of injectedPaths) {
        const shortPath = path.startsWith(homePrefix) ? `~/${path.slice(homePrefix.length)}` : path;
        logger.raw(chalk.dim(`      ${kind.padEnd(kindWidth)}  ${shortPath}`));
      }
    }
  }

  // 写入 init-meta.json，记录本次注入的版本与平台列表
  await writeInitMeta(cliVersion, selectedToolIds);
}

function registerInitScanSubcommand(initCmd: Command): void {
  initCmd
    .command('scan')
    .description('扫描本地 git 项目并注册到 Lattice')
    .option('-f, --force', '跳过确认')
    .option('--dirs <dirs>', '扫描目录（逗号分隔）')
    .option('--auto', '使用配置中的 scanDirs')
    .action(async (opts) => {
      try {
        if (!(await isInitialized())) {
          logger.raw(chalk.yellow('Lattice 尚未初始化，请先运行 lattice init'));
          return;
        }

        const username = await getUsername();

        // 确定扫描目录
        let scanDirs: string[] | undefined;
        if (opts.dirs) {
          scanDirs = opts.dirs
            .split(',')
            .map((d: string) => d.trim())
            .filter(Boolean);
        } else {
          const config = await readResolvedConfig();
          scanDirs = config.scanDirs;
        }

        if (!scanDirs?.length) {
          // 交互式询问
          const inputDirs = await input({
            message: '请输入要扫描的目录（逗号分隔）：',
            default: '~/projects',
          });
          scanDirs = inputDirs
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean);

          // 写入配置
          const localConfig: Record<string, unknown> = (await readLocalConfig()) ?? {};
          await writeLocalConfig({
            ...localConfig,
            username: (localConfig.username as string) ?? username,
            scanDirs,
          });
          logger.raw(chalk.dim('已保存扫描目录到配置'));
        }

        // 确认
        if (!opts.force && !opts.auto) {
          const confirmed = await confirm({
            message: `将扫描以下目录：\n${scanDirs.map((d) => `  ${d}`).join('\n')}\n确认开始？`,
            default: true,
          });
          if (!confirmed) {
            logger.raw(chalk.dim('已取消'));
            return;
          }
        }

        logger.raw(chalk.cyan('正在扫描...'));
        await initDb();
        const startTime = Date.now();
        const result = await scanForProjects(username, scanDirs, (p: ScanProgress) => {
          const dirShort =
            p.currentDir.length > 60 ? '...' + p.currentDir.slice(-57) : p.currentDir;
          const line =
            `${chalk.dim('扫描')} ${dirShort.padEnd(60)} ${chalk.green('+' + p.added)} ${chalk.blue('~' + p.updated)} ${chalk.dim('(' + p.found + ')')}`.slice(
              0,
              120,
            );
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(line);
        });
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        closeDb();

        // 写入扫描缓存
        await writeScanCache({
          lastSuccessAt: new Date().toISOString(),
          lastScanDirs: scanDirs,
          lastResult: { added: result.added.length, updated: result.updated.length },
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.raw(chalk.green(`\n扫描完成 (${elapsed}s)：`));
        logger.raw(chalk.green(`  新增项目：${result.added.length}`));
        logger.raw(chalk.green(`  更新项目：${result.updated.length}`));

        if (result.added.length > 0) {
          logger.raw(chalk.dim('\n新增项目路径：'));
          for (const p of result.added) {
            logger.raw(chalk.dim(`  ${p}`));
          }
        }
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
