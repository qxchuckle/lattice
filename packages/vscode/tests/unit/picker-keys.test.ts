import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPickerHint, pickerActionKeys } from '../../src/pickers/keys';

test('键映射：mac 用 ⌘/⌥/⌃+↵，其他平台 Ctrl/Alt（reveal 避开冲突）', () => {
  assert.deepEqual(pickerActionKeys('darwin'), {
    copyId: 'cmd+enter',
    openGraph: 'alt+enter',
    reveal: 'ctrl+enter',
  });
  assert.deepEqual(pickerActionKeys('win32'), {
    copyId: 'ctrl+enter',
    openGraph: 'alt+enter',
    reveal: 'ctrl+shift+enter',
  });
});

test('提示串：mac 图标风格 / 其他平台文本风格', () => {
  const labels = { copyId: '复制 ID', openGraph: '在图谱中查看', reveal: '在侧栏定位' };
  assert.equal(
    formatPickerHint(pickerActionKeys('darwin'), labels, 'darwin'),
    '⌘↵ 复制 ID · ⌥↵ 在图谱中查看 · ⌃↵ 在侧栏定位',
  );
  assert.equal(
    formatPickerHint(pickerActionKeys('win32'), labels, 'win32'),
    'Ctrl+Enter 复制 ID · Alt+Enter 在图谱中查看 · Ctrl+Shift+Enter 在侧栏定位',
  );
});
