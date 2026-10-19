import type { ViewSearchPreviewKind, ViewSearchPreviewRow } from '../views/view-search-logic';

/**
 * 实时预览列表项组装（纯数据、零 vscode 依赖，供单测覆盖）。
 * 交互顺序：首项固定「应用搜索」（默认高亮）→ 结果项；空输入时仅在已应用搜索下给出「清除」项。
 */

export type ViewSearchItemKind = 'apply' | 'clear' | 'result';

export interface ViewSearchItemSpec {
  itemKind: ViewSearchItemKind;
  label: string;
  description?: string;
  detail?: string;
  icon?: string;
  alwaysShow: boolean;
  /** 结果项前插入分隔线（仅首个结果项为 true）。 */
  separatorBefore?: boolean;
  row?: ViewSearchPreviewRow;
}

export const VIEW_SEARCH_KIND_ICONS: Record<ViewSearchPreviewKind, string> = {
  task: 'checklist',
  spec: 'book',
  project: 'project',
};

export interface ViewSearchItemLabels {
  clear: string;
  /** 无命中时的应用文案（调用方 t() 生成）。 */
  apply: string;
  /** 有命中时的应用文案（含 query 与条数）。 */
  applyWithCount: string;
  contentOnly: string;
  kinds: Record<ViewSearchPreviewKind, string>;
}

export function assembleViewSearchItemSpecs(opts: {
  query: string;
  appliedQuery: string;
  rows: ViewSearchPreviewRow[];
  total: number;
  labels: ViewSearchItemLabels;
}): ViewSearchItemSpec[] {
  const query = opts.query.trim();
  if (query === '') {
    return opts.appliedQuery.trim() === ''
      ? []
      : [
          {
            itemKind: 'clear',
            label: `$(clear-all) ${opts.labels.clear}`,
            alwaysShow: true,
          },
        ];
  }
  const items: ViewSearchItemSpec[] = [
    {
      itemKind: 'apply',
      label: `$(search) ${opts.total > 0 ? opts.labels.applyWithCount : opts.labels.apply}`,
      alwaysShow: true,
    },
  ];
  let firstResult = true;
  for (const row of opts.rows) {
    items.push({
      itemKind: 'result',
      label: row.label,
      description: [
        opts.labels.kinds[row.kind],
        row.description,
        row.contentOnly ? opts.labels.contentOnly : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      detail: row.id,
      icon: VIEW_SEARCH_KIND_ICONS[row.kind],
      alwaysShow: true,
      separatorBefore: firstResult || undefined,
      row,
    });
    firstResult = false;
  }
  return items;
}
