/**
 * uninject 领域逻辑 —— 全量排查并清除 init 注入到外部 AI 客户端的副作用
 *
 * 清除以全量排查为唯一真源：从 getAIToolConfigs() 足迹表反推每个平台的落盘物，
 * 靠 `<!-- LATTICE:BEGIN/END -->` 标记与 `lattice` / `lattice-*` 命名自识别，
 * 不依赖任何记录文件（init-meta.json 仅由 CLI 用作报告提示）。
 *
 * 安全边界（对齐 spec 硬禁令）：
 * - rules 文件只在含 LATTICE 标记时才动，删块后保留用户内容（仅剩 frontmatter/空才删文件）；
 * - agents 目录只删匹配 bundled 名单的文件，绝不 rm 整个目录（保护用户自定义 agent）；
 * - skill/commands 目录名恒为 `lattice`，为 lattice 独占，可整目录删。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  dirExists,
  fileExists,
  listDir,
  readText,
  removeDir,
  removeFile,
  writeText,
} from '../paths';
import {
  LATTICE_BEGIN_MARKER,
  getAIToolConfigs,
  listBundledAgentFiles,
  resolveToolPath,
  splitFrontmatter,
  stripLatticeBlock,
} from './footprint';

export type UninjectKind =
  | 'rules'
  | 'skill-dir'
  | 'commands-dir'
  | 'agents-file'
  | 'codex-skill-dir';

export type UninjectAction = 'remove-block' | 'delete-file' | 'delete-dir';

export interface InjectionFinding {
  toolId: string;
  toolName: string;
  /** 实际匹配到的客户端根目录（如 ~/.agents 或 ~/.agent） */
  targetRoot: string;
  kind: UninjectKind;
  /** 待清除的文件或目录绝对路径 */
  path: string;
  action: UninjectAction;
  /** 人类可读的清除说明 */
  detail: string;
}

export interface UninjectPlan {
  /** 磁盘上确实存在、需要清除的项 */
  findings: InjectionFinding[];
  /** 本次排查扫描过的客户端根目录 */
  scannedRoots: string[];
}

export interface ScanInjectionsOptions {
  /** 家目录，可注入以便隔离测试；默认真实家目录。 */
  home?: string;
  /** 仅排查指定平台 id（缺省 = 全部平台）。 */
  toolIds?: string[];
}

/**
 * 全量排查：遍历足迹表的每个平台、每个已存在候选根，找出磁盘上真实存在的注入物。
 * 只返回可正面识别为 lattice 注入的项（rules 靠标记、目录/文件靠 lattice 命名）。
 */
