import { CommandServices, RegisterFn } from './shared';

/**
 * 视图级清除入口：
 * - 搜索清除（`lattice.<view>.clearSearch`）：清空对应视图关键词搜索（任务/规范/项目）；
 * - 过滤清除（`lattice.<view>.clearFilter`）：清空对应视图过滤（任务/规范/项目/搜索结果）。
 * 说明：TreeView.message 仅纯文本，清除按钮落在视图标题栏（design.md §8.2）。
 */
export function registerViewClearCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.tasks.clearSearch', async () => {
    return services.viewSearch?.clear('tasks');
  });
  register('lattice.tasks.clearFilter', async () => {
    return services.viewFilter?.clear('tasks');
  });
  register('lattice.specs.clearSearch', async () => {
    return services.viewSearch?.clear('specs');
  });
  register('lattice.specs.clearFilter', async () => {
    return services.viewFilter?.clear('specs');
  });
  register('lattice.projects.clearSearch', async () => {
    return services.viewSearch?.clear('projects');
  });
  register('lattice.projects.clearFilter', async () => {
    return services.viewFilter?.clear('projects');
  });
  register('lattice.search.clearFilter', async () => {
    return services.viewFilter?.clear('search');
  });
}
