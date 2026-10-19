import * as vscode from 'vscode';
import { CommandServices, RegisterFn, extractArgObject, showDeduped } from './shared';
import {
  parseListValue,
  type ProjectFilterState,
  type SearchFilterState,
  type SpecFilterState,
} from '../views/filter-logic';
import { t } from '../t';

/**
 * 规范 / 项目 / 搜索结果三视图过滤（多选 QuickPick；留空 = 清除）。
 * 程序化参数（供集成测试）：
 *   specs    `{ scopes?, projectIds? }`
 *   projects `{ groups?, tags? }`
 *   search   `{ types?, projectIds? }`
 */

interface FilterItem extends vscode.QuickPickItem {
  value?: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

const SCOPE_ORDER: Array<{ scope: string; label: string }> = [
  { scope: 'project', label: t('Project Specs') },
  { scope: 'user', label: t('User Specs') },
  { scope: 'global', label: t('Global Specs') },
];

const SEARCH_TYPE_LABELS: Record<string, string> = {
  task: t('Tasks'),
  prd: t('PRDs'),
  design: t('Design Docs'),
  spec: t('Specs'),
  project: t('Projects'),
  checkpoint: t('Checkpoints'),
  relation: t('Relations'),
};

// ── 摘要（视图消息行） ──

export function specFilterSummary(
  filter: SpecFilterState,
  projectName: (id: string) => string | undefined,
): string {
  const parts: string[] = [];
  for (const entry of SCOPE_ORDER) {
    if (filter.scopes.includes(entry.scope)) parts.push(entry.label);
  }
  for (const id of filter.projectIds) parts.push(projectName(id) ?? id);
  return parts.join(' · ');
}

export function projectFilterSummary(filter: ProjectFilterState): string {
  return [...filter.groups, ...filter.tags].join(' · ');
}

export function searchFilterSummary(
  filter: SearchFilterState,
  projectName: (id: string) => string | undefined,
): string {
  const parts: string[] = [];
  for (const type of filter.types) parts.push(SEARCH_TYPE_LABELS[type] ?? type);
  for (const id of filter.projectIds) parts.push(projectName(id) ?? id);
  return parts.join(' · ');
}

async function pickMany(
  title: string,
  placeHolder: string,
  items: FilterItem[],
): Promise<string[] | undefined> {
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder,
    canPickMany: true,
  });
  if (!picked) return undefined;
  return picked.map((item) => item.value).filter((value): value is string => Boolean(value));
}

/** 规范：层级 × 项目。 */
async function filterSpecs(
  services: CommandServices,
  arg: unknown,
): Promise<SpecFilterState | undefined> {
  const filter = services.viewFilter;
  if (!filter) return undefined;
  const args = extractArgObject<{ scopes?: unknown; projectIds?: unknown }>(arg);
  if (args && (Array.isArray(args.scopes) || Array.isArray(args.projectIds))) {
    return filter.set('specs', {
      scopes: strings(args.scopes),
      projectIds: strings(args.projectIds),
    });
  }
  await services.snapshot.ensure(['specs', 'projects']);
  const current = filter.get('specs');
  const items: FilterItem[] = SCOPE_ORDER.map((entry) => ({
    label: `$(symbol-namespace) ${entry.label}`,
    picked: current.scopes.includes(entry.scope),
    value: entry.scope,
  }));
  const projects = [...services.snapshot.data.projects].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id),
  );
  if (projects.length > 0) {
    items.push({ label: t('Projects'), kind: vscode.QuickPickItemKind.Separator });
    for (const project of projects) {
      items.push({
        label: `$(project) ${project.name || project.id}`,
        picked: current.projectIds.includes(project.id),
        value: project.id,
      });
    }
  }
  const picked = await pickMany(
    t('Filter Specs'),
    t('Select layers / projects to filter (leave empty to clear)'),
    items,
  );
  if (!picked) return undefined;
  const scopes = picked.filter((value) => SCOPE_ORDER.some((entry) => entry.scope === value));
  const projectIds = picked.filter((value) => !scopes.includes(value));
  const next = await filter.set('specs', { scopes, projectIds });
  void showDeduped('info', filter.isActive('specs') ? t('Filter updated.') : t('Filter cleared.'));
  return next;
}

