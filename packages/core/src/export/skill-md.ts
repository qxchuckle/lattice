/**
 * 产物渲染：SKILL.md（渐进式加载入口，保持精简）与两个目录文件
 * （spec-catalog.md / task-catalog.md）。
 *
 * 结构（v2.7）：
 * - SKILL.md：description（作用 + 何时必须读取）→ 简介 → 怎么使用 → 使用注意（条件）
 *   → 目录（链接到两个 catalog）。不内联清单（防入口膨胀）。
 * - spec-catalog.md：全局级 / 用户级（### 用户名）/ 项目级（### 项目名 + 匹配信息行）
 * - task-catalog.md：按用户的完整任务清单（标题 + 关联项目链接）
 *
 * 三向串联：任务档案「关联项目」与 task-catalog 项目标注 → 规范目录项目节（锚点）；
 * 任务档案「相关规范」→ 具体 spec 文件（在 collect-task 渲染）。
 */
import type { CollectedSpec } from './collect-spec';
import type { RenderedTask } from './collect-task';
import type { ExportKind } from './types';
import { parseJsonArray } from './projects';

export const SPEC_CATALOG_FILE = 'spec-catalog.md';
export const TASK_CATALOG_FILE = 'task-catalog.md';
export const PROJECT_INDEX_FILE = 'project-index.md';

/** 导出涉及的项目（规范侧 ∪ 任务侧），供项目索引表与任务目录「按项目索引」使用 */
export interface InvolvedProject {
  title: string;
  anchor: string;
  packages: string[];
  remotes: string[];
  description: string;
  /** 规范目录中该项目节的锚点（有导出规范且无同名歧义时有值） */
  specAnchor?: string;
  specCount: number;
  taskCount: number;
}

export interface TaskProjectSection {
  title: string;
  anchor: string;
  /** 规范目录中同名项目节的锚点（有则标题链接过去） */
  specAnchor?: string;
  tasks: RenderedTask[];
}

/** GitHub 风格标题锚点（生成侧与链接侧共用同一函数，保证一致） */
export function ghSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

/** 链接文本安全化：方括号转全角（防破坏 Markdown 链接语法） */
export function mdLinkText(text: string): string {
  return text.replace(/\[/g, '［').replace(/\]/g, '］');
}

/**
 * 目录行：`[标题](相对路径)：描述`（Markdown 相对链接，人可点击跳转）。
 * 说明：导出物为双消费者（AI + 人），链接用官方 `[]()` 形式是对
 * ai-doc-system-architecture §三 的有意例外（用户拍板，权衡见 design.md 补充拍板②）。
 */
function tocLine(i: CollectedSpec): string {
  const text = mdLinkText(i.title || i.exportPath.split('/').pop() || i.exportPath);
  return `- [${text}](${i.exportPath})${descSuffix(i)}`;
}

function descSuffix(i: CollectedSpec): string {
  const d = i.spec.frontmatter.description;
  // description 是 AI 目录选读的核心依据，不截断；仅压平换行保证单行
  return d ? `：${d.replace(/\s+/g, ' ').trim()}` : '';
}

/** 生成项目匹配信息行：外部 agent 凭包名/git remote 对上项目（本机路径对他人无意义，不含） */
function buildProjectInfoLine(
  meta:
    | {
        name: string;
        localPath: string;
        packageNames: string;
        gitRemote: string;
        description: string;
      }
    | undefined,
): string {
  if (!meta) return '';
  const parts: string[] = [];
  const pkgs = parseJsonArray(meta.packageNames);
  if (pkgs.length) parts.push(`包：${pkgs.join('、')}`);
  const remotes = parseJsonArray(meta.gitRemote);
  if (remotes.length) parts.push(`git：${remotes.join('、')}`);
  if (meta.description) {
    // 不截断（信息完整性红线）；仅压平换行保证单行
    parts.push(`描述：${meta.description.replace(/\s+/g, ' ').trim()}`);
  }
  return parts.length ? parts.join(' · ') : '';
}

/**
 * SKILL.md description：**固定模板**（作用 + 何时必须读取），
 * 不含任何数据面内容（计数 / 主题 / 项目列表 → 由目录文件承载，避免每次导出漂移）。
 * 按 kinds 分三种静态变体。
 */
