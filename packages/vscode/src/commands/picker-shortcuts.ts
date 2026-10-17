import { RegisterFn } from './shared';
import { performPickerAction } from '../pickers/enhanced';

/** 选择器修饰键命令（快捷键绑定见 package.json；仅 `lattice.pickerActive` 时生效）。 */
export function registerPickerShortcutCommands(register: RegisterFn): void {
  register('lattice.picker.copyId', () => performPickerAction('copyId'));
  register('lattice.picker.openGraph', () => performPickerAction('openGraph'));
  register('lattice.picker.reveal', () => performPickerAction('reveal'));
}
