/**
 * 选择器修饰键映射（纯逻辑，供单测）：
 * 与 package.json 的 keybindings（`lattice.picker.*`）保持一致；
 * 仅用于 UI 提示文案生成（提示不触发行为，行为由快捷键绑定负责）。
 */

export interface PickerActionKeys {
  copyId: string;
  openGraph: string;
  reveal: string;
}

export function pickerActionKeys(platform: NodeJS.Platform = process.platform): PickerActionKeys {
  if (platform === 'darwin') {
    return { copyId: 'cmd+enter', openGraph: 'alt+enter', reveal: 'ctrl+enter' };
  }
  return { copyId: 'ctrl+enter', openGraph: 'alt+enter', reveal: 'ctrl+shift+enter' };
}

/** 按键 → 展示串（darwin 用 ⌘⌥⌃↵ 风格；其他平台用 Ctrl+Enter 风格）。 */
function formatKey(key: string, platform: NodeJS.Platform): string {
  const parts = key.split('+');
  const name = (part: string): string => {
    switch (part) {
      case 'cmd':
        return platform === 'darwin' ? '⌘' : 'Meta';
      case 'ctrl':
        return platform === 'darwin' ? '⌃' : 'Ctrl';
      case 'alt':
        return platform === 'darwin' ? '⌥' : 'Alt';
      case 'shift':
        return platform === 'darwin' ? '⇧' : 'Shift';
      default:
        return platform === 'darwin' ? '↵' : 'Enter';
    }
  };
  const names = parts.map(name);
  return platform === 'darwin' ? names.join('') : names.join('+');
}

/** 选择器底部提示行（本地化动作名由调用方注入）。 */
export function formatPickerHint(
  keys: PickerActionKeys,
  labels: { copyId: string; openGraph: string; reveal: string },
  platform: NodeJS.Platform = process.platform,
): string {
  return [
    `${formatKey(keys.copyId, platform)} ${labels.copyId}`,
    `${formatKey(keys.openGraph, platform)} ${labels.openGraph}`,
    `${formatKey(keys.reveal, platform)} ${labels.reveal}`,
  ].join(' · ');
}
