import * as vscode from 'vscode';
import { t } from '../t';
import { debounce } from '../util/debounce';
import { ViewSearchTarget } from '../state/view-search';
import { type ViewSearchPreviewRow } from '../views/view-search-logic';
import { VIEW_SEARCH_TARGET_CONFIG } from '../views/view-search-targets';
import { assembleViewSearchItemSpecs, type ViewSearchItemKind } from './view-search-items';
import type {
  ViewSearchPreviewResult,
  ViewSearchPreviewService,
} from '../views/view-search-preview';

/**
 * 单视图搜索选择器（实时预览）：
 * - 输入过程：本地名称命中同步渲染；350ms 防抖后并入全文命中（busy 指示）；
 * - 首项固定为「应用搜索」（默认高亮）：回车 = 应用过滤 + 聚焦视图（design.md §2.1）；
 * - 结果项：回车/点击 = 先应用该关键词（保证节点可见）再侧栏定位；
 * - 空输入回车 = 清除搜索（仅当当前已应用搜索时展示清除项）；
 * - Esc = 取消，不改状态。列表组装见 `view-search-items.ts`（纯函数，单测覆盖）。
 */

export interface ViewSearchPickItem extends vscode.QuickPickItem {
  itemKind?: ViewSearchItemKind;
  row?: ViewSearchPreviewRow;
}

/** specs（纯数据）→ QuickPickItem（含图标与分隔线）。 */
function toQuickPickItems(
  specs: ReturnType<typeof assembleViewSearchItemSpecs>,
): ViewSearchPickItem[] {
  const items: ViewSearchPickItem[] = [];
  for (const spec of specs) {
    if (spec.separatorBefore) {
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({
      label: spec.label,
      description: spec.description,
      detail: spec.detail,
      iconPath: spec.icon ? new vscode.ThemeIcon(spec.icon) : undefined,
      alwaysShow: spec.alwaysShow,
      itemKind: spec.itemKind,
      row: spec.row,
    });
  }
  return items;
}

export interface ViewSearchPickerHandlers {
  /** 应用关键词 + 全文命中 ids（写 ViewSearchService）。 */
  apply: (state: { query: string; contentIds: string[] }) => Promise<void>;
  /** 清除当前视图搜索。 */
  clear: () => Promise<void>;
  /** 应用后定位实体；返回是否定位成功。 */
  reveal: (row: ViewSearchPreviewRow) => Promise<boolean>;
  /** 应用（不定位）后聚焦对应视图。 */
  focusView: () => Promise<void>;
}

/** 在途 FTS 等待上限：超时按「已完成的本地命中」应用，避免回车被慢查询卡住。 */
const INFLIGHT_WAIT_MS = 1500;

export async function showViewSearchPicker(opts: {
  target: ViewSearchTarget;
  appliedQuery: string;
  preview: ViewSearchPreviewService;
  handlers: ViewSearchPickerHandlers;
}): Promise<void> {
  const config = VIEW_SEARCH_TARGET_CONFIG[opts.target];
  const qp = vscode.window.createQuickPick<ViewSearchPickItem>();
  qp.title = config.inputTitle;
  qp.placeholder = t('Type to preview; Enter applies; pick a result to locate');
  qp.value = opts.appliedQuery;

  let contentIds: string[] = [];
  let controller = new AbortController();
  let inflight: Promise<void> | null = null;

  const render = (preview: ViewSearchPreviewResult): void => {
    const query = qp.value.trim();
    qp.items = toQuickPickItems(
      assembleViewSearchItemSpecs({
        query,
        appliedQuery: opts.appliedQuery,
        rows: preview.rows,
        total: preview.total,
        labels: {
          clear: t('Clear search (Enter)'),
          apply: t('Apply search "{0}"', query),
          applyWithCount: t('Apply search "{0}" ({1} results)', query, preview.total),
          contentOnly: t('Full-text match'),
          kinds: { task: t('Tasks'), spec: t('Specs'), project: t('Projects') },
        },
      }),
    );
  };

  const renderLocal = (): void => {
    render(opts.preview.local(opts.target, qp.value));
  };

  const runContentSearch = async (query: string): Promise<void> => {
    const ctrl = new AbortController();
    controller = ctrl;
    qp.busy = true;
    const task = (async () => {
      try {
        const ids = await opts.preview.contentIds(opts.target, query, ctrl.signal);
        if (ctrl.signal.aborted) return;
        contentIds = ids;
        render(opts.preview.withContent(opts.target, query, ids));
      } catch {
        // 全文检索失败：静默保留本地命中（不打断输入）
      } finally {
        if (controller === ctrl) {
          qp.busy = false;
          inflight = null;
        }
      }
    })();
    inflight = task;
    await task.catch(() => undefined);
  };

  const debouncedContent = debounce((query: string) => {
    void runContentSearch(query);
  }, 350);

  const resetForValue = (): void => {
    debouncedContent.cancel();
    controller.abort();
    contentIds = [];
    inflight = null;
    qp.busy = false;
  };

  const waitInflight = async (): Promise<void> => {
    if (!inflight) return;
    await Promise.race([
      inflight.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, INFLIGHT_WAIT_MS)),
    ]);
  };

  qp.onDidChangeValue(() => {
    resetForValue();
    renderLocal();
    if (qp.value.trim() !== '') debouncedContent(qp.value);
  });

  qp.onDidAccept(() => {
    const picked = qp.selectedItems[0];
    if (!picked) return;
    const query = qp.value.trim();
    if (picked.itemKind === 'clear') {
      void opts.handlers.clear().then(() => qp.hide());
      return;
    }
    if (picked.itemKind === 'apply') {
      void (async () => {
        await waitInflight();
        await opts.handlers.apply({ query, contentIds });
        await opts.handlers.focusView();
        qp.hide();
      })();
      return;
    }
    if (picked.itemKind === 'result' && picked.row) {
      const row = picked.row;
      void (async () => {
        await waitInflight();
        await opts.handlers.apply({ query, contentIds });
        await opts.handlers.reveal(row);
        qp.hide();
      })();
    }
  });

  qp.onDidHide(() => {
    debouncedContent.cancel();
    controller.abort();
    qp.dispose();
  });

  qp.show();
  renderLocal();
  if (qp.value.trim() !== '') debouncedContent(qp.value);
}
