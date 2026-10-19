import * as vscode from 'vscode';
import { CommandServices, RegisterFn, extractArgObject, showDeduped } from './shared';
import { ViewSearchState } from '../views/view-search-logic';
import { ViewSearchTarget } from '../state/view-search';
import { showViewSearchPicker } from '../pickers/view-search-picker';
import { t } from '../t';

/**
 * 单视图关键词搜索。
 * - 交互路径：QuickPick 实时预览（本地名称命中即时 + 350ms 防抖并入全文命中）；
 *   回车「应用」项 = 应用过滤并聚焦视图；结果项 = 先应用该关键词再侧栏定位。
 * - 程序化参数 `{ query }`：直接设置（不含全文并入，保证确定性）；`query: ''` 清除。
 */
async function runViewSearch(
  services: CommandServices,
  target: ViewSearchTarget,
  arg: unknown,
): Promise<ViewSearchState | undefined> {
  const search = services.viewSearch;
  if (!search) return undefined;

  const args = extractArgObject<{ query?: string }>(arg);
  if (args && typeof args.query === 'string') {
    const trimmed = args.query.trim();
    if (trimmed === '') return search.clear(target);
    return search.set(target, { query: trimmed, contentIds: [] });
  }

  const preview = services.viewSearchPreview;
  if (!preview) return undefined;
  await preview.ensure(target);
  await showViewSearchPicker({
    target,
    appliedQuery: search.get(target).query,
    preview,
    handlers: {
      apply: async (state) => {
        const next = await search.set(target, state);
        void showDeduped(
          'info',
          next.contentIds.length > 0
            ? t('Applied search "{0}" ({1} full-text hit(s)).', next.query, next.contentIds.length)
            : t('Applied search "{0}".', next.query),
        );
      },
      clear: async () => {
        await search.clear(target);
      },
      reveal: async (row) => {
        const ok = await vscode.commands.executeCommand<boolean>('lattice.revealInSidebar', {
          kind: row.kind,
          id: row.id,
        });
        return ok === true;
      },
      focusView: async () => {
        await vscode.commands.executeCommand(`lattice.${target}.focus`);
      },
    },
  });
  return undefined;
}

/** 三视图搜索命令（view/title 放大镜；再次执行并提交空串即清除）。 */
export function registerViewSearchCommands(services: CommandServices, register: RegisterFn): void {
  const targets: ViewSearchTarget[] = ['tasks', 'specs', 'projects'];
  for (const target of targets) {
    register(`lattice.${target}.search`, (arg) => runViewSearch(services, target, arg));
  }
}
