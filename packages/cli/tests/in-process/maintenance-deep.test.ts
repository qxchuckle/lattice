import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getAIToolConfigs,
  getGlobalSpecDir,
  getProjectSpecDir,
  getUserSpecDir,
  initDb,
  injectToToolRoot,
  updateTask,
} from '@qcqx/lattice-core';
import { registerScanCommand } from '../../src/commands/scan';
import { registerUninjectCommand } from '../../src/commands/uninject';
import { registerExportCommand } from '../../src/commands/export';
import {
  createCliEnv,
  runCli,
  seedProject,
  seedTask,
  parseCliJson,
  putFile,
  ID_A,
  U,
  type CliEnv,
  type CliRunResult,
} from './helpers';

const prompts = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('@inquirer/prompts', () => ({ confirm: prompts.confirm }));

let env: CliEnv;
let fakeHome: string | undefined;
const originalHome = process.env.HOME;

beforeEach(async () => {
  env = await createCliEnv();
  prompts.confirm.mockReset().mockResolvedValue(false);
});

afterEach(async () => {
  if (fakeHome) {
    process.env.HOME = originalHome;
    await rm(fakeHome, { recursive: true, force: true });
    fakeHome = undefined;
  }
  await env.cleanup();
});

const runScan = (args: string[]): Promise<CliRunResult> => runCli(registerScanCommand, args);
const runUninject = (args: string[]): Promise<CliRunResult> =>
  runCli(registerUninjectCommand, args);
const runExport = (args: string[]): Promise<CliRunResult> => runCli(registerExportCommand, args);

async function initGitRepo(name: string, parent?: string): Promise<string> {
  const dir = join(parent ?? env.tmpRoot, name);
  await mkdir(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  await writeFile(join(dir, 'unique.txt'), `${name}-${Date.now()}-${Math.random()}`);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', [
    '-C',
    dir,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '-m',
    `scan-${name}-${Date.now()}`,
  ]);
  return dir;
}

