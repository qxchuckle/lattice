/* global document, window */
(() => {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('lang');
  let preferred;
  try {
    preferred = localStorage.getItem('lattice-language-choice');
  } catch {
    /* storage can be unavailable in private modes */
  }

  const detected = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase();
  const lang =
    requested === 'zh' || requested === 'zh-cn'
      ? 'zh'
      : requested === 'en'
        ? 'en'
        : preferred === 'zh' || preferred === 'en'
          ? preferred
          : detected.startsWith('zh')
            ? 'zh'
            : 'en';
  const requestedTheme = params.get('theme');
  let storedTheme;
  try {
    storedTheme = localStorage.getItem('lattice-web-theme');
  } catch {
    /* storage can be unavailable in private modes */
  }
  const theme =
    requestedTheme === 'light' || requestedTheme === 'dark'
      ? requestedTheme
      : storedTheme === 'light'
        ? 'light'
        : 'dark';

  window.__LATTICE_LANG__ = lang === 'zh' ? 'zh-cn' : 'en';
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.setAttribute('data-demo-lang', lang);
  document.documentElement.setAttribute('data-theme', theme);

  try {
    localStorage.setItem('lattice-web-theme', theme);
  } catch {
    /* storage can be unavailable in private modes */
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.title = lang === 'zh' ? 'Lattice 工作台 Demo' : 'Lattice workbench demo';
    document.querySelector('[data-reset]')?.addEventListener('click', () => {
      window.location.reload();
    });
    document.querySelectorAll('[data-set-lang]').forEach((link) => {
      const target = link.getAttribute('data-set-lang');
      if (target) link.setAttribute('href', `?lang=${target}&theme=${theme}`);
      link.addEventListener('click', () => {
        try {
          localStorage.setItem('lattice-language-choice', target);
        } catch {
          /* storage can be unavailable in private modes */
        }
      });
    });
    document.querySelectorAll('[data-open-link]').forEach((link) => {
      link.setAttribute('href', `${window.location.pathname}?lang=${lang}&theme=${theme}`);
    });
  });
})();
