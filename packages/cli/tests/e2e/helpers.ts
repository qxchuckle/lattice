/**
 * cli E2E 测试工具
 *
 * 约定（L3）：
 * - 子进程运行构建产物 dist/index.js（先 pnpm build 再 pnpm test，测试不触发构建）
 * - 每个测试套件 mkdtemp 一次性环境：HOME 与 LATTICE_HOME 均指向临时目录，
 *   与真实 ~/.lattice 和已安装 AI 工具完全隔离
 * - init 统一带 -f --no-download-model（离线，不触碰网络）
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

export const CLI_PATH = resolve(__dirname, '../../dist/index.js');

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliEnv {
  /** 临时 HOME（同时作为 LATTICE_HOME 的父目录） */
  home: string;
  /** 即 $home/.lattice */
  latticeHome: string;
  /** 测试项目工作区目录 */
  projectsDir: string;
  run: (args: string[], opts?: { cwd?: string }) => Promise<CliResult>;
}

/** 运行 CLI 子进程（永不 throw，统一返回 exitCode 供断言） */
async function runCli(home: string, args: string[], opts?: { cwd?: string }): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      cwd: opts?.cwd ?? home,
      env: {
        ...process.env,
        HOME: home,
        LATTICE_HOME: join(home, '.lattice'),
        // 防止任何命令误入交互（inquirer 在非 TTY 下自动失败而非挂起）
        CI: 'true',
      },
      encoding: 'utf8',
      timeout: 25000,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
  }
}

/** 创建隔离环境并完成离线 init */
export async function setupCliEnv(): Promise<CliEnv> {
  const home = await mkdtemp(join(tmpdir(), 'lattice-e2e-'));
  const projectsDir = join(home, 'projects');
  await mkdir(projectsDir, { recursive: true });

  const run = (args: string[], opts?: { cwd?: string }) => runCli(home, args, opts);

  const init = await run([
    'init',
    '-f',
    '--username',
    'tester',
    '--git',
    'false',
    '--no-download-model',
  ]);
  if (init.exitCode !== 0) {
    throw new Error(`E2E 环境 init 失败：${init.stdout}\n${init.stderr}`);
  }

  // 硬离线：禁止 embedding 模型远程下载（search 首次运行会尝试拉模型，
  // 失败后自动降级到 FTS/fallback 路径，避免测试走网络/超时）
  const offline = await run([
    'config',
    'set',
    'rag.embedding.allowRemoteModels',
    'false',
    '--scope',
    'global',
  ]);
  if (offline.exitCode !== 0) {
    throw new Error(`E2E 环境离线配置失败：${offline.stdout}\n${offline.stderr}`);
  }

  return { home, latticeHome: join(home, '.lattice'), projectsDir, run };
}

/** 在测试工作区创建一个最小可注册项目（lattice.json 作为 ID 源 + package.json） */
export async function createSampleProject(env: CliEnv, name: string): Promise<string> {
  const dir = join(env.projectsDir, name);
  await mkdir(dir, { recursive: true });
  // project register 要求 ID 源（.git 或 lattice.json），离线环境用 lattice.json
  await writeFile(
    join(dir, 'lattice.json'),
    JSON.stringify({ id: randomBytes(8).toString('hex') }),
    'utf8',
  );
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }), 'utf8');
  await writeFile(join(dir, 'README.md'), `# ${name}\n`, 'utf8');
  return dir;
}