function buildStaticDescription(kinds: ExportKind[]): string {
  const hasSpec = kinds.includes('spec');
  const hasTask = kinds.includes('task');
  if (hasSpec && hasTask) {
    return 'Lattice 知识库：开发规范（约束与项目认知）与历史任务经验（PRD、关键决策与试错记录）。在相关项目的开发任务开始前必须读取；编写或修改代码、技术选型、约定确认、历史问题排查时，按目录选读对应规范与任务档案。';
  }
  if (hasSpec) {
    return 'Lattice 规范知识库：开发规范与项目认知（可执行的约束、约定与经验）。在相关项目的开发任务开始前必须读取；编写或修改代码、技术选型、约定确认时按目录选读对应规范。';
  }
  return 'Lattice 任务经验库：历史任务的 PRD、关键决策与试错记录。在进入同类领域、需要借鉴先例或排查历史问题时必须读取；按目录选读对应任务档案。';
}

// ─── spec-catalog.md ───

export interface ProjectCatalogSection {
  folder: string;
  title: string;
  anchor: string;
  meta?: NonNullable<CollectedSpec['projectMeta']>;
  items: CollectedSpec[];
}

/** 项目级规范分组（标题文本与锚点同源：anchor = ghSlug(title)） */
function buildProjectSections(
  specItems: CollectedSpec[],
  folderOf: (item: CollectedSpec) => string,
): ProjectCatalogSection[] {
  const byFolder = new Map<string, CollectedSpec[]>();
  const metaByFolder = new Map<string, NonNullable<CollectedSpec['projectMeta']>>();
  for (const i of specItems) {
    if (i.level !== 'project') continue;
    const f = folderOf(i);
    if (!byFolder.has(f)) {
      byFolder.set(f, []);
      if (i.projectMeta) metaByFolder.set(f, i.projectMeta);
    }
    byFolder.get(f)!.push(i);
  }
  // 同名项目标题撞车时附文件夹名区分
  const nameCount = new Map<string, number>();
  for (const meta of metaByFolder.values()) {
    nameCount.set(meta.name, (nameCount.get(meta.name) ?? 0) + 1);
  }
  const sections: ProjectCatalogSection[] = [];
  for (const folder of [...byFolder.keys()].sort()) {
    const meta = metaByFolder.get(folder);
    const title =
      meta && (nameCount.get(meta.name) ?? 0) > 1
        ? `${meta.name}（${folder}）`
        : (meta?.name ?? folder);
    sections.push({
      folder,
      title,
      anchor: ghSlug(title),
      meta,
      items: byFolder.get(folder)!.sort((a, b) => a.exportPath.localeCompare(b.exportPath)),
    });
  }
  return sections;
}

export interface SpecCatalogResult {
  content: string;
  /** 项目显示名 / 文件夹名 → 锚点（供任务侧链接） */
  anchorByName: Map<string, string>;
}

export function buildSpecCatalog(
  specItems: CollectedSpec[],
  folderOf: (item: CollectedSpec) => string,
): SpecCatalogResult {
  const lines: string[] = [
    '# 规范目录',
    '',
    `共 ${specItems.length} 份规范。层级 project > user > global，同相对路径近覆盖远。`,
    '',
  ];

  // 全局级
  const globalItems = specItems
    .filter((i) => i.level === 'global')
    .sort((a, b) => a.exportPath.localeCompare(b.exportPath));
  lines.push('## 全局级规范', '');
  lines.push(...(globalItems.length ? globalItems.map(tocLine) : ['无']));
  lines.push('');

  // 用户级（### 用户名）
  const userItems = specItems.filter((i) => i.level === 'user');
  lines.push('## 用户级规范', '');
  if (userItems.length) {
    const byUser = new Map<string, CollectedSpec[]>();
    for (const i of userItems) {
      if (!byUser.has(i.user)) byUser.set(i.user, []);
      byUser.get(i.user)!.push(i);
    }
    for (const username of [...byUser.keys()].sort()) {
      lines.push(`### ${username}`, '');
      for (const i of byUser
        .get(username)!
        .sort((a, b) => a.exportPath.localeCompare(b.exportPath))) {
        lines.push(tocLine(i));
      }
      lines.push('');
    }
  } else {
    lines.push('无', '');
  }

  // 项目级（### 项目名 + 匹配信息行）
  const sections = buildProjectSections(specItems, folderOf);
  lines.push('## 项目级规范', '');
  if (sections.length) {
    for (const s of sections) {
      lines.push(`### ${s.title}`, '');
      const info = buildProjectInfoLine(s.meta);
      if (info) lines.push(info, '');
      for (const i of s.items) lines.push(tocLine(i));
      lines.push('');
    }
  } else {
    lines.push('无', '');
  }

  // 锚点索引：文件夹名唯一 → 总是可映射；显示名仅在唯一时映射（同名歧义退化为纯文本，避免错链）
  const anchorByName = new Map<string, string>();
  const sectionNameCount = new Map<string, number>();
  for (const s of sections) {
    if (s.meta?.name)
      sectionNameCount.set(s.meta.name, (sectionNameCount.get(s.meta.name) ?? 0) + 1);
  }
  for (const s of sections) {
    anchorByName.set(s.folder, s.anchor);
    if (s.meta?.name && (sectionNameCount.get(s.meta.name) ?? 0) === 1) {
      anchorByName.set(s.meta.name, s.anchor);
    }
  }
  return { content: `${lines.join('\n').trimEnd()}\n`, anchorByName };
}

