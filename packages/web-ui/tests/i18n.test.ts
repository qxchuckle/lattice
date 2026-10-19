import { afterEach, describe, expect, it, vi } from 'vitest';

/** 宿主语言注入（window.__LATTICE_LANG__）在模块加载时读取，需 resetModules 重评估 */

interface I18nWindow extends Window {
  __LATTICE_LANG__?: string;
}

afterEach(() => {
  vi.resetModules();
  delete (window as I18nWindow).__LATTICE_LANG__;
});

describe('i18n：语言检测与 t() 回落', () => {
  it('未注入语言标记（浏览器宿主）默认中文', async () => {
    vi.resetModules();
    const mod = await import('../src/i18n');
    expect(mod.getLanguage()).toBe('zh-cn');
    expect(mod.t('中文源文', 'English')).toBe('中文源文');
  });

  it('宿主注入 en 时，模块加载即为英文', async () => {
    (window as I18nWindow).__LATTICE_LANG__ = 'en';
    vi.resetModules();
    const mod = await import('../src/i18n');
    expect(mod.getLanguage()).toBe('en');
    expect(mod.t('中文源文', 'English')).toBe('English');
  });

  it('非受支持的语言标记回落中文', async () => {
    (window as I18nWindow).__LATTICE_LANG__ = 'ja';
    vi.resetModules();
    const mod = await import('../src/i18n');
    expect(mod.getLanguage()).toBe('zh-cn');
  });

  it('setLanguage 切换后 t() 跟随', async () => {
    vi.resetModules();
    const mod = await import('../src/i18n');
    mod.setLanguage('en');
    expect(mod.getLanguage()).toBe('en');
    expect(mod.t('中文源文', 'English')).toBe('English');
    mod.setLanguage('zh-cn');
    expect(mod.t('中文源文', 'English')).toBe('中文源文');
  });
});