export async function scanInjections(opts: ScanInjectionsOptions = {}): Promise<UninjectPlan> {
  const home = opts.home ?? homedir();
  const allTools = getAIToolConfigs(home);
  const tools = opts.toolIds?.length
    ? allTools.filter((t) => opts.toolIds?.includes(t.id))
    : allTools;
  const bundledAgentFiles = await listBundledAgentFiles();

  const findings: InjectionFinding[] = [];
  const scannedRoots: string[] = [];

  for (const tool of tools) {
    // 收集所有已存在的候选根（detectPaths 多别名，如 ~/.agents 与 ~/.agent）
    const candidates = [tool.detectPath, ...(tool.detectPaths ?? [])];
    const seen = new Set<string>();
    const roots: string[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (await dirExists(candidate)) roots.push(candidate);
    }

    for (const targetRoot of roots) {
      scannedRoots.push(targetRoot);
      const rp = (p: string): string => resolveToolPath(p, tool.detectPath, targetRoot);
      const base = { toolId: tool.id, toolName: tool.name, targetRoot };

      // 1. rules 文件（主 + extra）：删标记块；删后只剩 frontmatter/空 → 删整个文件
      const rulesPaths = [tool.rulesPath, ...(tool.extraRules?.map((e) => e.rulesPath) ?? [])];
      for (const rulesPath of rulesPaths) {
        const p = rp(rulesPath);
        if (!(await fileExists(p))) continue;
        const content = (await readText(p)) ?? '';
        // 无标记 → 无法正面确认为 lattice 注入（可能被用户改过），跳过不动
        if (!content.includes(LATTICE_BEGIN_MARKER)) continue;
        const stripped = stripLatticeBlock(content);
        const bodyAfter = splitFrontmatter(stripped.content).body;
        const deleteWhole = !bodyAfter.trim();
        findings.push({
          ...base,
          kind: 'rules',
          path: p,
          action: deleteWhole ? 'delete-file' : 'remove-block',
          detail: deleteWhole
            ? '移除标记块后无剩余正文 → 删除文件'
            : '移除 LATTICE 标记块（保留其余内容）',
        });
      }

      // 2. skill 目录：<root>/skills/lattice/（init 先删后拷，lattice 独占）
      if (tool.skillPath) {
        const skillDir = join(rp(tool.skillPath), '..');
        if (await dirExists(skillDir)) {
          findings.push({
            ...base,
            kind: 'skill-dir',
            path: skillDir,
            action: 'delete-dir',
            detail: '删除 skill 目录',
          });
        }
      }

      // 3. commands 目录：<root>/commands/lattice/
      if (tool.commandsRoot) {
        const commandsDir = join(rp(tool.commandsRoot), 'lattice');
        if (await dirExists(commandsDir)) {
          findings.push({
            ...base,
            kind: 'commands-dir',
            path: commandsDir,
            action: 'delete-dir',
            detail: '删除 commands 目录',
          });
        }
      }

      // 4. agents 文件：只删匹配 bundled 名单的文件，禁碰用户自定义 agent
      if (tool.agentsRoot) {
        const agentsRoot = rp(tool.agentsRoot);
        for (const fileName of bundledAgentFiles) {
          const p = join(agentsRoot, fileName);
          if (await fileExists(p)) {
            findings.push({
              ...base,
              kind: 'agents-file',
              path: p,
              action: 'delete-file',
              detail: '删除注入的 subagent 模板',
            });
          }
        }
      }

      // 5. Codex 特例：deployCommandsAsSkills 生成的 <root>/skills/lattice-*/
      if (tool.id === 'codex') {
        const skillsRoot = join(targetRoot, 'skills');
        if (await dirExists(skillsRoot)) {
          for (const entry of await listDir(skillsRoot)) {
            if (!entry.startsWith('lattice-')) continue;
            const p = join(skillsRoot, entry);
            if (await dirExists(p)) {
              findings.push({
                ...base,
                kind: 'codex-skill-dir',
                path: p,
                action: 'delete-dir',
                detail: '删除 commands 转化出的 skill 目录',
              });
            }
          }
        }
      }
    }
  }

  return { findings, scannedRoots };
}

export interface UninjectResult {
  /** rules 文件删块后保留了用户内容 */
  removedBlocks: string[];
  /** 删除的文件（独占 rules 文件 / agents 模板） */
  deletedFiles: string[];
  /** 删除的目录（skill / commands / codex skill） */
  deletedDirs: string[];
}

/**
 * 执行清除计划。remove-block 项会重新读取文件、删块后写回；
 * 若删块后意外变空则退化为删文件（与 scan 判定双保险）。
 */
export async function executeUninjectPlan(plan: UninjectPlan): Promise<UninjectResult> {
  const result: UninjectResult = { removedBlocks: [], deletedFiles: [], deletedDirs: [] };

  for (const f of plan.findings) {
    if (f.action === 'delete-dir') {
      await removeDir(f.path);
      result.deletedDirs.push(f.path);
      continue;
    }
    if (f.action === 'delete-file') {
      await removeFile(f.path);
      result.deletedFiles.push(f.path);
      continue;
    }
    // remove-block
    const content = (await readText(f.path)) ?? '';
    const stripped = stripLatticeBlock(content);
    if (!stripped.found) continue;
    const bodyAfter = splitFrontmatter(stripped.content).body;
    if (!bodyAfter.trim()) {
      await removeFile(f.path);
      result.deletedFiles.push(f.path);
    } else {
      await writeText(f.path, stripped.content);
      result.removedBlocks.push(f.path);
    }
  }

  return result;
}
