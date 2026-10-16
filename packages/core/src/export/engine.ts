/**
 * 知识导出引擎（`ltc export` 领域逻辑）：
 * 收集（kinds：spec/task，可扩展）→ 维度筛选（黑白名单）→ 渲染 → 幂等写盘。
 *
 * 详见任务 2026-10-16-25d8 design.md / prd.md（v2.6）。
 */
import { dirname, join, resolve } from 'node:path';
import { readdir, rmdir, unlink } from 'node:fs/promises';
import { stringify as stringifyYaml } from 'yaml';
import type { TaskStatus } from '../types';
import { nowISO } from '../utils/time';
import {
  dirExists,
  ensureDir,
  getCacheDir,
  listDir,
  listUserDirs,
  removeDir,
  writeText,
} from '../paths';
import { listAllUsernames } from '../project/cross-user';
import {
  DEFAULT_SKILL_NAME,
  EXPORT_MANIFEST,
  EXPORT_TOOL,
  readExportManifest,
  sha256,
} from './manifest';
import {
  buildProjectEntries,
  buildProjectIndex,
  projectMatchesValue,
  type ProjectEntry,
  type ProjectIndex,
} from './projects';
import { exportFileName, shortProjectId, taskExportBase, taskExportBaseFull } from './naming';
import { applySpecFilters, collectSpecs, type CollectedSpec } from './collect-spec';
import {
  collectTaskCandidates,
  filterTasks,
  renderTask,
  type RenderedTask,
  type SpecLinkIndex,
  type TaskCandidate,
} from './collect-task';
import {
  buildProjectIndexTable,
  buildSkillMd,
  buildSpecCatalog,
  buildTaskCatalog,
  ghSlug,
  PROJECT_INDEX_FILE,
  SPEC_CATALOG_FILE,
  TASK_CATALOG_FILE,
  type InvolvedProject,
  type TaskProjectSection,
} from './skill-md';
import { detectWarnings, type GuardFile } from './guards';
import type {
  ExportKind,
  ExportManifest,
  ExportProjectMatch,
  ExportResult,
  ExportRunOptions,
  SpecExportScope,
  TaskExportDepth,
} from './types';

