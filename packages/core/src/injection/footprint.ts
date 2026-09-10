/**
 * AI 客户端注入足迹表 —— init 注入与 uninject 清除的唯一共享真源
 *
 * 所有平台的注入路径/模式都在 `getAIToolConfigs()` 表里维护。inject（写标记块 /
 * 复制目录）与 uninject（删标记块 / 删目录）都从这张表反推足迹，保证注入与清除
 * 永不脱节。副作用无需额外记录：文件系统靠 `<!-- LATTICE:BEGIN/END -->` 标记与
 * `lattice` / `lattice-*` 命名自描述。
 */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { cp, readdir, rm } from 'node:fs/promises';
import { ensureDir, fileExists, readText, writeText } from '../paths';
import {
  getBundledTemplateDir,
  renderClaudeCode,
  renderCursorRules,
  renderKiroSteering,
  renderWindsurfRules,
} from '../template-assets';

export const LATTICE_BEGIN_MARKER = '<!-- LATTICE:BEGIN -->';
export const LATTICE_END_MARKER = '<!-- LATTICE:END -->';

export interface ExtraRulesInjection {
  /** 注入目标文件的绝对路径，路径以 detectPath 开头时会按真实根目录重写。 */
  rulesPath: string;
  /** 待写入的引导词正文，支持 markdown frontmatter；frontmatter 不会被 BEGIN/END 标记包裹。 */
  rulesContent: string;
  /** true=保留原文件内容并在末尾追加 Lattice 块；false=整文件覆盖。默认 false。 */
  appendRules?: boolean;
}

export interface AIToolConfig {
  id: string;
  name: string;
  detectPath: string;
  detectPaths?: string[];
  rulesPath: string;
  rulesContent: string;
  skillPath?: string;
  commandsRoot?: string;
  /**
   * 预定义 subagent 注入目录。存在则将 getBundledTemplateDir('agents') 增量复制到该目录。
   * 不支持 subagent 的平台（Windsurf / Kiro / Codex）不设此字段。
   */
  agentsRoot?: string;
  appendRules?: boolean;
  defaultChecked?: boolean;
  /**
   * 额外的 rules 注入对象。用于支持 rules 系统的客户端（如 Qoder/Cursor）
   * 在主 rulesPath 之外再注入一份'系统级常驻规则文件'，与渐进式加载的 skill 互补。
   */
  extraRules?: ExtraRulesInjection[];
}

/**
 * 返回全部 AI 客户端的注入配置表。`home` 可注入以便隔离测试（默认真实家目录）。
 *
 * 这是 inject 与 uninject 共享的唯一足迹真源：新增平台只需在此加一项，
 * 注入与清除同时生效。
 */
export function getAIToolConfigs(home: string = homedir()): AIToolConfig[] {
  return [
    {
      id: 'cursor',
      name: 'Cursor',
      detectPath: join(home, '.cursor'),
      rulesPath: join(home, '.cursor', 'rules', 'lattice.mdc'),
      rulesContent: renderCursorRules(),
      skillPath: join(home, '.cursor', 'skills', 'lattice', 'SKILL.md'),
      commandsRoot: join(home, '.cursor', 'commands'),
      agentsRoot: join(home, '.cursor', 'agents'),
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      detectPath: join(home, '.claude'),
      rulesPath: join(home, '.claude', 'CLAUDE.md'),
      rulesContent: renderClaudeCode(),
      skillPath: join(home, '.claude', 'skills', 'lattice', 'SKILL.md'),
      commandsRoot: join(home, '.claude', 'commands'),
      agentsRoot: join(home, '.claude', 'agents'),
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
      agentsRoot: join(home, '.agents', 'agents'),
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
      agentsRoot: join(home, '.qoder', 'agents'),
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
      agentsRoot: join(home, '.trae', 'agents'),
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
      // Codex 没有内置 /command 触发机制，commands 将被转化为独立 skills（见 deployCommandsAsSkills）。
      // 因此不设置 commandsRoot。
      appendRules: true,
    },
  ];
}

/**
 * 把以 `detectPath` 开头的模板路径重写到实际匹配根 `targetRoot`。
 * 处理 detectPaths 多候选根（如 ~/.agents 与 ~/.agent）的情况。
 */
export function resolveToolPath(toolPath: string, detectPath: string, targetRoot: string): string {
  return toolPath.startsWith(detectPath)
    ? join(targetRoot, toolPath.slice(detectPath.length))
    : toolPath;
}

