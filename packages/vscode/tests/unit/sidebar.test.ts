import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  activationEvents: string[];
  contributes: {
    views: {
      lattice: Array<{ id: string; name: string; visibility?: string }>;
    };
    menus: {
      'view/title': Array<{ command: string; when?: string }>;
    };
  };
};

test('配置与维护侧栏视图已注册且可激活', () => {
  const view = packageJson.contributes.views.lattice.find(
    (candidate) => candidate.id === 'lattice.controlCenter',
  );
  assert.ok(view, 'missing lattice.controlCenter view');
  assert.equal(view.name, '%lattice.view.controlCenter.name%');
  assert.equal(view.visibility, 'visible');
  assert.ok(
    packageJson.activationEvents.includes('onView:lattice.controlCenter'),
    'control center view should activate the extension explicitly',
  );
});

test('配置与维护标题栏动作覆盖配置中心 / 扫描 / 注册 / 原生设置', () => {
  const entries = packageJson.contributes.menus['view/title'].filter(
    (entry) => entry.when === 'view == lattice.controlCenter',
  );
  const commands = new Set(entries.map((entry) => entry.command));
  for (const command of [
    'lattice.config.open',
    'lattice.workspace.scan',
    'lattice.workspace.link',
    'lattice.config.openSettings',
  ]) {
    assert.ok(commands.has(command), `missing control-center title action: ${command}`);
  }
});

test('配置与维护视图名称有中英文案', () => {
  for (const file of ['package.nls.json', 'package.nls.zh-cn.json']) {
    const nls = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as Record<string, string>;
    assert.ok(nls['lattice.view.controlCenter.name'], `${file} missing control-center view name`);
  }
});
