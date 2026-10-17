import { CommandServices, RegisterFn, showDeduped } from './shared';
import { resolveRevealTarget } from '../views/reveal';
import { t } from '../t';

/** 侧栏定位（reveal）：命令参数支持树项 / 搜索结果行 / {kind,id} 对象。返回是否成功定位。 */
export function registerRevealCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.revealInSidebar', async (arg?: unknown) => {
    const target = resolveRevealTarget(arg);
    if (!target) return false;
    if (!services.reveal) return false;
    try {
      const ok = await services.reveal.reveal(target);
      if (!ok) {
        void showDeduped(
          'warn',
          t('The node is outside the current sidebar scope (check task scope / project filter).'),
        );
      }
      return ok;
    } catch (error) {
      void showDeduped(
        'warn',
        t('Reveal in sidebar failed: {0}', error instanceof Error ? error.message : String(error)),
      );
      return false;
    }
  });
}
