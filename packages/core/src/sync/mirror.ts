import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import simpleGit, { type SimpleGit } from 'simple-git';
import type { SyncDomainConfig } from '../types';
import { dirExists } from '../paths';
import { mirrorDirOf, normalizeDomainConfig } from './domain-config';

/**
 * 域镜像 git 管理：clone/init、pull（含 rebase 冲突逃生）、commit+push。
 * 镜像 = ~/.lattice/.sync-domains/<hash> 独立 git 仓库，域数据的本机只读物化视图。
 */

export interface MirrorResult {
  ok: boolean;
  message: string;
  /** pull 冲突时的冲突文件清单 */
  conflicts?: string[];
}

function gitOf(mirrorDir: string): SimpleGit {
  return simpleGit(mirrorDir);
}

async function isGitRepo(dir: string): Promise<boolean> {
  if (!(await dirExists(dir))) return false;
  const entries = await readdir(dir).catch(() => [] as string[]);
  return entries.includes('.git');
}

/** rebase 中间态检测：.git/rebase-merge 或 .git/rebase-apply 存在 */
export async function isRebaseInProgress(mirrorDir: string): Promise<boolean> {
  const entries = await readdir(join(mirrorDir, '.git')).catch(() => [] as string[]);
  return entries.includes('rebase-merge') || entries.includes('rebase-apply');
}

/** rebase 逃生：检测到中间态则 abort，返回是否执行了 abort */
export async function abortRebaseIfNeeded(mirrorDir: string): Promise<boolean> {
  if (!(await isRebaseInProgress(mirrorDir))) return false;
  await gitOf(mirrorDir)
    .raw(['rebase', '--abort'])
    .catch(() => undefined);
  return true;
}

/**
 * 确保域镜像就绪（幂等）：
 * - 已是 git 仓 → 直接用
 * - 否则 init + remote add + fetch + checkout -B（远端空仓/unborn 容错，首次 commit 后 push -u 建立）
 */
export async function ensureMirror(domain: SyncDomainConfig): Promise<string> {
  const d = normalizeDomainConfig(domain);
  const mirrorDir = mirrorDirOf(d);
  if (await isGitRepo(mirrorDir)) return mirrorDir;

  const { ensureDir } = await import('../paths');
  await ensureDir(mirrorDir);
  const git = gitOf(mirrorDir);
  await git.raw(['init', '-b', d.branch]);
  // 镜像自带本地 git 身份（仅仓内生效，不碰全局配置）：commit 的前提
  await git.addConfig('user.name', 'lattice-sync', false, 'local');
  await git.addConfig('user.email', 'sync@lattice.local', false, 'local');
  await git.addRemote('origin', d.remote).catch(() => undefined);

  // 拉取远端已有内容（空仓/无分支时保持 unborn HEAD，首次 push -u 建立）
  try {
    await git.fetch('origin', d.branch);
    const refs = await git.raw(['ls-remote', 'origin', `refs/heads/${d.branch}`]);
    if (refs.trim()) {
      await git.raw(['checkout', '-B', d.branch, `origin/${d.branch}`]);
    }
  } catch {
    // 远端不可达或空仓：镜像留空待首次 push；网络类错误在 pull/push 阶段再暴露
  }
  return mirrorDir;
}

/** HEAD 是否 unborn（无任何 commit，首次 push 前状态） */
export async function isUnbornHead(mirrorDir: string): Promise<boolean> {
  try {
    await gitOf(mirrorDir).raw(['rev-parse', '--verify', 'HEAD']);
    return false;
  } catch {
    return true;
  }
}

/** unborn 状态下尝试从远端建基：远端有分支 → fetch + checkout -B；远端空 → 保持空仓待首次 push */
async function bootstrapUnbornIfNeeded(
  git: SimpleGit,
  mirrorDir: string,
  branch: string,
): Promise<void> {
  await git.fetch('origin', branch).catch(() => undefined);
  const refs = await git.raw(['ls-remote', 'origin', `refs/heads/${branch}`]).catch(() => '');
  if (refs.trim()) {
    await git.raw(['checkout', '-B', branch, `origin/${branch}`]);
  }
}

/** 域镜像 pull（--rebase）。unborn HEAD 先从远端建基；冲突自动 abort 逃生（保镜像现状）并返回冲突清单 */
export async function mirrorPull(domain: SyncDomainConfig): Promise<MirrorResult> {
  const d = normalizeDomainConfig(domain);
  const mirrorDir = await ensureMirror(d);
  const git = gitOf(mirrorDir);

  const aborted = await abortRebaseIfNeeded(mirrorDir);
  if (await isUnbornHead(mirrorDir)) {
    await bootstrapUnbornIfNeeded(git, mirrorDir, d.branch);
    if (await isUnbornHead(mirrorDir)) {
      return { ok: true, message: '远端为空，跳过拉取' };
    }
  }
  try {
    await git.raw(['pull', '--rebase', 'origin', d.branch]);
    return { ok: true, message: aborted ? '拉取成功（已清理上次中断的 rebase）' : '拉取成功' };
  } catch (err) {
    // 逃生：回到 pull 前状态，输出冲突报告（手动解决指引）
    await abortRebaseIfNeeded(mirrorDir);
    const conflicts = await listConflicts(mirrorDir);
    return {
      ok: false,
      message: `拉取失败（已回退到本地状态）：${(err as Error).message.split('\n')[0]}`,
      conflicts,
    };
  }
}

async function listConflicts(mirrorDir: string): Promise<string[]> {
  try {
    const out = await gitOf(mirrorDir).diff(['--name-only', '--diff-filter=U']);
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** add -A + commit（有变更才提交）+ push。返回是否推送 */
export async function mirrorCommitAllAndPush(
  domain: SyncDomainConfig,
  message: string,
): Promise<{ committed: boolean; pushed: boolean; message: string }> {
  const d = normalizeDomainConfig(domain);
  const mirrorDir = mirrorDirOf(d);
  const git = gitOf(mirrorDir);

  await git.add('./*').catch(() => undefined);
  await git.add('-A').catch(() => undefined);
  const status = await git.status();
  if (status.isClean()) {
    return { committed: false, pushed: false, message: '无变更' };
  }

  await git.commit(message);
  try {
    // 首次推送建立跟踪分支（unborn→远端无分支时 -u；已有跟踪时普通 push）
    await git.raw(['push', '-u', 'origin', d.branch]);
    return { committed: true, pushed: true, message: '推送成功' };
  } catch (err) {
    return {
      committed: true,
      pushed: false,
      message: `推送失败：${(err as Error).message.split('\n')[0]}`,
    };
  }
}
