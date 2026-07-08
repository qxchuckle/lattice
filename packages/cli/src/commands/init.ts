import { Command } from 'commander';
import chalk from 'chalk';
import { checkbox, confirm, input } from '@inquirer/prompts';
import ignore from 'ignore';
import { execSync } from 'node:child_process';
import { cp, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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

interface ExtraRulesInjection {
  /** 注入目标文件的绝对路径，路径以 detectPath 开头时会按真实根目录重写。 */
  rulesPath: string;
  /** 待写入的引导词正文，支持 markdown frontmatter；frontmatter 不会被 BEGIN/END 标记包裹。 */
  rulesContent: string;
  /** true=保留原文件内容并在末尾追加 Lattice 块；false=整文件覆盖。默认 false。 */
  appendRules?: boolean;
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
  /**
   * 额外的 rules 注入对象。用于支持 rules 系统的客户端（如 Qoder/Cursor）
   * 在主 rulesPath 之外再注入一份'系统级常驻规则文件'，与渐进式加载的 skill 互补。
   */
  extraRules?: ExtraRulesInjection[];
}

const LATTICE_BEGIN_MARKER = '<!-- LATTICE:BEGIN -->';
const LATTICE_END_MARKER = '<!-- LATTICE:END -->';

/**
 * 把 markdown frontmatter 与正文拆开，便于把 BEGIN/END 标记只包裹正文。
 * frontmatter 必须紧贴文件开头，否则视为不存在。
 */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: '', body: content };
  }
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!match) {
    return { frontmatter: '', body: content };
  }
  const frontmatter = match[0];
  const body = content.slice(frontmatter.length).replace(/^\s*\n/, '');
  return { frontmatter, body };
}

/**
 * 把 Lattice 引导词写入目标文件，并用 BEGIN/END 标记包裹正文，便于后续整段替换。
 *
 * 行为：
 * - 文件已含完整的 BEGIN/END 标记 → 仅替换标记之间的正文，标记之外的用户内容保留；
 * - 文件不存在或为空 → 写入完整内容（含 frontmatter）；
 * - 没标记 + 覆盖模式 → 整文件覆盖为带标记的内容；
 * - 没标记 + 追加模式 → 在原内容末尾追加带标记的块（不重复写入 frontmatter）。
 */
async function injectLatticeBlock(
  filePath: string,
  rulesContent: string,
  mode: 'append' | 'overwrite',
): Promise<void> {
  const { frontmatter, body } = splitFrontmatter(rulesContent);
  const wrappedBlock = `${LATTICE_BEGIN_MARKER}\n${body.trim()}\n${LATTICE_END_MARKER}`;

  const existing = (await fileExists(filePath)) ? ((await readText(filePath)) ?? '') : '';

  const beginIdx = existing.indexOf(LATTICE_BEGIN_MARKER);
  const endIdx = existing.indexOf(LATTICE_END_MARKER);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + LATTICE_END_MARKER.length);
    await writeText(filePath, `${before}${wrappedBlock}${after}`);
    return;
  }

  if (!existing.trim()) {
    const full = frontmatter ? `${frontmatter}\n${wrappedBlock}\n` : `${wrappedBlock}\n`;
    await writeText(filePath, full);
    return;
  }

  if (mode === 'overwrite') {
    const full = frontmatter ? `${frontmatter}\n${wrappedBlock}\n` : `${wrappedBlock}\n`;
    await writeText(filePath, full);
    return;
  }

  // append 模式：保留原文件内容，只在末尾追加带标记的块；不重复注入 frontmatter。
  const trimmed = existing.replace(/\s+$/, '');
  await writeText(filePath, `${trimmed}\n\n${wrappedBlock}\n`);
}

/**
 * Codex 特有：将 bundled commands 目录下每个 .md 文件转化为独立 Codex skill。
 * 映射规则：`task/start.md` → `~/.codex/skills/lattice-task-start/SKILL.md`
 *
 * 每个 skill 在文件头部添加 YAML frontmatter（name + description），
 * 以便 Codex Discovery 机制自动扫描注册。
 */
