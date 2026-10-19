import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  PROJECT_ICON_COLORS,
  projectIconColor,
  projectIconColorIndex,
} from '../../src/views/project-icon';

test('颜色映射：稳定哈希（同 ID 恒定）+ 回归向量', () => {
  assert.equal(projectIconColor('@qcqx/lattice-monorepo'), 'charts.purple');
  assert.equal(projectIconColor('@hbos/hbos-base'), 'charts.blue');
  assert.equal(projectIconColor('@cffe/fe-plugin-nlm'), 'charts.yellow');
  assert.equal(projectIconColor('fixture-project'), 'charts.orange');
  // 重复调用恒定（非随机）
  assert.equal(
    projectIconColor('@qcqx/lattice-monorepo'),
    projectIconColor('@qcqx/lattice-monorepo'),
  );
});

test('颜色映射：索引范围与色板成员；空 ID / 非 ASCII 安全', () => {
  for (const id of ['', 'a', '项目', 'legacy:xxxxxxxxxxxxxxxx', '@scope/名称-带中文']) {
    const index = projectIconColorIndex(id);
    assert.ok(index >= 0 && index < PROJECT_ICON_COLORS.length);
    assert.ok((PROJECT_ICON_COLORS as readonly string[]).includes(projectIconColor(id)));
  }
});

test('颜色映射：样本 ID 颜色分散（≥4 种），避免肉眼难以区分', () => {
  const ids = Array.from({ length: 24 }, (_, i) => `legacy:project-${i}`);
  const colors = new Set(ids.map((id) => projectIconColor(id)));
  assert.ok(colors.size >= 4, `distinct colors: ${colors.size}`);
});
