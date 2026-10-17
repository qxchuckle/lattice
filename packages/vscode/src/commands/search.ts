import * as vscode from 'vscode';
import { SearchRow } from '../cli/types';
import { CliError } from '../cli/errors';
import { getConfig } from '../config';
import { truncate } from '../cli/parsers';
import { t } from '../t';
import { debounce } from '../util/debounce';
import { CommandServices, RegisterFn, handleCliError, showDeduped } from './shared';

const TYPE_ORDER = ['task', 'prd', 'design', 'spec', 'project', 'checkpoint', 'relation'];

const TYPE_LABELS: Record<string, string> = {
  task: t('Tasks'),
  prd: t('PRDs'),
  design: t('Design Docs'),
  spec: t('Specs'),
  project: t('Projects'),
  checkpoint: t('Checkpoints'),
  relation: t('Relations'),
};

const TYPE_ICONS: Record<string, string> = {
  task: 'checklist',
  prd: 'book',
  design: 'lightbulb',
  spec: 'book',
  project: 'project',
  checkpoint: 'milestone',
  relation: 'link',
};

interface SearchPickItem extends vscode.QuickPickItem {
  searchRow?: SearchRow;
  historyQuery?: string;
  clearHistory?: boolean;
}

const SEARCH_HISTORY_KEY = 'lattice.searchHistory';
const SEARCH_HISTORY_MAX = 20;

/** 搜索历史（workspaceState；最近在前）。 */
function loadSearchHistory(services: CommandServices): string[] {
  const raw = services.context.workspaceState.get<unknown>(SEARCH_HISTORY_KEY);
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

async function rememberSearch(services: CommandServices, query: string): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return;
  const next = [trimmed, ...loadSearchHistory(services).filter((item) => item !== trimmed)].slice(
    0,
    SEARCH_HISTORY_MAX,
  );
  await services.context.workspaceState.update(SEARCH_HISTORY_KEY, next);
}

async function clearSearchHistory(services: CommandServices): Promise<void> {
  await services.context.workspaceState.update(SEARCH_HISTORY_KEY, []);
}

const BUTTON_GRAPH: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('type-hierarchy'),
  tooltip: t('Show in Graph'),
};

const BUTTON_COPY: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('copy'),
  tooltip: t('Copy ID'),
};

