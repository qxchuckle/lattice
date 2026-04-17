import { Command } from 'commander';
import chalk from 'chalk';
import { checkbox, confirm, input } from '@inquirer/prompts';
import ignore from 'ignore';
import { execSync } from 'node:child_process';
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
  writeText,
  fileExists,
  dirExists,
  readText,
  isInitialized,
  readGlobalConfig,
  readLocalConfig,
  writeGlobalConfig,
  writeLocalConfig,
  initDb,
  closeDb,
  scanForProjects,
  syncSpecTemplateRegistry,
  generateEmbedding,
  isModelInstalled,
  removeInstalledModel,
  getBundledTemplateDir,
  renderCursorRules,
  renderClaudeCode,
  renderWindsurfRules,
  renderKiroSteering,
} from '@qcqx/lattice-core';
import { logger } from '../utils';
import {
  resolveBundledSpecTemplateNames,
  syncBundledSpecTemplatesWithPrompt,
} from '../utils/spec-templates';
import { shouldSkipConfirm } from '../utils';

interface GitignoreEntry {
  pattern: string;
  probePath: string;
}

interface GitignoreSection {
  title: string;
  entries: GitignoreEntry[];
}

const GITIGNORE_SECTIONS: GitignoreSection[] = [
  {
    title: 'Lattice 本机配置',
    entries: [{ pattern: 'config/config-local.json', probePath: 'config/config-local.json' }],
  },
  {
    title: '个人敏感信息',
    entries: [{ pattern: '**/private/', probePath: 'workspace/private/secret.txt' }],
  },
  {
    title: '本地缓存（SQLite 数据库等）',
    entries: [{ pattern: '.cache/', probePath: '.cache/lattice.db' }],
  },
  {
    title: '其他',
    entries: [
      { pattern: '.DS_Store', probePath: '.DS_Store' },
      { pattern: 'node_modules/', probePath: 'node_modules/package.json' },
    ],
  },
];

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('初始化 Lattice（~/.lattice/）')
    .option('-f, --fore', '跳过确认')
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
            execSync('git init', { cwd: root, stdio: 'pipe' });
            execSync('git add .', { cwd: root, stdio: 'pipe' });
            execSync('git commit -m "chore: 初始化 lattice"', { cwd: root, stdio: 'pipe' });
            if (opts.gitRemote) {
              execSync(`git remote add origin ${opts.gitRemote}`, { cwd: root, stdio: 'pipe' });
            }
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

        // 9. 初始化数据库
        await initDb();

        // 10. 扫描项目
        if (scanDirs?.length) {
          logger.raw(chalk.blue('正在扫描项目...'));
          const result = await scanForProjects(username, scanDirs);
          logger.raw(
            chalk.green(
              `扫描完成：新增 ${result.added.length} 个，更新 ${result.updated.length} 个`,
            ),
          );
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
          }
        }

        closeDb();

        logger.raw(chalk.green(`\n✓ Lattice${initialized ? '重新' : ''}初始化完成！`));
        logger.raw(chalk.dim(`  用户名：${username}`));
        logger.raw(chalk.dim(`  目录：${root}`));
        logger.raw(chalk.dim('\n使用 lattice link 在项目中注册'));
      } catch (err) {
        console.error(chalk.red('初始化失败：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

function parseCommaSeparatedOption(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function ensureGitignore(gitignorePath: string): Promise<void> {
  const existingContent = (await fileExists(gitignorePath))
    ? ((await readText(gitignorePath)) ?? '')
    : '';
  if (!existingContent.trim()) {
    await writeText(gitignorePath, `${renderGitignoreSections(GITIGNORE_SECTIONS)}\n`);
    return;
  }

  const matcher = ignore();
  matcher.add(existingContent);

  const missingSections = GITIGNORE_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => !matcher.ignores(entry.probePath)),
  })).filter((section) => section.entries.length > 0);

  if (missingSections.length === 0) {
    return;
  }

  const nextBlock = renderGitignoreSections(missingSections);
  const normalizedExisting = existingContent.trimEnd();
  await writeText(gitignorePath, `${normalizedExisting}\n\n${nextBlock}\n`);
}

function renderGitignoreSections(sections: GitignoreSection[]): string {
  return sections
    .map((section) =>
      [`# ${section.title}`, ...section.entries.map((entry) => entry.pattern)].join('\n'),
    )
    .join('\n\n');
}

interface AIToolConfig {
  id: string;
  name: string;
  detectPath: string;
  detectPaths?: string[];
  rulesPath: string;
  rulesContent: string;
  skillPath?: string;
  commandsRoot?: string;
  appendRules?: boolean;
  defaultChecked?: boolean;
}

