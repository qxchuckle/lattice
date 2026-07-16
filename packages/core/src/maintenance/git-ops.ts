import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { join } from 'node:path';
import { getLatticeRoot, dirExists } from '../paths';

/** Git 操作结果 */
export interface GitOpResult {
  /** 是否成功 */
  success: boolean;
  /** 结果消息 */
  message: string;
  /** 命令输出 */
  output?: string;
}

/** Git 仓库状态 */
export interface LatticeGitStatus {
  /** Git 是否已初始化 */
  initialized: boolean;
  /** 远程仓库 URL */
  remote: string | null;
  /** 是否有未提交的变更 */
  hasChanges: boolean;
  /** 变更文件列表 */
  changedFiles: string[];
  /** 当前分支 */
  branch: string | null;
  /** 未推送的 commit 数 */
  aheadCount: number;
  /** 未拉取的 commit 数 */
  behindCount: number;
}

/** Git remote 信息 */
export interface GitRemoteInfo {
  /** remote 名称 */
  name: string;
  /** remote URL */
  url: string;
  /** fetch URL */
  fetchUrl: string;
  /** push URL */
  pushUrl: string;
}

/** 获取 git 实例（指向 ~/.lattice） */
function git(): SimpleGit {
  return simpleGit(getLatticeRoot());
}

/** 检查 ~/.lattice 是否启用了 Git 管理 */
export async function isGitInitialized(): Promise<boolean> {
  const root = getLatticeRoot();
  return dirExists(join(root, '.git'));
}

/** 获取 ~/.lattice Git 仓库状态 */
export async function getGitStatus(): Promise<LatticeGitStatus> {
  const initialized = await isGitInitialized();
  if (!initialized) {
    return {
      initialized: false,
      remote: null,
      hasChanges: false,
      changedFiles: [],
      branch: null,
      aheadCount: 0,
      behindCount: 0,
    };
  }

  const g = git();
  const status = await g.status();

  // 获取 origin remote URL
  let remote: string | null = null;
  try {
    const remotes = await g.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    remote = origin?.refs?.fetch || origin?.refs?.push || null;
  } catch {
    // no remotes
  }

  return {
    initialized: true,
    remote,
    hasChanges: status.files.length > 0,
    changedFiles: status.files.map((f) => f.path),
    branch: status.current || null,
    aheadCount: status.ahead || 0,
    behindCount: status.behind || 0,
  };
}

