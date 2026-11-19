import configuration from './installation-channels.json' with { type: 'json' };

export const startMarker = '<!-- lattice-install:start -->';
export const endMarker = '<!-- lattice-install:end -->';
export const releasesUrl = 'https://github.com/qxchuckle/lattice/releases';
export const installDocuments = ['docs/quick-start.md', 'docs/quick-start.zh-CN.md'];
const labels = { brew: 'Homebrew', npm: 'npm', curl: 'curl' };
export function validateChannels(config) {
  if (config.defaultMethod !== 'brew')
    throw new Error('[install:I1] Homebrew must be the default Markdown section');
  if (
    !Array.isArray(config.channels) ||
    config.channels.length !== Object.keys(labels).length ||
    new Set(config.channels.map((c) => c.id)).size !== config.channels.length ||
    config.channels.some((c) => !labels[c.id] || typeof c.available !== 'boolean') ||
    config.channels[0].id !== 'brew'
  )
    throw new Error('[install:I3] Invalid channel catalog');
  if (!config.channels.find((c) => c.id === 'npm').available)
    throw new Error('[install:I3] npm fallback must be available');
  const brew = config.channels.find((c) => c.id === 'brew');
  if (brew.available && !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(brew.tap || ''))
    throw new Error('[install:I4] Homebrew requires a valid tap');
  return config;
}
export const installation = validateChannels(configuration);
export function methods(locale = 'en', config = installation) {
  validateChannels(config);
  const zh = locale.startsWith('zh');
  return config.channels.map((channel) => {
    let command = null;
    let note;
    if (!channel.available) {
      note = zh ? '当前可用 npm 安装。' : 'Use npm to install the current release.';
    } else if (channel.id === 'brew') {
      command = `brew install ${channel.tap}/lattice`;
      note = zh ? 'macOS / Linux · 自带运行时' : 'macOS / Linux · Runtime included';
    } else if (channel.id === 'npm') {
      command = 'npm install -g @qcqx/lattice-cli';
      note = zh
        ? '需要 Node.js 14.14+。请保留 npm 可选依赖。'
        : 'Requires Node.js 14.14+. Keep npm optional dependencies enabled.';
    } else {
      command = [
        '(',
        '  set -e',
        '  installer=$(mktemp)',
        '  trap \'rm -f "$installer"\' 0',
        `  curl -fsSL ${releasesUrl}/latest/download/install.sh -o "$installer"`,
        '  sh "$installer"',
        ')',
      ].join('\n');
      note = zh
        ? 'macOS / Linux · 自带运行时。将 ~/.local/bin 加入 PATH。'
        : 'macOS / Linux · Runtime included. Add ~/.local/bin to PATH.';
    }
    return {
      id: channel.id,
      label: labels[channel.id],
      available: channel.available,
      command,
      note,
    };
  });
}

function aiInstall(zh) {
  const guide = `https://raw.githubusercontent.com/qxchuckle/lattice/master/docs/quick-start${zh ? '.zh-CN' : ''}.md`;
  return {
    id: 'ai',
    label: zh ? 'AI 安装' : 'AI setup',
    available: true,
    prompt: zh
      ? `读取下方文档的「1. 安装」，选适合当前系统的 Homebrew、npm 或 curl 命令安装 Lattice CLI。运行 ltc --version 验证。\n${guide}`
      : `Read “1. Install” below. Use the Homebrew, npm, or curl command that suits this system to install Lattice CLI. Verify with ltc --version.\n${guide}`,
  };
}

const escape = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export function renderInstallTabs(id, locale = 'en', config = installation) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('[install:I6] Invalid component id');
  const zh = locale.startsWith('zh');
  const channels = [aiInstall(zh), ...methods(locale, config)];
  const defaultMethod = channels[0].id;
  const tabs = channels
    .map(
      (m) =>
        `<button type="button" role="tab" id="${id}-tab-${m.id}" aria-controls="${id}-panel-${m.id}" aria-selected="${m.id === defaultMethod}" tabindex="${m.id === defaultMethod ? 0 : -1}" data-install-method="${m.id}">${m.label}</button>`,
    )
    .join('');
  const panels = channels
    .map((method) => {
      const heading = method.available
        ? `<p class="ll-install-channel ll-install-channel--available"><strong>${method.label}</strong></p>`
        : `<p class="ll-install-channel"><strong>${method.label}</strong><span class="ll-install-pending">${zh ? '即将提供' : 'Coming soon'}</span></p>`;
      const copy = method.prompt ? (zh ? '复制提示词' : 'Copy prompt') : zh ? '复制' : 'Copy';
      const copyButton = `<button type="button" class="ll-copy" data-install-copy hidden>${copy}</button>`;
      const action = method.prompt
        ? `<div class="ll-install-prompt"><p data-install-text>${escape(method.prompt)}</p>${copyButton}</div>`
        : method.command
          ? `<div class="ll-install"><span aria-hidden="true">$</span><code data-install-text data-install-command>${escape(method.command)}</code>${copyButton}</div>`
          : `<button type="button" class="ll-install-alternative" data-install-switch="npm" hidden>${zh ? '查看 npm 安装' : 'View npm installation'} →</button>`;
      const note = method.note ? `<p class="ll-install-note">${escape(method.note)}</p>` : '';
      return `<section id="${id}-panel-${method.id}" aria-labelledby="${id}-tab-${method.id}" data-install-panel="${method.id}">${heading}${action}${note}</section>`;
    })
    .join('');
  return `<lattice-install-tabs class="ll-install-tabs not-content" data-default-method="${defaultMethod}" data-locale="${zh ? 'zh' : 'en'}"><div class="ll-install-tablist" role="tablist" aria-label="${zh ? '安装方式' : 'Installation method'}" hidden>${tabs}</div>${panels}<span class="ll-install-feedback" role="status" aria-live="polite"></span></lattice-install-tabs>`;
}
export function renderInstallMarkdown(locale = 'en', config = installation) {
  const zh = locale.startsWith('zh');
  return [...methods(locale, config), aiInstall(zh)]
    .map((method) => {
      const summary =
        method.label + (!method.available ? (zh ? ' · 即将提供' : ' · Coming soon') : '');
      const text = method.prompt
        ? '```text\n' + method.prompt + '\n```'
        : method.command
          ? '```bash\n' + method.command + '\n```\n\n' + method.note
          : method.note;
      return `<details${method.id === config.defaultMethod ? ' open' : ''}>\n<summary>${summary}</summary>\n\n${text}\n\n</details>`;
    })
    .join('\n\n');
}
export function replaceInstallBlock(
  text,
  locale,
  { html = false, id = 'docs-install', config = installation } = {},
) {
  const starts = text.split(startMarker).length - 1;
  const ends = text.split(endMarker).length - 1;
  if (starts !== 1 || ends !== 1 || text.indexOf(endMarker) < text.indexOf(startMarker))
    throw new Error('[install:I7] Expected exactly one ordered installation block');
  const begin = text.indexOf(startMarker);
  const end = text.indexOf(endMarker) + endMarker.length;
  const content = html
    ? `<div class="ll-install-docs">\n${renderInstallTabs(id, locale, config)}\n</div>`
    : `${startMarker}\n\n${renderInstallMarkdown(locale, config)}\n\n${endMarker}`;
  return text.slice(0, begin) + content + text.slice(end);
}
