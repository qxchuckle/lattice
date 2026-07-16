import simpleGit from 'simple-git';
import type { ProjectMeta } from '../types';

/** 项目 git 状态信息 */
export interface GitStatus {
  /** 当前分支名 */
  branch: string | null;
  /** 是否有未提交改动 */
  dirty: boolean;
  /** 未提交文件数 */
  uncommittedCount: number;
  /** 领先远程的 commit 数 */
  ahead: number;
  /** 落后远程的 commit 数 */
  behind: number;
  /** 最近一次 commit message */
  lastCommitMessage: string | null;
  /** 最近一次 commit 时间（ISO 8601） */
  lastCommitTime: string | null;
}

/**
 * 查询项目的实时 git 状态。
 * 使用 simple-git，不走 shell。
 */
export async function getProjectGitStatus(project: ProjectMeta): Promise<GitStatus | null> {
  const cwd = project.localPaths?.[0];
  if (!cwd) return null;

  try {
    const git = simpleGit(cwd);
    const [status, log] = await Promise.all([
      git.status(),
      git.log({ maxCount: 1 }).catch(() => null),
    ]);

    const lastCommit = log?.latest;
    return {
      branch: status.current || null,
      dirty: status.files.length > 0,
      uncommittedCount: status.files.length,
      ahead: status.ahead || 0,
      behind: status.behind || 0,
      lastCommitMessage: lastCommit?.message || null,
      lastCommitTime: lastCommit?.date || null,
    };
  } catch {
    return null;
  }
}
