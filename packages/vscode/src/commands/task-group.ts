import * as vscode from 'vscode';
import { CommandServices, RegisterFn, extractArgObject } from './shared';
import { t } from '../t';
import type { TaskGroupMode } from '../state/task-group';
import { TIME_LEVEL_ORDER, normalizeTimeLevels, type TimeLevel } from '../views/task-time-groups';

/**
 * 任务视图分组方式（view/title「分组」按钮）：
 *   第一步「分组方式」：状态（默认）/ 按创建时间 / 按更新时间；
 *   第二步「时间层级」（时间模式）：年 / 月 / 日多选（任意组合，平铺或分级）。
 * 程序化参数（供集成测试）：
 *   `{ mode?: 'status' | 'created' | 'updated', levels?: Array<'year'|'month'|'day'> }`
 */

interface ModeItem extends vscode.QuickPickItem {
  value?: TaskGroupMode;
}

interface LevelItem extends vscode.QuickPickItem {
  value: TimeLevel;
}

const LEVEL_LABELS: Record<TimeLevel, string> = {
  year: t('Year'),
  month: t('Month'),
  day: t('Day'),
};

export async function setTaskGrouping(services: CommandServices, arg: unknown): Promise<unknown> {
  const service = services.taskGroup;
  if (!service) return undefined;

  // 程序化分支（集成测试 / 外部调用）：确定性、无 UI。
  const args = extractArgObject<{ mode?: unknown; levels?: unknown }>(arg);
  if (args && (typeof args.mode === 'string' || Array.isArray(args.levels))) {
    const mode: TaskGroupMode =
      args.mode === 'created' || args.mode === 'updated' ? args.mode : 'status';
    const levels = Array.isArray(args.levels) ? normalizeTimeLevels(args.levels) : service.levels;
    return service.set({ mode, levels });
  }

  const current = service.current;
  const items: ModeItem[] = [
    {
      label: `$(list-tree) ${t('Status')}`,
      value: 'status',
      description: current.mode === 'status' ? t('current') : undefined,
    },
    {
      label: `$(history) ${t('By Creation Time')}`,
      value: 'created',
      description: current.mode === 'created' ? t('current') : undefined,
    },
    {
      label: `$(clock) ${t('By Last Updated')}`,
      value: 'updated',
      description: current.mode === 'updated' ? t('current') : undefined,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: t('Task Grouping'),
    placeHolder: t('Pick how tasks are grouped'),
  });
  if (!picked?.value) return undefined;
  if (picked.value === 'status') return service.set({ mode: 'status' });

  const levelItems: LevelItem[] = TIME_LEVEL_ORDER.map((level) => ({
    label: LEVEL_LABELS[level],
    picked: current.levels.includes(level),
    value: level,
  }));
  const levelPicked = await vscode.window.showQuickPick(levelItems, {
    title: t('Time Levels'),
    placeHolder: t('Pick time levels (year / month / day)'),
    canPickMany: true,
  });
  if (!levelPicked) return undefined;
  const levels = normalizeTimeLevels(levelPicked.map((item) => item.value));
  if (levels.length === 0) {
    // 用户主动点击：不去重（每次都要有反馈）
    void vscode.window.showWarningMessage(t('Select at least one time level.'));
    return undefined;
  }
  return service.set({ mode: picked.value, levels });
}

export function registerTaskGroupCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.tasks.groupBy', (arg) => setTaskGrouping(services, arg));
}
