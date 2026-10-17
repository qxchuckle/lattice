import * as vscode from 'vscode';
import { t } from '../t';
import { formatPickerHint, pickerActionKeys } from './keys';

/**
 * 强化版 QuickPick：在统一选择器（任务 / 项目 / Spec）上支持修饰键直达动作：
 * - ⌘↵（mac）/ Ctrl+↵：复制高亮项 ID
 * - ⌥↵：在图谱中打开高亮项
 * - ⌃↵（mac）/ Ctrl+Shift+↵：在侧栏定位高亮项
 * 按键绑定见 package.json（`lattice.picker.*`，仅 `lattice.pickerActive` 时生效）。
 */

export type PickerAction = 'copyId' | 'openGraph' | 'reveal';

export interface EnhancedPickActions<T extends vscode.QuickPickItem> {
  copyId?: (item: T) => string | undefined;
  openGraph?: (item: T) => void | Promise<void>;
  reveal?: (item: T) => void | Promise<void>;
}

export interface EnhancedPickOptions<T extends vscode.QuickPickItem> {
  title?: string;
  placeHolder?: string;
  matchOnDetail?: boolean;
  matchOnDescription?: boolean;
  actions?: EnhancedPickActions<T>;
}

interface ActivePickerState {
  perform(action: PickerAction): Promise<void>;
}

let activePicker: ActivePickerState | undefined;
let activeCount = 0;

function syncContext(): void {
  void vscode.commands.executeCommand('setContext', 'lattice.pickerActive', activeCount > 0);
}

/** 由快捷键命令调用：对当前打开的选择器执行动作。 */
export async function performPickerAction(action: PickerAction): Promise<void> {
  const state = activePicker;
  if (!state) return;
  await state.perform(action);
}

export function showEnhancedPicker<T extends vscode.QuickPickItem>(
  items: T[],
  options: EnhancedPickOptions<T> = {},
): Promise<T | undefined> {
  const qp = vscode.window.createQuickPick<T>();
  qp.items = items;
  if (options.title) qp.title = options.title;
  if (options.placeHolder) qp.placeholder = options.placeHolder;
  if (options.matchOnDetail) qp.matchOnDetail = true;
  if (options.matchOnDescription) qp.matchOnDescription = true;

  const actions = options.actions ?? {};
  const hasAction = Boolean(actions.copyId || actions.openGraph || actions.reveal);
  if (hasAction) {
    qp.prompt = formatPickerHint(pickerActionKeys(), {
      copyId: t('Copy ID'),
      openGraph: t('Show in Graph'),
      reveal: t('Reveal in Sidebar'),
    });
  }

  return new Promise<T | undefined>((resolve) => {
    let settled = false;
    const settle = (value?: T): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const perform = async (action: PickerAction): Promise<void> => {
      const item = qp.activeItems[0] ?? qp.selectedItems[0];
      if (!item) return;
      switch (action) {
        case 'copyId': {
          const id = actions.copyId?.(item);
          if (!id) return; // 该项无 ID（如「无」占位）→ 保持打开
          await vscode.env.clipboard.writeText(id);
          void vscode.window.showInformationMessage(t('Copied ID: {0}', id));
          break;
        }
        case 'openGraph':
          if (!actions.openGraph) return;
          await actions.openGraph(item);
          break;
        case 'reveal':
          if (!actions.reveal) return;
          await actions.reveal(item);
          break;
      }
      // 动作已处理：调用方按「取消」结束，不继续原流程
      settle(undefined);
      qp.hide();
    };

    const state: ActivePickerState = { perform };
    qp.onDidAccept(() => {
      settle(qp.selectedItems[0] ?? qp.activeItems[0]);
      qp.hide();
    });
    qp.onDidHide(() => {
      settle(undefined);
      if (activePicker === state) activePicker = undefined;
      activeCount = Math.max(0, activeCount - 1);
      syncContext();
      qp.dispose();
    });

    activePicker = state;
    activeCount += 1;
    syncContext();
    qp.show();
  });
}