/**
 * 把 markdown frontmatter 与正文拆开，便于把 BEGIN/END 标记只包裹正文。
 * frontmatter 必须紧贴文件开头，否则视为不存在。
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
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
 * 把 Lattice 引导词写入目标文件，并用 BEGIN/END 标记包裹正文，便于后续整段替换/移除。
 *
 * 行为：
 * - 文件已含完整的 BEGIN/END 标记 → 仅替换标记之间的正文，标记之外的用户内容保留；
 * - 文件不存在或为空 → 写入完整内容（含 frontmatter）；
 * - 没标记 + 覆盖模式 → 整文件覆盖为带标记的内容；
 * - 没标记 + 追加模式 → 在原内容末尾追加带标记的块（不重复写入 frontmatter）。
 */
export async function injectLatticeBlock(
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
 * `injectLatticeBlock` 的逆操作：移除 `BEGIN…END` 标记块，保留块外的用户内容。
 *
 * - 未找到完整标记 → `found: false`，原样返回（无法确认为 lattice 注入，调用方应跳过）；
 * - 找到标记 → 删除块并收敛多余空行/尾随空白；若删后仍有正文则补一个尾换行。
 *
 * 调用方用 `splitFrontmatter(result.content).body` 是否为空判断"删块后是否只剩
 * frontmatter（即整文件都是 lattice 的）"，据此决定删文件还是写回。
 */
export function stripLatticeBlock(content: string): { content: string; found: boolean } {
  const beginIdx = content.indexOf(LATTICE_BEGIN_MARKER);
  const endIdx = content.indexOf(LATTICE_END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    return { content, found: false };
  }
  const before = content.slice(0, beginIdx);
  const after = content.slice(endIdx + LATTICE_END_MARKER.length);
  let merged = `${before}${after}`;
  merged = merged.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  if (merged.trim().length > 0) merged += '\n';
  return { content: merged, found: true };
}

/**
 * Codex 特有：将 bundled commands 目录下每个 .md 文件转化为独立 Codex skill。
 * 映射规则：`task/start.md` → `~/.codex/skills/lattice-task-start/SKILL.md`
 *
 * 每个 skill 在文件头部添加 YAML frontmatter（name + description），
 * 以便 Codex Discovery 机制自动扫描注册。
 */
export async function deployCommandsAsSkills(
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

/** 一次注入落盘的路径 + 类别，供 CLI 展示。 */
export interface InjectedPath {
  kind: string;
  path: string;
}

/**
 * 对单个客户端根目录 `targetRoot` 执行全部注入（rules 块 / extraRules / skill /
 * commands / agents / Codex 命令转 skill）。是 `scanInjections`+`executeUninjectPlan`
 * 的严格逆操作，二者共享 `getAIToolConfigs()` 足迹表，注入与清除永不脱节。
 *
 * 返回本次落盘的路径清单，供 CLI 逐条展示。
 */
export async function injectToToolRoot(
  tool: AIToolConfig,
  targetRoot: string,
): Promise<InjectedPath[]> {
  const injectedPaths: InjectedPath[] = [];
  const rp = (p: string): string => resolveToolPath(p, tool.detectPath, targetRoot);
  const rulesPath = rp(tool.rulesPath);
  const skillPath = tool.skillPath ? rp(tool.skillPath) : undefined;
  const commandsRoot = tool.commandsRoot ? rp(tool.commandsRoot) : undefined;

  await ensureDir(targetRoot);

  await injectLatticeBlock(rulesPath, tool.rulesContent, tool.appendRules ? 'append' : 'overwrite');
  injectedPaths.push({ kind: 'rules', path: rulesPath });

  if (tool.extraRules && tool.extraRules.length > 0) {
    for (const extra of tool.extraRules) {
      const extraPath = rp(extra.rulesPath);
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

  // 预定义 subagent 注入：增量复制（同名覆盖 + 新增，不删除用户自定义 agent）
  if (tool.agentsRoot) {
    const agentsRoot = rp(tool.agentsRoot);
    await ensureDir(agentsRoot);
    await cp(getBundledTemplateDir('agents'), agentsRoot, { recursive: true });
    injectedPaths.push({ kind: 'agents', path: `${agentsRoot}/` });
  }

  // Codex 特有：将 commands 目录下每个命令文档转化为独立 Codex skill
  if (tool.id === 'codex') {
    const commandsDir = getBundledTemplateDir('commands');
    const deployedSkills = await deployCommandsAsSkills(commandsDir, join(targetRoot, 'skills'));
    for (const skillName of deployedSkills) {
      injectedPaths.push({ kind: 'cmd-skill', path: `${join(targetRoot, 'skills', skillName)}/` });
    }
  }

  return injectedPaths;
}

/**
 * 返回 bundled 预定义 subagent 模板文件名（如 `lattice-context.md`）。
 * uninject 据此精确识别哪些 `agents/*.md` 属 lattice 注入，避免误删用户自定义 agent。
 */
export async function listBundledAgentFiles(): Promise<string[]> {
  const dir = getBundledTemplateDir('agents');
  const entries = await readdir(dir).catch(() => [] as string[]);
  return entries.filter((name) => name.endsWith('.md'));
}