// ─── task-catalog.md ───

export function buildTaskCatalog(
  tasks: RenderedTask[],
  opts: { projectSections?: TaskProjectSection[] },
): string {
  const lines: string[] = ['# 任务档案目录', ''];
  if (tasks.length === 0) {
    lines.push('无', '');
    return lines.join('\n');
  }
  const dates = tasks
    .map((t) => (t.meta.created ?? '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const span = dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '';
  const multiUser = new Set(tasks.map((t) => t.user)).size > 1;
  lines.push(
    `共 ${tasks.length} 个任务（${span}）。按项目分组（涉及多个项目时在多个分组下重复出现）；任务为历史工作记录（PRD + 关键决策与试错要点）。`,
    '',
  );

  const taskLine = (t: RenderedTask): string =>
    `- [${mdLinkText(t.title)}](${t.exportPath})${multiUser ? ` · 用户：${t.user}` : ''}`;

  const assigned = new Set<string>();
  for (const s of opts.projectSections ?? []) {
    lines.push(
      s.specAnchor
        ? `### [${mdLinkText(s.title)}](${SPEC_CATALOG_FILE}#${s.specAnchor})`
        : `### ${s.title}`,
      '',
    );
    for (const t of s.tasks) {
      assigned.add(t.exportPath);
      lines.push(taskLine(t));
    }
    lines.push('');
  }
  const unassigned = tasks.filter((t) => !assigned.has(t.exportPath));
  if (unassigned.length > 0) {
    lines.push('### 未关联项目', '');
    for (const t of unassigned) lines.push(taskLine(t));
    lines.push('');
  }
  return lines.join('\n');
}

// ─── project-index.md ───

function tableCell(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
  return oneLine || '—';
}

/** 项目索引表：外部 AI 先在本地环境按包名 / git remote 对上项目，再进入规范与任务 */
export function buildProjectIndexTable(
  projects: InvolvedProject[],
  opts: { hasSpecCatalog: boolean; hasTaskCatalog: boolean },
): string {
  const lines: string[] = [
    '# 项目索引',
    '',
    `共 ${projects.length} 个涉及项目。先在本地环境按包名 / git remote 对上你正在做的项目，再进入对应规范与任务。`,
    '',
  ];
  if (projects.length === 0) {
    lines.push('无', '');
    return lines.join('\n');
  }
  const hasDescriptions = projects.some((p) => p.description.trim());
  const cols = ['项目', 'git'];
  if (hasDescriptions) cols.push('描述');
  if (opts.hasSpecCatalog) cols.push('规范');
  if (opts.hasTaskCatalog) cols.push('任务');
  lines.push(`| ${cols.join(' | ')} |`);
  lines.push(`|${cols.map(() => ' --- ').join('|')}|`);
  for (const p of projects) {
    // 包名与项目名一致时不重复展示；不一致时并入项目单元格（省一列）
    const pkgExtra =
      p.packages.length > 0 && !(p.packages.length === 1 && p.packages[0] === p.title)
        ? `（包：${p.packages.join('、')}）`
        : '';
    const row: string[] = [tableCell(`${p.title}${pkgExtra}`), tableCell(p.remotes.join('、'))];
    if (hasDescriptions) row.push(tableCell(p.description));
    if (opts.hasSpecCatalog) {
      row.push(
        p.specCount === 0
          ? '—'
          : p.specAnchor
            ? `[${p.specCount} 份](${SPEC_CATALOG_FILE}#${p.specAnchor})`
            : `${p.specCount} 份`,
      );
    }
    if (opts.hasTaskCatalog) {
      row.push(p.taskCount === 0 ? '—' : `[${p.taskCount} 个](${TASK_CATALOG_FILE}#${p.anchor})`);
    }
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── SKILL.md ───

export interface SkillMdInput {
  name: string;
  description?: string;
  kinds: ExportKind[];
  specItems: CollectedSpec[];
  tasks: RenderedTask[];
  envHints: { localPath: boolean; lattice: boolean };
  /** 导出涉及的项目数（>0 时生成 project-index.md 入口与目录链接） */
  projectIndexCount?: number;
}

export function buildSkillMd(input: SkillMdInput): string {
  const { name, specItems, tasks, envHints, kinds } = input;
  const description = input.description ?? buildStaticDescription(kinds);
  const hasSpecKind = kinds.includes('spec');
  const hasTaskKind = kinds.includes('task');

  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${description.replace(/\n/g, ' ')}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${name}`);
  lines.push('');

  // 简介
  const introParts: string[] = [];
  if (specItems.length) introParts.push(`${specItems.length} 份规范`);
  if (tasks.length) introParts.push(`${tasks.length} 份任务档案`);
  lines.push(
    introParts.length ? `Lattice 知识导出：${introParts.join(' + ')}。` : 'Lattice 知识导出。',
  );
  lines.push('');

  // 怎么使用（渐进式加载指引 + 串联说明）
  const hasProjectSpecs = specItems.some((i) => i.level === 'project');
  lines.push('## 怎么使用');
  lines.push('');
  lines.push(
    '- 本文件是入口（渐进式加载）：先按下方「目录」打开对应目录文件挑选，再读具体文档；不必全量读取，不确定是否相关时宁多勿少',
  );
  if ((input.projectIndexCount ?? 0) > 0) {
    lines.push(
      '- 对接本地环境：先在项目索引（`project-index.md`）按包名 / git remote 找到你正在做的项目，再循链接进入对应规范小节与任务清单',
    );
  }
  if (hasSpecKind) {
    lines.push(
      '- 规范：必须遵守的约束与项目认知——编码、选型、评审前先读相关规范；层级 project > user > global，同相对路径近覆盖远',
    );
  }
  if (hasProjectSpecs) {
    lines.push('- 项目级规范按项目分组（附包名 / git remote），凭此对上你正在做的项目');
  }
  if (hasTaskKind) {
    lines.push(
      '- 任务档案（`tasks/`）：历史任务记录（PRD + 关键决策与试错要点），借鉴先例用，非约束性文档',
    );
    lines.push(
      '- 任务档案、任务目录、项目索引之间以「关联项目 / 相关规范 / 项目节」互链，可循 项目 ↔ 规范 ↔ 任务 串联阅读',
    );
  }
  lines.push('- 文档名 `<用户>__` 前缀 = 来源用户（多用户沉淀时同名文档共存）');
  lines.push(
    '- 文档间引用为 Markdown 相对链接（点击可跳转；路径相对所属文件位置），链接文本为标题 / 名称',
  );
  lines.push('');

  // 使用注意（条件生成）
  if (envHints.localPath || envHints.lattice) {
    lines.push('## 使用注意');
    lines.push('');
    lines.push(
      '本知识库内容来自原作者的环境，命令、路径、工具引用都是那个环境的一部分；使用前先在当前环境找到对应物，无法对应时显式说明并按语义近似执行。',
    );
    lines.push('');
    if (envHints.localPath) {
      lines.push(
        '- `/Users/…`、`/home/…`、`C:\\…`、`~/…` 等为作者本机路径：先按项目匹配信息（包名 / git remote）在当前环境定位对应项目仓库，再替换为等效路径使用',
      );
    }
    if (envHints.lattice) {
      lines.push(
        '- `~/.lattice` 与 `ltc <命令>` 为作者的 Lattice 数据目录与 CLI（当前环境无此工具）：按流程语义理解并找等效方式；执行到无法使用的命令时显式说明并跳过该步骤',
      );
    }
    lines.push('');
  }

  // 目录（指向独立目录文件，保持入口精简）
  lines.push('## 目录');
  lines.push('');
  if ((input.projectIndexCount ?? 0) > 0) {
    lines.push(
      `- [${PROJECT_INDEX_FILE}](${PROJECT_INDEX_FILE}) — 项目索引：${input.projectIndexCount} 个涉及项目（包名 / git remote ↔ 规范 / 任务）`,
    );
  }
  if (hasSpecKind) {
    lines.push(
      `- [${SPEC_CATALOG_FILE}](${SPEC_CATALOG_FILE}) — 规范目录：${specItems.length} 份（分层级 / 按项目，含标题与完整描述）`,
    );
  }
  if (hasTaskKind) {
    lines.push(
      `- [${TASK_CATALOG_FILE}](${TASK_CATALOG_FILE}) — 任务档案目录：${tasks.length} 个（按项目分组）`,
    );
  }
  lines.push('');

  return lines.join('\n');
}
