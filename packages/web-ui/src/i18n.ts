/**
 * Web 客户端轻量 i18n：中文为源文，英文译文逐点提供（t('中文','English')）。
 *
 * 语言来源（优先级从高到低）：
 * 1. 宿主注入 `window.__LATTICE_LANG__`（VSCode Webview 由 panel 以 nonce 内联脚本注入，
 *    先于所有模块执行，保证模块级常量也能取到正确语言；取值 = 编辑器显示语言归一化）；
 * 2. 未注入（浏览器宿主）时保持中文——web 产品默认语言。
 *
 * 约定：纯展示文本用 t()；比较/判等/作为 key 的字符串不得使用 t()（避免语言切换破坏语义）。
 */

export type WebLanguage = 'zh-cn' | 'en';

declare global {
  interface Window {
    __LATTICE_LANG__?: string;
    __LATTICE_THEME__?: string;
  }
}

function detect(): WebLanguage {
  if (typeof window === 'undefined') return 'zh-cn';
  return window.__LATTICE_LANG__ === 'en' ? 'en' : 'zh-cn';
}

let current: WebLanguage = detect();

export function getLanguage(): WebLanguage {
  return current;
}

export function setLanguage(next: WebLanguage): void {
  current = next;
}

/** zh 为源文（必填），en 为译文；en 为空时回退 zh。 */
export function t(zh: string, en: string): string {
  return current === 'en' ? en : zh;
}