function parseQuery(raw: string): { query: string; types: string[] } {
  const match = raw.trim().match(/^#(task|spec|project|checkpoint|relation|prd|design)\s+(.*)$/i);
  if (match) return { types: [match[1].toLowerCase()], query: match[2].trim() };
  return { types: [], query: raw.trim() };
}

function rowId(row: SearchRow): string | undefined {
  return row.specId ?? row.taskId ?? row.checkpointId ?? row.relationId ?? row.filePath;
}

async function openSearchResult(services: CommandServices, row: SearchRow): Promise<void> {
  switch (row.type) {
    case 'task':
    case 'prd':
      await vscode.commands.executeCommand('lattice.task.openDoc', {
        taskId: row.taskId,
        doc: 'prd',
      });
      return;
    case 'design':
      await vscode.commands.executeCommand('lattice.task.openDoc', {
        taskId: row.taskId,
        doc: 'design',
      });
      return;
    case 'spec':
      if (row.filePath) {
        await vscode.window.showTextDocument(vscode.Uri.file(row.filePath), { preview: false });
        return;
      }
      if (row.specId) {
        await vscode.commands.executeCommand('lattice.spec.openById', { specId: row.specId });
      }
      return;
    case 'project':
    case 'relation':
      await vscode.commands.executeCommand('lattice.project.open', {
        projectId: row.projectIds[0],
      });
      return;
    case 'checkpoint':
      await vscode.commands.executeCommand('lattice.task.openCheckpoint', {
        taskId: row.taskId,
        checkpointId: row.checkpointId,
      });
      return;
    default:
      if (row.filePath) {
        await vscode.window.showTextDocument(vscode.Uri.file(row.filePath), { preview: false });
      }
  }
}

function toPickItems(services: CommandServices, rows: SearchRow[]): SearchPickItem[] {
  const sorted = [...rows].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const items: SearchPickItem[] = [];
  let lastType: string | undefined;
  for (const row of sorted) {
    if (row.type !== lastType) {
      items.push({
        label: TYPE_LABELS[row.type] ?? row.type,
        kind: vscode.QuickPickItemKind.Separator,
      });
      lastType = row.type;
    }
    const project = row.projectIds.map((id) => services.snapshot.findProject(id)).find(Boolean);
    const snippet =
      row.snippet && row.snippet !== row.title ? truncate(row.snippet, 80) : undefined;
    items.push({
      label: `${row.title || row.filePath || row.type}`,
      description: [row.type, project?.name, row.weakMatch ? t('weak match') : undefined]
        .filter(Boolean)
        .join(' · '),
      detail: snippet,
      iconPath: new vscode.ThemeIcon(TYPE_ICONS[row.type] ?? 'symbol-misc'),
      searchRow: row,
      buttons: [BUTTON_GRAPH, BUTTON_COPY],
    });
  }
  return items;
}

const GRAPH_ANCHORS: Record<string, 'task' | 'project' | 'spec' | undefined> = {
  task: 'task',
  prd: 'task',
  design: 'task',
  project: 'project',
  spec: 'spec',
};

export async function openSearchQuickPick(
  services: CommandServices,
  initial?: string,
): Promise<void> {
  const quickPick = vscode.window.createQuickPick<SearchPickItem>();
  quickPick.title = t('Search Lattice');
  quickPick.placeholder = t(
    'Search tasks, specs, projects, checkpoints, relations — #task/#spec/#project prefix filters',
  );
  quickPick.matchOnDetail = true;
  quickPick.value = initial ?? '';

  let controller = new AbortController();

  const runSearch = async (raw: string): Promise<void> => {
    const { query, types } = parseQuery(raw);
    if (query.length < 2) {
      quickPick.items = [];
      quickPick.busy = false;
      return;
    }
    controller.abort();
    controller = new AbortController();
    quickPick.busy = true;
    services.searchState.set({ query: raw.trim(), loading: true, error: undefined });
    try {
      const config = getConfig();
      const rows = await services.data.search(query, {
        types: types.length > 0 ? types : config.searchTypes,
        limit: config.searchLimit,
        signal: controller.signal,
      });
      quickPick.items = toPickItems(services, rows);
      services.searchState.set({
        query: raw.trim(),
        results: rows,
        loading: false,
        error: undefined,
        at: Date.now(),
      });
    } catch (error) {
      if (error instanceof CliError && error.code === 'CLI_CANCELED') return;
      const message = error instanceof Error ? error.message : String(error);
      services.searchState.set({ loading: false, error: message });
      quickPick.items = [];
      await handleCliError(error, t('Search failed'));
    } finally {
      quickPick.busy = false;
    }
  };

  const debouncedSearch = debounce((value: string) => {
    void runSearch(value);
  }, 350);

  /** 空输入时展示历史查询（含清除项）。 */
  const renderHistory = (): void => {
    const entries = loadSearchHistory(services);
    if (entries.length === 0) {
      quickPick.items = [];
      return;
    }
    const items: SearchPickItem[] = entries.map((query) => ({
      label: `$(history) ${query}`,
      historyQuery: query,
    }));
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: `$(trash) ${t('Clear Search History')}`, clearHistory: true });
    quickPick.items = items;
  };

  quickPick.onDidChangeValue((value) => {
    if (value.trim() === '') {
      // 清空输入 → 回到历史列表（中止在途检索）
      debouncedSearch.cancel();
      controller.abort();
      quickPick.busy = false;
      renderHistory();
      return;
    }
    // 有输入：历史项即时让位（避免防抖窗口内误吸历史项）
    if (quickPick.items.some((item) => item.historyQuery || item.clearHistory)) {
      quickPick.items = [];
    }
    void debouncedSearch(value);
  });

  quickPick.onDidAccept(() => {
    const picked = quickPick.selectedItems[0];
    if (!picked) {
      // 回车提交当前输入 → 记入历史
      if (quickPick.value.trim().length >= 2) void rememberSearch(services, quickPick.value);
      return;
    }
    if (picked.clearHistory) {
      void clearSearchHistory(services).then(() => renderHistory());
      return;
    }
    if (picked.historyQuery) {
      quickPick.value = picked.historyQuery; // 触发检索
      return;
    }
    if (picked.searchRow) {
      void rememberSearch(services, quickPick.value);
      void openSearchResult(services, picked.searchRow);
      quickPick.hide();
    }
  });
  quickPick.onDidHide(() => {
    debouncedSearch.cancel();
    controller.abort();
    quickPick.dispose();
  });
  quickPick.onDidTriggerItemButton(async (event) => {
    const row = event.item.searchRow;
    if (!row) return;
    if (event.button === BUTTON_GRAPH) {
      const view = GRAPH_ANCHORS[row.type];
      if (!view) {
        void showDeduped('warn', t('This result has no graph anchor.'));
        return;
      }
      const anchorId =
        view === 'task' ? row.taskId : view === 'spec' ? row.specId : row.projectIds[0];
      if (!anchorId) return;
      await services.graph?.open({ view, anchorId });
      quickPick.hide();
    } else if (event.button === BUTTON_COPY) {
      const id = rowId(row);
      if (!id) return;
      await vscode.env.clipboard.writeText(id);
      void showDeduped('info', t('Copied: {0}', id));
    }
  });

  quickPick.show();
  if (quickPick.value.trim()) {
    void runSearch(quickPick.value);
  } else {
    renderHistory();
  }
}

export function registerSearchCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.search.open', async (initial?: unknown) => {
    await openSearchQuickPick(services, typeof initial === 'string' ? initial : undefined);
  });
  register('lattice.search.rerun', async () => {
    const query = services.searchState.current.query;
    await openSearchQuickPick(services, query || undefined);
  });
  register('lattice.search.clear', async () => {
    services.searchState.clear();
  });
}