test('scan：多目录/重复扫描更新/配置目录/无目录提示/嵌套向上注册', async () => {
  const repoA = await initGitRepo('scan-a');
  const repoB = await initGitRepo('scan-b');
  const first = await runScan(['scan', '--dirs', `${repoA}, ${repoB}`]);
  assert.equal(first.exitCode, 0, `${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /正在扫描 2 个目录/);
  assert.match(first.stdout, /✓ 扫描完成/);
  assert.match(first.stdout, /更新：2 个项目/, JSON.stringify(first));

  const again = await runScan(['scan', '--dirs', repoA]);
  assert.equal(again.exitCode, 0, again.stderr);
  assert.match(again.stdout, /新增：0 个项目/);

  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, scanDirs: [repoB] }),
  );
  const fromConfig = await runScan(['scan']);
  assert.equal(fromConfig.exitCode, 0, fromConfig.stderr);
  assert.match(fromConfig.stdout, new RegExp(repoB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
  );
  const none = await runScan(['scan']);
  assert.match(none.stdout, /未指定扫描目录/);

  // 嵌套仓库：scan 前先向上注册父/子
  const parent = await initGitRepo('scan-parent');
  const child = await initGitRepo('scan-child', parent);
  const nested = await runScan(['scan', '--dirs', child]);
  assert.equal(nested.exitCode, 0, nested.stderr);
  assert.match(nested.stdout, /扫描完成/);
});

test('uninject：未知平台/dry-run/确认取消/指定平台清除/无残留', async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'lattice-uninject-home-'));
  process.env.HOME = fakeHome;
  const tools = getAIToolConfigs(fakeHome);
  assert.ok(tools.length >= 2);
  const [toolA, toolB] = tools;
  await mkdir(toolA.detectPath, { recursive: true });
  await mkdir(toolB.detectPath, { recursive: true });
  await injectToToolRoot(toolA, toolA.detectPath);
  await injectToToolRoot(toolB, toolB.detectPath);

  const unknown = await runUninject(['uninject', '--tool', 'no-such-tool']);
  assert.equal(unknown.exitCode, 1);
  assert.match(unknown.stdout, /未知平台 id/);
  assert.match(unknown.stdout, /可选：/);

  const dry = await runUninject(['uninject', '--dry-run']);
  assert.equal(dry.exitCode, 0, dry.stderr);
  assert.match(dry.stdout, /将清除以下内容/);
  assert.match(dry.stdout, /--dry-run：仅报告/);
  assert.match(dry.stdout, new RegExp(toolA.name));

  prompts.confirm.mockResolvedValueOnce(false);
  const cancelled = await runUninject(['uninject']);
  assert.match(cancelled.stdout, /已取消/);

  const selected = await runUninject(['uninject', '--tool', toolA.id, '-f']);
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.match(selected.stdout, /清除完成：删除/);
  assert.match(selected.stdout, /~\/.lattice 数据未改动/);

  const remaining = await runUninject(['uninject', '--tool', toolA.id, '--dry-run']);
  assert.match(remaining.stdout, /未发现 lattice 注入残留/);

  const all = await runUninject(['uninject', '-f']);
  assert.equal(all.exitCode, 0, all.stderr);
  assert.match(all.stdout, /清除完成|未发现/);
});

async function seedExportData() {
  await putFile(
    join(getGlobalSpecDir(), 'export-global.md'),
    '---\nid: spec-expg001\ntitle: 导出全局规范\ntags: [shared]\ndescription: 全局导出摘要\n---\n\n# 全局\n',
  );
  await putFile(
    join(getUserSpecDir(U), 'export-user.md'),
    '---\nid: spec-expu001\ntitle: 导出用户规范\ntags: [user]\ndescription: 用户导出摘要\n---\n\n# 用户\n',
  );
  await putFile(
    join(getUserSpecDir(U), 'export-no-desc.md'),
    '---\nid: spec-expn001\ntitle: 无摘要导出规范\n---\n\n# 无摘要\n',
  );
  await putFile(
    join(getProjectSpecDir(U, ID_A), 'export-project.md'),
    '---\nid: spec-expp001\ntitle: 导出项目规范\n---\n\n# 项目（无 description）\n',
  );
  const task = await seedTask('导出任务', [ID_A]);
  await initDb();
  await updateTask(U, task.id, { status: 'in_progress' });
  const archived = await seedTask('归档导出任务');
  await initDb();
  await updateTask(U, archived.id, { status: 'archived' });
  return { task, archived };
}

test('export：dry-run/实际导出/verify/大过滤组合/prune/互斥/空类型/缺描述', async () => {
  const { task } = await seedExportData();
  const out = join(env.tmpRoot, 'export-out');

  const dry = await runExport(['export', '--dry-run', '--json']);
  assert.equal(dry.exitCode, 0, dry.stderr);
  const dryResult = parseCliJson(dry) as { dryRun: boolean; stats: { exportedSpecs: number } };
  assert.equal(dryResult.dryRun, true);
  assert.ok(dryResult.stats.exportedSpecs >= 3, JSON.stringify(dryResult));

  const actual = await runExport([
    'export',
    '--output',
    out,
    '--name',
    'deep-export',
    '--description',
    '深水导出',
    '--json',
  ]);
  assert.equal(actual.exitCode, 0, `${actual.stdout}\n${actual.stderr}`);
  const actualResult = parseCliJson(actual) as {
    outputDir: string;
    written: string[];
    stats: { exportedTasks: number };
  };
  assert.equal(actualResult.outputDir, out);
  assert.ok(actualResult.written.length > 0);
  assert.match(await readFile(join(out, 'SKILL.md'), 'utf-8'), /deep-export|深水导出/);

  const verify = await runExport(['export', '--verify', out, '--json']);
  assert.equal(verify.exitCode, 0, verify.stderr);
  assert.equal((parseCliJson(verify) as { ok: boolean }).ok, true);
  await writeFile(join(out, 'SKILL.md'), 'tampered', 'utf-8');
  const verifyBad = await runExport(['export', '--verify', out, '--json']);
  assert.equal((parseCliJson(verifyBad) as { ok: boolean }).ok, false);
  const verifyHuman = await runExport(['export', '--verify', out]);
  assert.match(verifyHuman.stdout, /问题/);
  const verifyMissing = await runExport([
    'export',
    '--verify',
    join(env.tmpRoot, 'missing-export'),
  ]);
  assert.equal(verifyMissing.exitCode, 1);

  const filtered = await runExport([
    'export',
    '--dry-run',
    '--json',
    '--only',
    'spec,task',
    '--scope',
    'global,user,project',
    '--spec',
    'spec-expg',
    '--exclude-spec',
    'spec-expp',
    '--tag',
    'shared,user',
    '--exclude-tag',
    'nope',
    '--task',
    task.id.slice(0, 8),
    '--exclude-task',
    'never',
    '--task-status',
    'all',
    '--task-since',
    '2020-01-01',
    '--task-until',
    '2030-01-01',
    '--task-depth',
    'full',
    '--user',
    U,
    '--exclude-user',
    'nobody',
    '--exclude-project',
    'none',
    '--filter',
    '导出',
    '--exclude-filter',
    'zzq',
  ]);
  assert.equal(filtered.exitCode, 0, `${filtered.stdout}\n${filtered.stderr}`);
  assert.equal((parseCliJson(filtered) as { dryRun: boolean }).dryRun, true);

  const human = await runExport([
    'export',
    '--dry-run',
    '--output',
    out,
    '--exclude-project',
    'none',
  ]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /\[dry-run\] 将导出/);
  assert.match(human.stdout, /分区：/);
  assert.match(human.stdout, /缺 description/);
  assert.match(human.stdout, /项目过滤命中/);

  const mutuallyExclusive = await runExport(['export', '--clean', '--overwrite', '--json']);
  assert.equal(mutuallyExclusive.exitCode, 1);

  // prune：先实际导出，再删除一个 spec 后重导 --prune
  const pruneOut = join(env.tmpRoot, 'export-prune');
  const first = await runExport(['export', '--output', pruneOut, '--json']);
  assert.equal(first.exitCode, 0, first.stderr);
  await rm(join(getUserSpecDir(U), 'export-user.md'));
  const pruned = await runExport(['export', '--output', pruneOut, '--prune', '--json']);
  assert.equal(pruned.exitCode, 0, `${pruned.stdout}\n${pruned.stderr}`);
  assert.ok((parseCliJson(pruned) as { deleted: string[] }).deleted.length >= 1);

  // clean / overwrite 成功路径
  const cleanOut = join(env.tmpRoot, 'export-clean');
  const cleaned = await runExport(['export', '--output', cleanOut, '--clean', '--json']);
  assert.equal(cleaned.exitCode, 0, cleaned.stderr);
  const overwritten = await runExport(['export', '--output', cleanOut, '--overwrite', '--json']);
  assert.equal(overwritten.exitCode, 0, overwritten.stderr);

  // strict + 警告（重复 spec id 或无 scope 警告）
  await putFile(
    join(getUserSpecDir(U), 'dup-a.md'),
    '---\nid: spec-dup-exp1\ntitle: 重复 A\ndescription: x\n---\n\nbody',
  );
  await putFile(
    join(getUserSpecDir(U), 'dup-b.md'),
    '---\nid: spec-dup-exp1\ntitle: 重复 B\ndescription: y\n---\n\nbody',
  );
  const strict = await runExport(['export', '--dry-run', '--strict', '--json']);
  assert.ok([0, 1].includes(strict.exitCode), strict.stderr);
});