const VALID_KINDS: ExportKind[] = ['spec', 'task'];
const VALID_STATUSES: TaskStatus[] = ['planning', 'in_progress', 'completed', 'archived'];
const VALID_DEPTHS: TaskExportDepth[] = ['digest', 'prd', 'full'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateOptions(kinds: ExportKind[], options: ExportRunOptions): void {
  for (const k of kinds) {
    if (!VALID_KINDS.includes(k)) {
      throw new Error(`无效的 --only 值「${k}」：可选 spec / task`);
    }
  }
  for (const s of options.scope ?? []) {
    if (!['all', 'global', 'user', 'project'].includes(s)) {
      throw new Error(`无效 --scope「${s}」：可选 global / user / project（all = 全部）`);
    }
  }
  if (options.taskDepth && !VALID_DEPTHS.includes(options.taskDepth)) {
    throw new Error(`无效 --task-depth「${options.taskDepth}」：可选 digest / prd / full`);
  }
  for (const s of options.taskStatuses ?? []) {
    if (s !== 'all' && !VALID_STATUSES.includes(s)) {
      throw new Error(
        `无效 --task-status「${s}」：可选 planning / in_progress / completed / archived / all`,
      );
    }
  }
  if (options.taskSince && !DATE_RE.test(options.taskSince)) {
    throw new Error(`--task-since 日期格式应为 YYYY-MM-DD：${options.taskSince}`);
  }
  if (options.taskUntil && !DATE_RE.test(options.taskUntil)) {
    throw new Error(`--task-until 日期格式应为 YYYY-MM-DD：${options.taskUntil}`);
  }
  if (options.clean && options.prune) {
    throw new Error('--clean 与 --prune 互斥：清空重导用 --clean，增量清理用 --prune');
  }
  if (options.clean && options.overwrite) {
    throw new Error('--clean 与 --overwrite 互斥：清空重导用 --clean，覆盖合并用 --overwrite');
  }
  if (options.excludeUsers?.includes('all')) {
    throw new Error('--exclude-user 不接受 all（全量白名单用 --user all；黑名单请列具体用户名）');
  }

  const specOnlyGiven =
    options.scope !== undefined ||
    Boolean(
      options.tags?.length ||
      options.excludeTags?.length ||
      options.specs?.length ||
      options.excludeSpecs?.length,
    );
  if (!kinds.includes('spec') && specOnlyGiven) {
    throw new Error(
      '--scope / --tag / --spec（及 exclude 变体）仅适用于 spec，但 --only 未包含 spec',
    );
  }
  const taskOnlyGiven =
    Boolean(
      options.tasks?.length ||
      options.excludeTasks?.length ||
      options.taskStatuses?.length ||
      options.taskSince ||
      options.taskUntil,
    ) || options.taskDepth !== undefined;
  if (!kinds.includes('task') && taskOnlyGiven) {
    throw new Error(
      '--task / --task-status / --task-depth / --task-since / --task-until 仅适用于 task，但 --only 未包含 task',
    );
  }
}

async function resolveUsers(execUser: string, users: string[] | undefined): Promise<string[]> {
  let list = users?.length ? users : [execUser];
  if (list.includes('all')) {
    // DB 用户 ∪ 文件系统用户目录，避免无项目注册的用户被漏
    const dbUsers = await listAllUsernames().catch(() => [] as string[]);
    const fsUsers = await listUserDirs();
    list = [...new Set([...dbUsers, ...fsUsers])].sort();
  }
  return list;
}

/** prune：删除陈旧文件并自底向上清理被清空的目录（只动 manifest 记录过的路径） */
async function pruneStale(outputDir: string, paths: string[]): Promise<string[]> {
  const deleted: string[] = [];
  for (const rel of paths) {
    const full = join(outputDir, rel);
    try {
      await unlink(full);
      deleted.push(rel);
    } catch {
      continue;
    }
    let dir = dirname(full);
    while (dir.startsWith(outputDir) && dir.length > outputDir.length) {
      try {
        const entries = await readdir(dir);
        if (entries.length > 0) break;
        await rmdir(dir);
      } catch {
        break;
      }
      dir = dirname(dir);
    }
  }
  return deleted;
}

export async function exportSkill(options: ExportRunOptions): Promise<ExportResult> {
  const execUser = options.execUser ?? options.users?.find((u) => u !== 'all') ?? 'default';
  const kinds: ExportKind[] = options.kinds?.length ? options.kinds : [...VALID_KINDS];
  const skillName = (options.skillName ?? DEFAULT_SKILL_NAME).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) {
    throw new Error(
      `非法 skill 名「${skillName}」：要求 kebab-case（小写字母/数字/连字符，以字母或数字开头）`,
    );
  }
  validateOptions(kinds, options);

  const scopes: SpecExportScope[] = options.scope?.length ? options.scope : ['all'];
  const taskDepth: TaskExportDepth = options.taskDepth ?? 'digest';
  let statusFilter: TaskStatus[] | undefined;
  if (kinds.includes('task')) {
    const raw = options.taskStatuses?.length ? options.taskStatuses : (['archived'] as const);
    statusFilter = (raw as readonly (TaskStatus | 'all')[]).includes('all')
      ? undefined
      : ([...(raw as readonly TaskStatus[])] as TaskStatus[]);
  }
  const dryRun = Boolean(options.dryRun);
  // CLI 输出绝对路径约定 + prune 空目录清理的路径前缀判定都依赖规范化路径
  const outputDir = resolve(options.outputDir ?? join(getCacheDir(), 'export-skill', skillName));

  // 目标目录写入安全闸（防呆默认）：
  // - 空/不存在 → 直接导出
  // - 含本工具 manifest → 本工具目录，默认增量覆盖（重复导出工作流）
  // - 非空且非本工具管理 → 默认拒绝；--clean 清空重导 / --overwrite 覆盖合并（显式选择）
  //   （空目录判定忽略 .DS_Store；dry-run 同样拒绝，保证预演与实际一致）
  const targetEntries = (await dirExists(outputDir)) ? await listDir(outputDir) : [];
  const meaningfulEntries = targetEntries.filter((e) => e !== '.DS_Store');
  const targetHasContent = meaningfulEntries.length > 0;
  const targetIsManaged = targetHasContent ? (await readExportManifest(outputDir)) !== null : false;

  if (options.clean) {
    if (!dryRun && (await dirExists(outputDir))) {
      await removeDir(outputDir);
    }
  } else if (targetHasContent && !targetIsManaged && !options.overwrite) {
    throw new Error(
      `目标目录非空且非本工具管理（无 ${EXPORT_MANIFEST}）：${outputDir}；` +
        '用 --clean 清空后重导，或 --overwrite 覆盖合并（同名路径覆盖、其余保留），或改用其他输出目录',
    );
  }

  const users = await resolveUsers(execUser, options.users);

  // 项目索引（按用户构建；含 id 归一化与虚拟合并组）
  const entriesByUser = new Map<string, ProjectEntry[]>();
  const indexByUser = new Map<string, ProjectIndex>();
  const ensureUser = async (u: string): Promise<ProjectEntry[]> => {
    if (!entriesByUser.has(u)) {
      const entries = await buildProjectEntries(u);
      entriesByUser.set(u, entries);
      indexByUser.set(u, buildProjectIndex(entries));
    }
    return entriesByUser.get(u)!;
  };
  for (const u of users) await ensureUser(u);

  // 项目过滤命中透明 + 任务侧命中集合（按用户）
  const includeAgg = new Map<string, Set<string>>();
  const excludeAgg = new Map<string, Set<string>>();
  const includeMatchedByUser = new Map<string, Set<string>>();
  const excludeMatchedByUser = new Map<string, Set<string>>();
  for (const u of users) {
    const entries = await ensureUser(u);
    const inc = new Set<string>();
    const exc = new Set<string>();
    for (const v of options.projects ?? []) {
      const hit = entries.filter((e) => projectMatchesValue(e, v));
      for (const e of hit) inc.add(e.id);
      const set = includeAgg.get(v) ?? new Set<string>();
      for (const e of hit) set.add(e.name || e.id);
      includeAgg.set(v, set);
    }
    for (const v of options.excludeProjects ?? []) {
      const hit = entries.filter((e) => projectMatchesValue(e, v));
      for (const e of hit) exc.add(e.id);
      const set = excludeAgg.get(v) ?? new Set<string>();
      for (const e of hit) set.add(e.name || e.id);
      excludeAgg.set(v, set);
    }
    if (options.projects?.length) includeMatchedByUser.set(u, inc);
    if (options.excludeProjects?.length) excludeMatchedByUser.set(u, exc);
  }
  const projectMatches: ExportProjectMatch[] = [];
  for (const v of options.projects ?? []) {
    projectMatches.push({
      filter: 'include',
      value: v,
      projects: [...(includeAgg.get(v) ?? [])].sort(),
    });
  }
  for (const v of options.excludeProjects ?? []) {
    projectMatches.push({
      filter: 'exclude',
      value: v,
      projects: [...(excludeAgg.get(v) ?? [])].sort(),
    });
  }

  // ── 收集 spec ──
  let allSpecItems: CollectedSpec[] = [];
  let sourceSpecNames = new Set<string>();
  if (kinds.includes('spec')) {
    const collected = await collectSpecs({ scope: scopes, users, execUser });
    allSpecItems = collected.items;
    sourceSpecNames = collected.sourceFileNames;
  }
  const entryForSpec = (item: CollectedSpec): ProjectEntry | undefined => {
    if (!item.projectId) return undefined;
    return (entriesByUser.get(item.user) ?? []).find((e) => e.id === item.projectId);
  };
  const specItems = kinds.includes('spec')
    ? applySpecFilters(
        allSpecItems,
        {
          filters: options.filters,
          excludeFilters: options.excludeFilters,
          tags: options.tags,
          excludeTags: options.excludeTags,
          specs: options.specs,
          excludeSpecs: options.excludeSpecs,
          projects: options.projects,
          excludeProjects: options.excludeProjects,
          excludeUsers: options.excludeUsers,
        },
        entryForSpec,
      )
    : [];

  // 项目文件夹冲突消解（同名不同逻辑项目 → 追加短 ID；保留 global/user/tasks 目录名）
  const folderByProject = new Map<string, string>();
  const usedFolders = new Set<string>(['global', 'user', 'tasks']);
  const folderOf = (item: CollectedSpec): string => {
    if (!item.projectId || !item.projectFolder) return item.level;
    const cached = folderByProject.get(item.projectId);
    if (cached) return cached;
    let folder = item.projectFolder;
    if (usedFolders.has(folder.toLowerCase())) {
      folder = `${folder}-${shortProjectId(item.projectId)}`;
    }
    usedFolders.add(folder.toLowerCase());
    folderByProject.set(item.projectId, folder);
    return folder;
  };
  for (const i of specItems) {
    if (i.level === 'project') {
      i.exportPath = `${folderOf(i)}/${exportFileName(i.user, i.spec.relativePath)}`;
    }
  }

  // spec 链接索引（供任务 digest / README 的「相关规范」）
  const specLinkIndex: SpecLinkIndex = { bySpecId: new Map() };
  for (const i of specItems) {
    const id = i.spec.frontmatter.id;
    if (id && i.exportPath) specLinkIndex.bySpecId.set(id, { path: i.exportPath, title: i.title });
  }

  // 渐进式目录（v2.7）：规范清单独立成 spec-catalog.md；其项目节锚点供任务侧串联
  const specCatalog = kinds.includes('spec') ? buildSpecCatalog(specItems, folderOf) : null;
  const projectLink = { anchors: specCatalog?.anchorByName ?? new Map<string, string>() };

  // ── 收集任务 ──
  let candidates: TaskCandidate[] = [];
  let scannedTasks = 0;
  let excludedTasks = 0;
  if (kinds.includes('task')) {
    const all = await collectTaskCandidates(users);
    scannedTasks = all.length;
    const filtered = await filterTasks(
      all,
      {
        statuses: statusFilter,
        since: options.taskSince,
        until: options.taskUntil,
        tasks: options.tasks,
        excludeTasks: options.excludeTasks,
        filters: options.filters,
        excludeFilters: options.excludeFilters,
        excludeUsers: options.excludeUsers,
        projectIncludeByUser: includeMatchedByUser,
        projectExcludeByUser: excludeMatchedByUser,
      },
      (u) => indexByUser.get(u) ?? buildProjectIndex([]),
    );
    candidates = filtered.kept;
    excludedTasks = filtered.excluded;
  }

  if (specItems.length + candidates.length === 0) {
    throw new Error('筛选条件下无匹配内容，未导出任何内容。');
  }

  // 任务排序：用户升序 → taskId 降序（新→旧）
  candidates.sort((a, b) =>
    a.user === b.user ? b.meta.id.localeCompare(a.meta.id) : a.user.localeCompare(b.user),
  );
  const renderedTasks: RenderedTask[] = [];
  const tasksByProject = new Map<string, RenderedTask[]>();
  const usedTaskBases = new Set<string>();
  for (let idx = 0; idx < candidates.length; idx += 1) {
    const c = candidates[idx];
    let base = taskExportBase(c.user, c.meta.id);
    if (usedTaskBases.has(base)) base = taskExportBaseFull(c.user, c.meta.id);
    usedTaskBases.add(base);
    const rendered = await renderTask(
      c,
      taskDepth,
      specLinkIndex,
      indexByUser.get(c.user) ?? buildProjectIndex([]),
      projectLink,
      base,
    );
    renderedTasks.push(rendered);
    for (const pid of c.resolvedProjectIds) {
      if (!tasksByProject.has(pid)) tasksByProject.set(pid, []);
      tasksByProject.get(pid)!.push(rendered);
    }
  }

  // 导出涉及的项目（规范侧 ∪ 任务侧）→ 项目索引表 + 任务目录「按项目索引」
  const entryById = new Map<string, ProjectEntry>();
  for (const list of entriesByUser.values()) {
    for (const e of list) if (!entryById.has(e.id)) entryById.set(e.id, e);
  }
  const specCountById = new Map<string, number>();
  for (const i of specItems) {
    if (i.level === 'project' && i.projectId) {
      specCountById.set(i.projectId, (specCountById.get(i.projectId) ?? 0) + 1);
    }
  }
  const involvedIds: string[] = [];
  const seenInvolved = new Set<string>();
  for (const pid of [...specCountById.keys(), ...tasksByProject.keys()]) {
    if (entryById.has(pid) && !seenInvolved.has(pid)) {
      seenInvolved.add(pid);
      involvedIds.push(pid);
    }
  }
  involvedIds.sort((a, b) =>
    (entryById.get(a)!.name || a).localeCompare(entryById.get(b)!.name || b),
  );
  const titleCount = new Map<string, number>();
  for (const id of involvedIds) {
    const name = entryById.get(id)!.name || id;
    titleCount.set(name, (titleCount.get(name) ?? 0) + 1);
  }
  const involved: InvolvedProject[] = involvedIds.map((id) => {
    const entry = entryById.get(id)!;
    const name = entry.name || id;
    const title = (titleCount.get(name) ?? 0) > 1 ? `${name}（${entry.folder}）` : name;
    return {
      title,
      anchor: ghSlug(title),
      packages: entry.packages,
      remotes: entry.gitRemotes,
      description: entry.description,
      specAnchor: specCatalog
        ? (specCatalog.anchorByName.get(entry.folder) ?? specCatalog.anchorByName.get(name))
        : undefined,
      specCount: specCountById.get(id) ?? 0,
      taskCount: (tasksByProject.get(id) ?? []).length,
    };
  });
  const taskProjectSections: TaskProjectSection[] = involvedIds
    .map((id, i) => ({
      title: involved[i].title,
      anchor: involved[i].anchor,
      specAnchor: involved[i].specAnchor,
      tasks: tasksByProject.get(id) ?? [],
    }))
    .filter((s) => s.tasks.length > 0);

  const taskCatalog = kinds.includes('task')
    ? buildTaskCatalog(renderedTasks, { projectSections: taskProjectSections })
    : null;

  const projectIndex =
    involved.length > 0
      ? buildProjectIndexTable(involved, {
          hasSpecCatalog: Boolean(specCatalog),
          hasTaskCatalog: Boolean(taskCatalog),
        })
      : null;

  // ── 产物组装 ──
  const outputs = new Map<string, string>();
  for (const i of specItems) outputs.set(i.exportPath, i.content);
  for (const t of renderedTasks) {
    outputs.set(t.exportPath, t.content);
    for (const f of t.extraFiles) outputs.set(f.path, f.content);
  }
  if (specCatalog) outputs.set(SPEC_CATALOG_FILE, specCatalog.content);
  if (taskCatalog) outputs.set(TASK_CATALOG_FILE, taskCatalog);
  if (projectIndex) outputs.set(PROJECT_INDEX_FILE, projectIndex);

  // 守卫检测（只对源文档，不含 SKILL.md/manifest）
  const guardFiles: GuardFile[] = [...outputs.entries()].map(([path, content]) => ({
    path,
    content,
  }));
  const exportedSpecNames = new Set(specItems.map((i) => i.spec.fileName));
  const warnings = detectWarnings(guardFiles, sourceSpecNames, exportedSpecNames);

  // SKILL.md（环境提示由警告类型驱动，条件生成）
  const envHints = {
    localPath: warnings.some((w) => w.type === 'local-path'),
    lattice: warnings.some((w) => w.type === 'lattice-path' || w.type === 'ltc-ref'),
  };
  const skillMd = buildSkillMd({
    name: skillName,
    description: options.description,
    kinds,
    specItems,
    tasks: renderedTasks,
    envHints,
    projectIndexCount: involved.length,
  });
  outputs.set('SKILL.md', skillMd);

  // 幂等对比 + manifest
  const oldManifest = await readExportManifest(outputDir);
  const oldHashes = new Map(oldManifest?.files.map((f) => [f.path, f.hash]) ?? []);
  const ordered = [...outputs.entries()].sort(([a], [b]) => a.localeCompare(b));
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of ordered) {
    if (oldHashes.get(rel) === sha256(content)) skipped.push(rel);
    else written.push(rel);
  }

  const stats = {
    global: specItems.filter((i) => i.level === 'global').length,
    user: specItems.filter((i) => i.level === 'user').length,
    project: specItems.filter((i) => i.level === 'project').length,
    tasks: renderedTasks.length,
  };
  const manifest: ExportManifest = {
    exportedAt: nowISO(),
    tool: EXPORT_TOOL,
    version: 2,
    name: skillName,
    stats,
    files: [],
  };
  for (const [rel, content] of ordered) {
    const hash = sha256(content);
    if (
      rel === 'SKILL.md' ||
      rel === SPEC_CATALOG_FILE ||
      rel === TASK_CATALOG_FILE ||
      rel === PROJECT_INDEX_FILE
    ) {
      const title =
        rel === 'SKILL.md'
          ? skillName
          : rel === SPEC_CATALOG_FILE
            ? `${skillName} 规范目录`
            : rel === TASK_CATALOG_FILE
              ? `${skillName} 任务档案目录`
              : `${skillName} 项目索引`;
      manifest.files.push({
        path: rel,
        hash,
        title,
        source: { kind: 'meta', user: execUser },
        generated: true,
      });
      continue;
    }
    const spec = specItems.find((i) => i.exportPath === rel);
    if (spec) {
      manifest.files.push({
        path: rel,
        hash,
        title: spec.title,
        source: {
          kind: 'spec',
          level: spec.level,
          user: spec.user,
          specId: spec.spec.frontmatter.id,
          updated: spec.spec.frontmatter.updated ?? undefined,
          projectId: spec.projectId,
        },
      });
      continue;
    }
    const task = renderedTasks.find(
      (t) => t.exportPath === rel || t.extraFiles.some((f) => f.path === rel),
    );
    if (task) {
      manifest.files.push({
        path: rel,
        hash,
        title: task.title,
        source: {
          kind: 'task',
          user: task.user,
          taskId: task.meta.id,
          status: task.meta.status,
          updated: task.meta.updated ?? undefined,
        },
      });
    }
  }

  // prune：旧 manifest 记录过、本次未导出的陈旧文件
  const pruneTargets = options.prune
    ? (oldManifest?.files ?? [])
        .filter((f) => !f.generated && !outputs.has(f.path))
        .map((f) => f.path)
    : [];

  let deleted: string[] = [];
  if (!dryRun) {
    await ensureDir(outputDir);
    for (const rel of written) await writeText(join(outputDir, rel), outputs.get(rel)!);
    await writeText(join(outputDir, EXPORT_MANIFEST), stringifyYaml(manifest, { lineWidth: 120 }));
    if (pruneTargets.length) deleted = await pruneStale(outputDir, pruneTargets);
  }

  // 缺 description 清单（目录选读依据缺失）
  const missingDescriptions = specItems
    .filter((i) => !i.spec.frontmatter.description?.trim())
    .map((i) => ({ path: i.exportPath, specId: i.spec.frontmatter.id }));

  return {
    outputDir,
    dryRun,
    manifest,
    written,
    skipped,
    deleted,
    wouldDelete: pruneTargets,
    warnings,
    missingDescriptions,
    stats: {
      scannedSpecs: allSpecItems.length,
      scannedTasks,
      excludedSpecs: allSpecItems.length - specItems.length,
      excludedTasks,
      exportedSpecs: specItems.length,
      exportedTasks: renderedTasks.length,
    },
    projectMatches,
    emptyKinds: kinds.filter((k) =>
      k === 'spec' ? specItems.length === 0 : renderedTasks.length === 0,
    ),
  };
}
