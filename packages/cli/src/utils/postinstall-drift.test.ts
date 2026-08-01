/**
 * 防漂移测试：postinstall.mjs 的 latticeRoot 路径逻辑必须与 core getLatticeRoot() 一致
 *
 * postinstall.mjs 是零依赖 ESM 脚本（安装时 dist 尚未构建，不能 import core），
 * 故 latticeRoot 逻辑在 postinstall 内是 core getLatticeRoot() 的副本。
 * 此测试断言两者保持同步——若 core 改了根路径，此测试会失败提醒同步更新 postinstall。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLatticeRoot } from '@qcqx/lattice-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const postinstallPath = join(__dirname, '..', '..', 'scripts', 'postinstall.mjs');
const source = readFileSync(postinstallPath, 'utf-8');

describe('postinstall.mjs 防漂移：latticeRoot 与 core getLatticeRoot() 一致', () => {
  it('postinstall 使用 LATTICE_HOME 环境变量覆盖（与 core 同源逻辑）', () => {
    expect(source).toContain('LATTICE_HOME');
  });

  it('postinstall 回退到 ~/.lattice（与 core getLatticeRoot() 默认值一致）', () => {
    expect(source).toContain("'.lattice'");
    expect(source).toContain('homedir');
  });

  it('core getLatticeRoot() 默认值为 ~/.lattice（postinstall 副本的真源）', () => {
    // 删除 LATTICE_HOME 确保取默认值
    const saved = process.env.LATTICE_HOME;
    delete process.env.LATTICE_HOME;
    const root = getLatticeRoot();
    process.env.LATTICE_HOME = saved;
    expect(root).toContain('.lattice');
  });

  it('postinstall 注释指向 core 为单一真相源', () => {
    expect(source).toContain('getLatticeRoot');
    expect(source).toContain('防漂移');
  });
});
