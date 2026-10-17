import * as vscode from 'vscode';
import { SearchRow } from '../cli/types';
import { CommandServices, RegisterFn, extractArgObject, showDeduped } from './shared';
import { ViewSearchState } from '../views/view-search-logic';
import { ViewSearchTarget } from '../state/view-search';
import { t } from '../t';

interface TargetConfig {
  inputTitle: string;
  /** 全文检索（FTS）纳入的文档类型。 */
  ftsTypes: string[];
  /** 从搜索结果行收集本视图的实体 id。 */
  collectIds: (row: SearchRow) => string[];
}

const TARGET_CONFIG: Record<ViewSearchTarget, TargetConfig> = {
  tasks: {
    inputTitle: t('Search Tasks'),
    ftsTypes: ['task', 'prd', 'design', 'checkpoint'],
    collectIds: (row) => [row.taskId].filter((id): id is string => Boolean(id)),
  },
  specs: {
    inputTitle: t('Search Specs'),
    ftsTypes: ['spec'],
    collectIds: (row) => [row.specId].filter((id): id is string => Boolean(id)),
  },
  projects: {
    inputTitle: t('Search Projects'),
    ftsTypes: ['project'],
    collectIds: (row) => row.projectIds.filter((id) => Boolean(id)),
  },
};

/**
 * 单视图关键词搜索。
 * - 交互路径：输入关键词 → 名称字段过滤 + FTS 全文命中并入（内容搜索）；
 * - 程序化参数 `{ query }`：直接设置（不含全文并入，保证确定性）；`query: ''` 清除。
 */
async function runViewSearch(
  services: CommandServices,
  target: ViewSearchTarget,
  arg: unknown,
): Promise<ViewSearchState | undefined> {
  const search = services.viewSearch;
  if (!search) return undefined;
  const config = TARGET_CONFIG[target];

  const args = extractArgObject<{ query?: string }>(arg);
  let query: string | undefined;
  if (args && typeof args.query === 'string') {
    query = args.query;
  } else {
    query = await vscode.window.showInputBox({
      title: config.inputTitle,
      prompt: t('Keyword search (Enter to apply; submit empty to clear)'),
      placeHolder: t('e.g. checkpoint / graph / spec-xxxx'),
      value: search.get(target).query,
    });
    if (query === undefined) return undefined;
  }

  const trimmed = query.trim();
  if (trimmed === '') {
    return search.clear(target);
  }

  // 全文命中并入（仅交互路径）：任务覆盖 PRD / 设计档案 / checkpoint 正文，规范覆盖 spec 正文
  let contentIds: string[] = [];
  if (!args) {
    try {
      const rows = await services.data.search(trimmed, { types: config.ftsTypes, limit: 200 });
      contentIds = [...new Set(rows.flatMap((row) => config.collectIds(row)))];
    } catch {
      contentIds = [];
    }
  }

  const next = await search.set(target, { query: trimmed, contentIds });
  void showDeduped(
    'info',
    contentIds.length > 0
      ? t('Applied search "{0}" ({1} full-text hit(s)).', trimmed, contentIds.length)
      : t('Applied search "{0}".', trimmed),
  );
  return next;
}

/** 三视图搜索命令（view/title 放大镜；再次执行并提交空串即清除）。 */
export function registerViewSearchCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.tasks.search', (arg) => runViewSearch(services, 'tasks', arg));
  register('lattice.specs.search', (arg) => runViewSearch(services, 'specs', arg));
  register('lattice.projects.search', (arg) => runViewSearch(services, 'projects', arg));
}