/** 提交所有变更 */
export async function commitAll(message?: string): Promise<GitOpResult> {
  if (!(await isGitInitialized())) {
    return { success: false, message: '~/.lattice 未启用 Git 管理' };
  }

  const g = git();
  await g.add('-A');

  const status = await g.status();
  if (status.files.length === 0) {
    return { success: true, message: '无变更需要提交' };
  }

  try {
    const commitMsg =
      message ?? `chore: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
    await g.commit(commitMsg);
    return { success: true, message: `已提交: ${commitMsg}` };
  } catch (err) {
    return { success: false, message: `提交失败: ${(err as Error).message}` };
  }
}

/** 检查是否有 remote */
async function hasRemote(): Promise<boolean> {
  const g = git();
  try {
    const remotes = await g.getRemotes();
    return remotes.length > 0;
  } catch {
    return false;
  }
}

/** 拉取远程变更（rebase 模式） */
export async function pullRebase(): Promise<GitOpResult> {
  if (!(await isGitInitialized())) {
    return { success: false, message: '~/.lattice 未启用 Git 管理' };
  }

  if (!(await hasRemote())) {
    return { success: false, message: '未关联远程仓库，无法拉取' };
  }

  // 先提交本地变更避免冲突
  await commitAll('chore: 自动提交（pull 前）');

  try {
    const g = git();
    const output = await g.pull(['--rebase']);
    return {
      success: true,
      message: '拉取完成',
      output: JSON.stringify(output).slice(0, 200) || '已是最新',
    };
  } catch (err) {
    return { success: false, message: `拉取失败: ${(err as Error).message}` };
  }
}

/** 推送本地变更 */
export async function push(): Promise<GitOpResult> {
  if (!(await isGitInitialized())) {
    return { success: false, message: '~/.lattice 未启用 Git 管理' };
  }

  if (!(await hasRemote())) {
    return { success: false, message: '未关联远程仓库，无法推送' };
  }

  // 先提交本地变更
  await commitAll('chore: 自动提交（push 前）');

  try {
    const g = git();
    await g.push();
    return {
      success: true,
      message: '推送完成',
      output: '无新内容推送',
    };
  } catch (err) {
    return { success: false, message: `推送失败: ${(err as Error).message}` };
  }
}

/** 完整同步：先提交，再 pull --rebase，最后 push。
 *  无远程仓库时 commit 仍执行，pull/push 返回明确错误。 */
export async function syncAll(): Promise<{
  commit: GitOpResult;
  pull: GitOpResult;
  push: GitOpResult;
}> {
  if (!(await isGitInitialized())) {
    return {
      commit: { success: false, message: '~/.lattice 未启用 Git 管理' },
      pull: { success: false, message: '~/.lattice 未启用 Git 管理' },
      push: { success: false, message: '~/.lattice 未启用 Git 管理' },
    };
  }

  const commit = await commitAll('chore: 自动同步');

  if (!(await hasRemote())) {
    return {
      commit,
      pull: { success: false, message: '未关联远程仓库，已跳过拉取' },
      push: { success: false, message: '未关联远程仓库，已跳过推送' },
    };
  }

  const g = git();

  // pull --rebase（不再重复 commit）
  let pullResult: GitOpResult;
  try {
    await g.pull(['--rebase']);
    pullResult = { success: true, message: '拉取完成', output: '已是最新' };
  } catch (err) {
    pullResult = { success: false, message: `拉取失败: ${(err as Error).message}` };
  }

  // push（不再重复 commit）
  let pushResult: GitOpResult;
  try {
    await g.push();
    pushResult = { success: true, message: '推送完成', output: '无新内容推送' };
  } catch (err) {
    pushResult = { success: false, message: `推送失败: ${(err as Error).message}` };
  }

  return { commit, pull: pullResult, push: pushResult };
}

// ── Remote 管理 ──

/** 初始化 Git 仓库（init + 首次 commit + 添加 remote） */
export async function initLatticeGit(root: string, remoteUrl?: string): Promise<GitOpResult> {
  const git = simpleGit(root);
  await git.init();
  await git.add('.');
  await git.commit('chore: 初始化 lattice');
  if (remoteUrl) {
    await git.addRemote('origin', remoteUrl);
  }
  return { success: true, message: 'Git 仓库已初始化' };
}

/** 列出所有 remote */
export async function listRemotes(): Promise<GitRemoteInfo[]> {
  if (!(await isGitInitialized())) return [];

  const g = git();
  try {
    const remotes = await g.getRemotes(true);
    return remotes.map((r) => ({
      name: r.name,
      url: r.refs?.fetch || r.refs?.push || '',
      fetchUrl: r.refs?.fetch || '',
      pushUrl: r.refs?.push || '',
    }));
  } catch {
    return [];
  }
}

/** 添加 remote */
export async function addRemote(name: string, url: string): Promise<GitOpResult> {
  if (!(await isGitInitialized())) {
    return { success: false, message: '~/.lattice 未启用 Git 管理' };
  }
  if (!name || !url) {
    return { success: false, message: '名称和 URL 不能为空' };
  }

  const existing = await listRemotes();
  if (existing.some((r) => r.name === name)) {
    return { success: false, message: `remote '${name}' 已存在。请使用切换 URL 功能。` };
  }

  try {
    const g = git();
    await g.addRemote(name, url);
    return { success: true, message: `已添加 remote: ${name} -> ${url}` };
  } catch (err) {
    return { success: false, message: `添加失败: ${(err as Error).message}` };
  }
}

/** 修改 remote URL（切换仓库） */
export async function setRemoteUrl(name: string, url: string): Promise<GitOpResult> {
  if (!(await isGitInitialized())) {
    return { success: false, message: '~/.lattice 未启用 Git 管理' };
  }
  if (!name || !url) {
    return { success: false, message: '名称和 URL 不能为空' };
  }

  const existing = await listRemotes();
  if (!existing.some((r) => r.name === name)) {
    return { success: false, message: `remote '${name}' 不存在。请使用添加功能。` };
  }

  try {
    const g = git();
    // simple-git 没有直接的 set-url 方法，用 raw
    await g.raw(['remote', 'set-url', name, url]);

    // 同步更新 upstream 跟踪
    const branch = await g.revparse(['--abbrev-ref', 'HEAD']);
    const trimmed = branch.trim();
    if (trimmed && trimmed !== 'HEAD') {
      try {
        await g.raw(['branch', `--set-upstream-to=${name}/${trimmed}`, trimmed]);
      } catch {
        // upstream 设置失败不影响 URL 切换
      }
    }
    return { success: true, message: `已切换 ${name} -> ${url}` };
  } catch (err) {
    return { success: false, message: `切换失败: ${(err as Error).message}` };
  }
}

/** 删除 remote */
export async function removeRemote(name: string): Promise<GitOpResult> {
  if (!(await isGitInitialized())) {
    return { success: false, message: '~/.lattice 未启用 Git 管理' };
  }
  if (!name) {
    return { success: false, message: '名称不能为空' };
  }

  const existing = await listRemotes();
  if (!existing.some((r) => r.name === name)) {
    return { success: false, message: `remote '${name}' 不存在` };
  }

  try {
    const g = git();
    await g.removeRemote(name);
    return { success: true, message: `已删除 remote: ${name}` };
  } catch (err) {
    return { success: false, message: `删除失败: ${(err as Error).message}` };
  }
}
