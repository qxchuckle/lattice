/* global document, window, Element, HTMLSelectElement */
(() => {
  const STORAGE_KEY = 'lattice-language-choice';
  const script = document.currentScript;
  let base = '/';

  if (script && script.src) {
    const url = new URL(script.src);
    base = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  }
  if (!base.endsWith('/')) base += '/';

  const path = window.location.pathname;
  if (!path.startsWith(base)) return;

  const rest = path.slice(base.length);
  if (rest.startsWith('demo/') || rest.includes('404') || /\.(?:html|txt|xml)$/.test(rest)) return;

  const isZhPath = rest === 'zh-cn' || rest.startsWith('zh-cn/');

  let preferred = null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    preferred = stored === 'zh' || stored === 'en' ? stored : null;
  } catch {
    /* storage can be unavailable in private modes */
  }

  // Persist a choice only when it actually differs from the page being viewed, so
  // clicking the language you are already reading does not pin the preference.
  const remember = (choice) => {
    if ((choice === 'zh') === isZhPath) return;
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* storage can be unavailable in private modes */
    }
  };

  document.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (!target.closest('starlight-lang-select')) return;
      remember(target.value.includes('/zh-cn/') ? 'zh' : 'en');
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('[data-language-choice]');
      if (!link) return;
      const choice = link.getAttribute('data-language-choice');
      if (choice !== 'zh' && choice !== 'en') return;
      remember(choice);
    },
    true,
  );

  // An explicit /zh-cn/ URL always wins; only bare (unprefixed) URLs get negotiated.
  if (isZhPath) return;

  const browserLang = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase();
  const wantsZh = preferred ? preferred === 'zh' : browserLang.startsWith('zh');

  if (!wantsZh) return;

  const nextRest = rest ? `zh-cn/${rest}` : 'zh-cn/';
  window.location.replace(`${base}${nextRest}${window.location.search}${window.location.hash}`);
})();
