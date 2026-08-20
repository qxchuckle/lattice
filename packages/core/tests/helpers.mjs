import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 测试隔离基建（红线：绝不动本机真实 ~/.lattice）。
 *
 * 所有涉及 LATTICE_HOME 的测试必须先 createTempLatticeHome()，
 * 拿到的环境保证位于 os.tmpdir() 下；assertIsolatedLatticeHome 在
 * 任何写操作前再校验一次，防 LATTICE_HOME 被意外清空回落真实 home。
 */

export function assertIsolatedLatticeHome() {
  const home = process.env.LATTICE_HOME;
  if (!home || home.trim() === '') {
    throw new Error('LATTICE_HOME 未设置：测试必须显式指向临时目录');
  }
  const tmp = tmpdir();
  if (!home.startsWith(tmp)) {
    throw new Error(`LATTICE_HOME 必须位于 ${tmp} 下，当前：${home}`);
  }
  if (home === join(process.env.HOME ?? '', '.lattice')) {
    throw new Error('LATTICE_HOME 指向了真实 ~/.lattice，测试中止');
  }
}

/** 创建一次性隔离 Lattice 环境并注入 process.env.LATTICE_HOME */
export async function createTempLatticeHome() {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'lattice-test-'));
  const latticeHome = join(tmpRoot, 'lattice');
  await mkdir(latticeHome, { recursive: true });
  process.env.LATTICE_HOME = latticeHome;
  assertIsolatedLatticeHome();
  return {
    tmpRoot,
    latticeHome,
    async cleanup() {
      delete process.env.LATTICE_HOME;
      await rm(tmpRoot, { recursive: true, force: true });
    },
  };
}

/** 在指定目录造一个真实 git 仓库（含首次 commit），返回 firstCommitSHA */
export async function createFakeProject(dir, { remote } = {}) {
  const { execFileSync } = await import('node:child_process');
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
  await mkdir(dir, { recursive: true });
  git(['init', '-q', '-b', 'main']);
  git([
    '-c',
    'user.name=tester',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  ]);
  if (remote) git(['remote', 'add', 'origin', remote]);
  return git(['rev-list', '--max-parents=0', 'HEAD']).trim();
}

/** 造一个本地 bare 仓当远端（禁网络的域远端替身），返回其路径（不自动清理，调用方管理） */
export async function createBareRemote(name = 'remote') {
  const { execFileSync } = await import('node:child_process');
  const tmpRoot = await mkdtemp(join(tmpdir(), `lattice-${name}-`));
  const barePath = join(tmpRoot, 'bare.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', barePath]);
  return { tmpRoot, barePath };
}

/** 便捷写文本 */
export async function putFile(filePath, content) {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}
