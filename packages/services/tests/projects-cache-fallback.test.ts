/**
 * 回归：DB 缓存先于项目文件建立（空缓存）时，listProjects 不得遮蔽磁盘真源。
 * 场景来自 vscode 集成测试：扩展激活期 warmDb() 建库，fixture 项目在之后才落盘。
 * DB 只是缓存，读路径应在缓存为空时回退磁盘扫描（见 projects.ts 注释）。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, test } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'lattice-projects-cache-'));
process.env.LATTICE_HOME = home;

const core = await import('@qcqx/lattice-core');
const lattice = await import('../src/index');

afterAll(() => {
  core.closeDb();
  core.setLatticeRootOverride(null);
  rmSync(home, { recursive: true, force: true });
});

test('空 DB 缓存不遮蔽磁盘项目（建库早于项目写入）', async () => {
  // 建库时数据根还没有用户/项目 → projects 表为空
  await core.initDb();
  assert.equal(core.listAllProjects('t').length, 0);

  // 项目文件随后落盘（模拟扩展激活后 fixture 写入）
  mkdirSync(join(home, 'config'), { recursive: true });
  writeFileSync(join(home, 'config', 'config-local.json'), JSON.stringify({ username: 't' }));
  const projectDir = join(home, 'users', 't', 'projects', 'fixture-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'project.json'),
    JSON.stringify({
      id: 'fixture-project',
      ids: ['fixture-project'],
      name: 'Fixture Project',
      localPaths: [],
      gitRemotes: [],
      packageNames: [],
      created: '2026-01-01T00:00:00.000Z',
      updated: null,
    }),
  );

  const projects = await lattice.listProjects('t');
  assert.equal(projects.length, 1);
  // 不断言 id 形态：两条路径（DB 虚拟合并 / 磁盘扫描）都经 normalizeProjectMeta，
  // 无前缀 id 会归一化为 legacy: 前缀；这里只关心「磁盘真源没被空缓存遮掉」。
  assert.equal(projects[0].name, 'Fixture Project');
  assert.ok((projects[0].ids ?? []).some((id) => id.endsWith('fixture-project')));
});