async function detectAndConfigureAITools(): Promise<void> {
  const home = homedir();

  const tools: AIToolConfig[] = [
    {
      id: 'cursor',
      name: 'Cursor',
      detectPath: join(home, '.cursor'),
      rulesPath: join(home, '.cursor', 'rules', 'lattice.mdc'),
      rulesContent: renderCursorRules(),
      skillPath: join(home, '.cursor', 'skills', 'lattice', 'SKILL.md'),
      commandsRoot: join(home, '.cursor', 'commands'),
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      detectPath: join(home, '.claude'),
      rulesPath: join(home, '.claude', 'CLAUDE.md'),
      rulesContent: renderClaudeCode(),
      skillPath: join(home, '.claude', 'skills', 'lattice', 'SKILL.md'),
      commandsRoot: join(home, '.claude', 'commands'),
      appendRules: true,
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      detectPath: join(home, '.windsurf'),
      rulesPath: join(home, '.windsurf', 'rules', 'lattice.md'),
      rulesContent: renderWindsurfRules(),
    },
    {
      id: 'kiro',
      name: 'Kiro',
      detectPath: join(home, '.kiro'),
      rulesPath: join(home, '.kiro', 'steering', 'lattice.md'),
      rulesContent: renderKiroSteering(),
    },
    {
      id: 'agent',
      name: 'Agent (~/.agents)',
      detectPath: join(home, '.agents'),
      detectPaths: [join(home, '.agent')],
      rulesPath: join(home, '.agents', 'AGENT.md'),
      rulesContent: renderClaudeCode(),
      commandsRoot: join(home, '.agents', 'commands'),
      skillPath: join(home, '.agents', 'skills', 'lattice', 'SKILL.md'),
      defaultChecked: true,
    },
    {
      id: 'qoder',
      name: 'Qoder',
      detectPath: join(home, '.qoder'),
      rulesPath: join(home, '.qoder', 'AGENT.md'),
      rulesContent: renderClaudeCode(),
      commandsRoot: join(home, '.qoder', 'commands'),
      skillPath: join(home, '.qoder', 'skills', 'lattice', 'SKILL.md'),
    },
    {
      id: 'trae',
      name: 'Trae',
      detectPath: join(home, '.trae'),
      detectPaths: [join(home, '.trae-cn')],
      rulesPath: join(home, '.trae', 'AGENT.md'),
      rulesContent: renderClaudeCode(),
      commandsRoot: join(home, '.trae', 'commands'),
      skillPath: join(home, '.trae', 'skills', 'lattice', 'SKILL.md'),
    },
  ];

  const detectedToolIds = new Set<string>();
  const detectedToolRoots = new Map<string, string>();
  for (const tool of tools) {
    const candidates = new Set([tool.detectPath, ...(tool.detectPaths ?? [])]);
    let matchedRoot: string | null = null;
    for (const candidate of candidates) {
      if (await dirExists(candidate)) {
        matchedRoot = candidate;
        break;
      }
    }

    if (matchedRoot) {
      detectedToolIds.add(tool.id);
      detectedToolRoots.set(tool.id, matchedRoot);
      logger.raw(chalk.green(`  ✓ 检测到 ${tool.name}`));
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

    const targetRoot = detectedToolRoots.get(tool.id) ?? tool.detectPath;
    const resolveToolPath = (toolPath: string): string =>
      toolPath.startsWith(tool.detectPath)
        ? join(targetRoot, toolPath.slice(tool.detectPath.length))
        : toolPath;
    const rulesPath = resolveToolPath(tool.rulesPath);
    const skillPath = tool.skillPath ? resolveToolPath(tool.skillPath) : undefined;
    const commandsRoot = tool.commandsRoot ? resolveToolPath(tool.commandsRoot) : undefined;

    await ensureDir(targetRoot);

    if (tool.appendRules) {
      const existing = await fileExists(rulesPath);
      if (existing) {
        const content = await readText(rulesPath);
        if (content && !content.includes('Lattice')) {
          await writeText(rulesPath, content + '\n' + tool.rulesContent);
        }
      } else {
        await writeText(rulesPath, tool.rulesContent);
      }
    } else {
      await writeText(rulesPath, tool.rulesContent);
    }

    if (skillPath) {
      const skillRoot = join(skillPath, '..');
      await rm(skillRoot, { recursive: true, force: true });
      await cp(getBundledTemplateDir('skills'), skillRoot, { recursive: true });
    }

    if (commandsRoot) {
      const latticeCommandsRoot = join(commandsRoot, 'lattice');
      await rm(latticeCommandsRoot, { recursive: true, force: true });
      await cp(getBundledTemplateDir('commands'), latticeCommandsRoot, { recursive: true });
    }

    if (detectedToolIds.has(tool.id)) {
      logger.raw(chalk.green(`  ✓ 已注入 ${tool.name}`));
    } else {
      logger.raw(chalk.green(`  ✓ 已为 ${tool.name} 创建目录并注入`));
    }
  }
}