async function deployCommandsAsSkills(
  commandsDir: string,
  targetSkillsRoot: string,
): Promise<string[]> {
  const deployed: string[] = [];

  async function walkDir(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath, prefix ? `${prefix}-${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md')) {
        const baseName = entry.name.replace(/\.md$/, '');
        const skillName = prefix ? `lattice-${prefix}-${baseName}` : `lattice-${baseName}`;
        const content = (await readText(fullPath)) ?? '';

        // 从文件内容中提取 description：取第一行 "目标：" 开头的内容
        const goalMatch = content.match(/^目标[：:](.+)$/m);
        const description = goalMatch ? goalMatch[1].trim() : `Lattice ${skillName} 命令`;

        const frontmatter = [
          '---',
          `name: ${skillName}`,
          `description: ${description}`,
          '---',
          '',
        ].join('\n');

        const skillDir = join(targetSkillsRoot, skillName);
        await ensureDir(skillDir);
        await writeText(join(skillDir, 'SKILL.md'), `${frontmatter}${content}`);
        deployed.push(skillName);
      }
    }
  }

  await walkDir(commandsDir, '');
  return deployed;
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
      // 主注入对象 CLAUDE.md 是 Claude Code 原生的必加载规则入口；
      // 额外同步写一份 ~/.claude/rules/lattice.mdc，保持与其他支持 rules/ 目录的客户端布局一致。
      extraRules: [
        {
          rulesPath: join(home, '.claude', 'rules', 'lattice.mdc'),
          rulesContent: renderCursorRules(),
        },
      ],
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
      // Agent 类客户端同样支持 .mdc rules 系统，额外注入常驻规则文件。
      // 路径以 detectPath 开头，注入时会被 resolveToolPath 重写到每个 matchedRoot（~/.agents 与 ~/.agent）。
      extraRules: [
        {
          rulesPath: join(home, '.agents', 'rules', 'lattice.mdc'),
          rulesContent: renderCursorRules(),
        },
      ],
    },
    {
      id: 'qoder',
      name: 'Qoder',
      detectPath: join(home, '.qoder'),
      rulesPath: join(home, '.qoder', 'AGENT.md'),
      rulesContent: renderClaudeCode(),
      commandsRoot: join(home, '.qoder', 'commands'),
      skillPath: join(home, '.qoder', 'skills', 'lattice', 'SKILL.md'),
      // Qoder 支持 .mdc rules 系统（与 Cursor 同源），额外注入常驻规则文件，
      // 提升 AI 按 lattice 工作流做事的硬约束（skill 是渐进式加载，rules 是默认常驻）。
      extraRules: [
        {
          rulesPath: join(home, '.qoder', 'rules', 'lattice.mdc'),
          rulesContent: renderCursorRules(),
        },
      ],
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
      // Trae 同样支持 .mdc rules 系统，额外注入常驻规则文件。
      // 路径以 detectPath 开头，注入时会被 resolveToolPath 重写到每个 matchedRoot（~/.trae 与 ~/.trae-cn）。
      extraRules: [
        {
          rulesPath: join(home, '.trae', 'rules', 'lattice.mdc'),
          rulesContent: renderCursorRules(),
        },
      ],
    },
    {
      id: 'codex',
      name: 'Codex',
      detectPath: join(home, '.codex'),
      rulesPath: join(home, '.codex', 'AGENTS.md'),
      rulesContent: renderClaudeCode(),
      skillPath: join(home, '.codex', 'skills', 'lattice', 'SKILL.md'),
      // Codex 没有内置 /command 触发机制，commands 将被转化为独立 skills（见下方特殊处理）。
      // 因此不设置 commandsRoot。
      appendRules: true,
    },
  ];

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
      const resolveToolPath = (toolPath: string): string =>
        toolPath.startsWith(tool.detectPath)
          ? join(targetRoot, toolPath.slice(tool.detectPath.length))
          : toolPath;
      const rulesPath = resolveToolPath(tool.rulesPath);
      const skillPath = tool.skillPath ? resolveToolPath(tool.skillPath) : undefined;
      const commandsRoot = tool.commandsRoot ? resolveToolPath(tool.commandsRoot) : undefined;

      // 收集本次注入的所有落盘路径，走完后统一展示给用户
      const injectedPaths: Array<{ kind: string; path: string }> = [];

      await ensureDir(targetRoot);

      await injectLatticeBlock(
        rulesPath,
        tool.rulesContent,
        tool.appendRules ? 'append' : 'overwrite',
      );
      injectedPaths.push({ kind: 'rules', path: rulesPath });

      if (tool.extraRules && tool.extraRules.length > 0) {
        for (const extra of tool.extraRules) {
          const extraPath = resolveToolPath(extra.rulesPath);
          await ensureDir(dirname(extraPath));
          await injectLatticeBlock(
            extraPath,
            extra.rulesContent,
            extra.appendRules ? 'append' : 'overwrite',
          );
          injectedPaths.push({ kind: 'rules', path: extraPath });
        }
      }

      if (skillPath) {
        const skillRoot = join(skillPath, '..');
        await rm(skillRoot, { recursive: true, force: true });
        await cp(getBundledTemplateDir('skills'), skillRoot, { recursive: true });
        // 将工作节奏硬指令（lattice-rules.md）同步写入 skill 目录，
        // 源自 platforms/lattice-rules.md 同一份纯正文，供 SKILL.md 引用。
        await writeText(join(skillRoot, 'lattice-rules.md'), renderClaudeCode());
        injectedPaths.push({ kind: 'skill', path: `${skillRoot}/` });
      }

      if (commandsRoot) {
        const latticeCommandsRoot = join(commandsRoot, 'lattice');
        await rm(latticeCommandsRoot, { recursive: true, force: true });
        await cp(getBundledTemplateDir('commands'), latticeCommandsRoot, { recursive: true });
        injectedPaths.push({ kind: 'commands', path: `${latticeCommandsRoot}/` });
      }

      // Codex 特有：将 commands 目录下每个命令文档转化为独立 Codex skill
      if (tool.id === 'codex') {
        const commandsDir = getBundledTemplateDir('commands');
        const deployedSkills = await deployCommandsAsSkills(
          commandsDir,
          join(targetRoot, 'skills'),
        );
        for (const skillName of deployedSkills) {
          injectedPaths.push({
            kind: 'cmd-skill',
            path: `${join(targetRoot, 'skills', skillName)}/`,
          });
        }
      }

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