/** 项目：分组 × 标签。 */
async function filterProjects(
  services: CommandServices,
  arg: unknown,
): Promise<ProjectFilterState | undefined> {
  const filter = services.viewFilter;
  if (!filter) return undefined;
  const args = extractArgObject<{ groups?: unknown; tags?: unknown }>(arg);
  if (args && (Array.isArray(args.groups) || Array.isArray(args.tags))) {
    return filter.set('projects', {
      groups: strings(args.groups),
      tags: strings(args.tags),
    });
  }
  await services.snapshot.ensure(['projects']);
  const current = filter.get('projects');
  const all = [...services.snapshot.data.projects];
  const groups = [...new Set(all.flatMap((project) => parseListValue(project.groups)))].sort();
  const tags = [...new Set(all.flatMap((project) => parseListValue(project.tags)))].sort();
  if (groups.length === 0 && tags.length === 0) {
    if (all.length === 0) {
      // 用户主动点击：不做去重（每次都要有反馈）
      void vscode.window.showInformationMessage(t('No registered projects.'));
      return undefined;
    }
    // 无分组/标签数据：不设死胡同，引导到「编辑项目元数据」（向导内可添加分组/标签）。
    // 注：此处刻意不经 showDeduped（30s 去重会让重复点击看起来「没反应」）。
    const editLabel = t('Edit Project Metadata');
    void vscode.window
      .showWarningMessage(
        t(
          'All {0} project(s) have no groups or tags yet. Add them via "Edit Project Metadata" first.',
          all.length,
        ),
        editLabel,
      )
      .then((action) => {
        if (action === editLabel) void vscode.commands.executeCommand('lattice.project.update');
      });
    return undefined;
  }
  const items: FilterItem[] = [];
  if (groups.length > 0) {
    items.push({ label: t('Groups'), kind: vscode.QuickPickItemKind.Separator });
    for (const group of groups) {
      items.push({
        label: `$(folder) ${group}`,
        picked: current.groups.includes(group),
        value: group,
      });
    }
  }
  if (tags.length > 0) {
    items.push({ label: t('Tags'), kind: vscode.QuickPickItemKind.Separator });
    for (const tag of tags) {
      items.push({
        label: `$(tag) ${tag}`,
        picked: current.tags.includes(tag),
        value: tag,
      });
    }
  }
  const picked = await pickMany(
    t('Filter Projects'),
    t('Select groups / tags to filter (leave empty to clear)'),
    items,
  );
  if (!picked) return undefined;
  const selectedGroups = picked.filter((value) => groups.includes(value));
  const selectedTags = picked.filter((value) => tags.includes(value));
  const next = await filter.set('projects', { groups: selectedGroups, tags: selectedTags });
  void showDeduped(
    'info',
    filter.isActive('projects') ? t('Filter updated.') : t('Filter cleared.'),
  );
  return next;
}

/** 搜索结果：类型 × 项目。 */
async function filterSearch(
  services: CommandServices,
  arg: unknown,
): Promise<SearchFilterState | undefined> {
  const filter = services.viewFilter;
  if (!filter) return undefined;
  const args = extractArgObject<{ types?: unknown; projectIds?: unknown }>(arg);
  if (args && (Array.isArray(args.types) || Array.isArray(args.projectIds))) {
    return filter.set('search', {
      types: strings(args.types),
      projectIds: strings(args.projectIds),
    });
  }
  await services.snapshot.ensure(['projects']);
  const current = filter.get('search');
  const items: FilterItem[] = Object.entries(SEARCH_TYPE_LABELS).map(([type, label]) => ({
    label: `$(symbol-misc) ${label}`,
    picked: current.types.includes(type),
    value: type,
  }));
  const projects = [...services.snapshot.data.projects].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id),
  );
  if (projects.length > 0) {
    items.push({ label: t('Projects'), kind: vscode.QuickPickItemKind.Separator });
    for (const project of projects) {
      items.push({
        label: `$(project) ${project.name || project.id}`,
        picked: current.projectIds.includes(project.id),
        value: project.id,
      });
    }
  }
  const picked = await pickMany(
    t('Filter Results'),
    t('Select types / projects to filter (leave empty to clear)'),
    items,
  );
  if (!picked) return undefined;
  const types = picked.filter((value) => value in SEARCH_TYPE_LABELS);
  const projectIds = picked.filter((value) => !(value in SEARCH_TYPE_LABELS));
  const next = await filter.set('search', { types, projectIds });
  void showDeduped('info', filter.isActive('search') ? t('Filter updated.') : t('Filter cleared.'));
  return next;
}

/** 三视图过滤命令（view/title `$(filter)`）。 */
export function registerViewFilterCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.specs.filter', (arg) => filterSpecs(services, arg));
  register('lattice.projects.filter', (arg) => filterProjects(services, arg));
  register('lattice.search.filter', (arg) => filterSearch(services, arg));
}
