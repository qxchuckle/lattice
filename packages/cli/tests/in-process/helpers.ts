import { Command } from 'commander';
import { vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, closeDb, registerProjectWithIds, createTask } from '@qcqx/lattice-core';
import { applyLeafOptions, setMachineMode } from '../../src/utils';

/**
 * CLI 进程内测试 harness（P2/D1-A）：
 * - 真实执行命令装配层（register* + parseAsync），计入 v8 覆盖率；
 * - 环境隔离：临时 LATTICE_HOME + 临时用户，绝不动真实 ~/.lattice；
 * - 硬离线：rag.embedding.allowRemoteModels=false，语义检索快速降级；
 * - 输出捕获：commands 统一走 logger → console.log/error，spy 汇总后剥 ANSI。
 */

export const U = 't';
export const ID_A = 'legacy:aaaabbbbccccdddd';
export const ID_B = 'legacy:ffff000011112222';
export const DERIVED = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

const ANSI = /\u001b\[[0-9;]*m/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, '');

export interface CliEnv {
  tmpRoot: string;
  latticeHome: string;
  cleanup(): Promise<void>;
}

export async function createCliEnv(): Promise<CliEnv> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'lattice-cli-inproc-'));
  const latticeHome = join(tmpRoot, 'lattice');
  await mkdir(join(latticeHome, 'config'), { recursive: true });
  await writeFile(
    join(latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
    'utf-8',
  );
  await writeFile(
    join(latticeHome, 'config', 'config.json'),
    JSON.stringify({ rag: { embedding: { allowRemoteModels: false } } }),
    'utf-8',
  );
  process.env.LATTICE_HOME = latticeHome;
  await initDb();
  return {
    tmpRoot,
    latticeHome,
    async cleanup() {
      closeDb();
      delete process.env.LATTICE_HOME;
      await rm(tmpRoot, { recursive: true, force: true });
    },
  };
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error: unknown;
}

function applyExitOverride(cmd: Command): void {
  cmd.exitOverride();
  for (const sub of cmd.commands) applyExitOverride(sub);
}

/**
 * 在进程内执行一条 CLI 命令。
 *
 * @param register 命令注册函数（如 registerTaskCommand）
 * @param args     不含程序名的参数（如 ['task','list','--json']）
 */
export async function runCli(
  register: (program: Command) => void,
  args: string[],
): Promise<CliRunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.map((v) => String(v)).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    err.push(a.map((v) => String(v)).join(' '));
  });
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;

  const program = new Command();
  program.name('lattice');
  register(program);
  applyLeafOptions(program);
  // 对齐 index.ts preAction 的两项关键行为（自检/注入告警等 host 环境动作不在测试内复现）：
  // 1) --json-full 隐含 --json；2) machine 模式（--json / -q）开关
  program.hook('preAction', (_thisCommand, actionCommand) => {
    const opts = actionCommand.opts();
    if (opts.jsonFull && !opts.json) actionCommand.setOptionValue('json', true);
    const latest = actionCommand.opts();
    setMachineMode(Boolean(latest.json || latest.quiet));
  });
  applyExitOverride(program);

  let error: unknown = null;
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (e) {
    error = e;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    setMachineMode(false);
  }

  const commanderExitCode = (error as { exitCode?: number } | null)?.exitCode;
  const exitCode = commanderExitCode ?? process.exitCode ?? 0;
  process.exitCode = prevExitCode;
  return { stdout: stripAnsi(out.join('\n')), stderr: stripAnsi(err.join('\n')), exitCode, error };
}

/** 造一个已注册项目（临时目录 + db 记录） */
export async function seedProject(
  env: CliEnv,
  opts: { ids?: string[]; dirName?: string; withGit?: boolean } = {},
) {
  const ids = opts.ids ?? [ID_A];
  const dirName = opts.dirName ?? 'projA';
  const dir = join(env.tmpRoot, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.keep'), '');
  return registerProjectWithIds(U, ids, dir, DERIVED);
}

/** 造一个任务（db 记录，可选关联项目） */
export async function seedTask(title: string, projects: string[] = []) {
  return createTask(U, title, projects.length > 0 ? { projects } : {});
}

/** 便捷写文件（自动建父目录） */
export async function putFile(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

/** 解析 CLI JSON 输出（{cols,rows} 或普通对象），失败时给出原始输出便于定位 */
export function parseCliJson(result: CliRunResult): unknown {
  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(
      `CLI stdout 不是合法 JSON（exit=${result.exitCode}）：\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      { cause: e },
    );
  }
}
