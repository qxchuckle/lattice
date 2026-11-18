import configuration from './installation-channels.json' with { type: 'json' };

export const startMarker = '<!-- lattice-install:start -->';
export const endMarker = '<!-- lattice-install:end -->';
export const releasesUrl = 'https://github.com/qxchuckle/lattice/releases';
export const installDocuments = [
  'README.md',
  'README.zh-CN.md',
  'packages/cli/README.md',
  'packages/cli/README.zh-CN.md',
  'docs/quick-start.md',
  'docs/quick-start.zh-CN.md',
];
const labels = { brew: 'Homebrew', npm: 'npm', curl: 'curl' };
export function validateChannels(config) {
  if (config.defaultMethod !== 'brew') throw new Error('[install:I1] Homebrew must be the default');
  if (
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(config.publishedVersion) ||
    !['host', 'bundled'].includes(config.npmRuntime)
  )
    throw new Error('[install:I2] Invalid public release metadata');
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
  if (
    brew.available &&
    (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(brew.tap || '') || config.npmRuntime !== 'bundled')
  )
    throw new Error('[install:I4] Released Homebrew requires a real tap and platform release');
  if (config.channels.find((c) => c.id === 'curl').available && config.npmRuntime !== 'bundled')
    throw new Error('[install:I5] Standalone assets require the platform release');
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
      note = zh
        ? `${labels[channel.id]} 安装渠道正在准备中，当前请使用 npm。`
        : `${labels[channel.id]} installation is being prepared. Use npm for the current release.`;
    } else if (channel.id === 'brew') {
      command = `brew install ${channel.tap}/lattice`;
      note = zh
        ? 'macOS / Linux。无需单独安装 Node.js。'
        : 'macOS / Linux. No separate Node.js installation required.';
    } else if (channel.id === 'npm') {
      command = 'npm install -g @qcqx/lattice-cli';
      note =
        config.npmRuntime === 'bundled'
          ? zh
            ? 'npm 入口需要 Node.js 14.14+；平台包自带运行时和 Web 工作台。请保留 optional dependencies。'
            : 'The npm launcher requires Node.js 14.14+. The platform package includes its runtime and Web workbench. Keep optional dependencies enabled.'
          : zh
            ? `当前公开版本 v${config.publishedVersion} 需要 Node.js 18+，使用安装时的 Node 环境。切换 Node 后可能需要重装。内置 Web 工作台随下一版平台包提供。`
            : `The current public release v${config.publishedVersion} requires Node.js 18+ and uses the installation Node environment. Switching Node may require reinstalling. The bundled Web workbench ships with the upcoming platform release.`;
    } else {
      command = [
        '(',
        '  set -e',
        '  installer=$(mktemp)',
        '  trap \'rm -f "$installer"\' 0',
        `  curl -fsSL ${releasesUrl}/download/v${config.publishedVersion}/install.sh -o "$installer"`,
        `  sh "$installer" --version ${config.publishedVersion}`,
        ')',
      ].join('\n');
      note = zh
        ? 'macOS / Linux。下载后运行安装器；无需系统 Node.js。请将 ~/.local/bin 加入 PATH。'
        : 'macOS / Linux. Download and run the installer; no system Node.js required. Add ~/.local/bin to PATH.';
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
  const channels = methods(locale, config);
  const tabs = channels
    .map(
      (m) =>
        `<button type="button" role="tab" id="${id}-tab-${m.id}" aria-controls="${id}-panel-${m.id}" aria-selected="${m.id === config.defaultMethod}" tabindex="${m.id === config.defaultMethod ? 0 : -1}" data-install-method="${m.id}">${m.label}</button>`,
    )
    .join('');
  const panels = channels
    .map(
      (m) =>
        `<section id="${id}-panel-${m.id}" aria-labelledby="${id}-tab-${m.id}" data-install-panel="${m.id}"><p class="ll-install-channel"><strong>${m.label}</strong>${!m.available ? `<span class="ll-install-pending">${zh ? '即将提供' : 'Coming soon'}</span>` : ''}</p>${m.command ? `<div class="ll-install"><span aria-hidden="true">$</span><code data-install-command>${escape(m.command)}</code><button type="button" class="ll-copy" data-install-copy hidden>${zh ? '复制' : 'Copy'}</button></div>` : ''}<p class="ll-install-note">${escape(m.note)}</p>${!m.available ? `<button type="button" class="ll-install-alternative" data-install-switch="npm" hidden>${zh ? '查看 npm 安装' : 'View npm installation'} →</button>` : ''}<a class="ll-install-release" href="${releasesUrl}">${zh ? '查看发布版本' : 'View releases'} ↗</a></section>`,
    )
    .join('');
  return `<lattice-install-tabs class="ll-install-tabs not-content" data-default-method="${config.defaultMethod}" data-locale="${zh ? 'zh' : 'en'}"><div class="ll-install-tablist" role="tablist" aria-label="${zh ? '安装方式' : 'Installation method'}" hidden>${tabs}</div>${panels}<span class="ll-install-feedback" role="status" aria-live="polite"></span></lattice-install-tabs>`;
}
export function renderInstallMarkdown(locale = 'en', config = installation) {
  const zh = locale.startsWith('zh');
  return methods(locale, config)
    .map(
      (m) =>
        `<details${m.id === config.defaultMethod ? ' open' : ''}>\n<summary>${m.label}${!m.available ? ` · ${zh ? '即将提供' : 'Coming soon'}` : ''}</summary>\n\n${m.command ? '```bash\n' + m.command + '\n```\n\n' : ''}${m.note}\n\n[${zh ? '查看发布版本' : 'View releases'}](${releasesUrl})\n\n</details>`,
    )
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
