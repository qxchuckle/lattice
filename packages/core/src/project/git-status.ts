import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectMeta } from '../types';

const execFileAsync = promisify(execFile);

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
 * 使用异步 execFile 不阻塞事件循环。
 * 适用于 web server 场景（多请求并发）。
 */
export async function getProjectGitStatus(project: ProjectMeta): Promise<GitStatus | null> {
  const cwd = project.localPaths?.[0];
  if (!cwd) return null;

  try {
    const [branchResult, statusResult, aheadBehindResult, lastCommitResult] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }),
      execFileAsync('git', ['status', '--porcelain'], { cwd }),
      execFileAsync('git', ['rev-list', '--left-right', '--count', '@{u}...HEAD'], { cwd }).catch(
        () => null,
      ),
      execFileAsync('git', ['log', '-1', '--format=%s|%cI'], { cwd }),
    ]);

    const branch = branchResult.stdout.trim() || null;
    const statusOutput = statusResult.stdout.trim();
    const uncommittedCount = statusOutput ? statusOutput.split('\n').length : 0;
    const dirty = uncommittedCount > 0;

    let ahead = 0;
    let behind = 0;
    if (aheadBehindResult) {
      const parts = aheadBehindResult.stdout.trim().split(/\s+/);
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }

    const commitParts = lastCommitResult.stdout.trim().split('|');
    const lastCommitMessage = commitParts[0] || null;
    const lastCommitTime = commitParts[1] || null;

    return {
      branch,
      dirty,
      uncommittedCount,
      ahead,
      behind,
      lastCommitMessage,
      lastCommitTime,
    };
  } catch {
    return null;
  }
}
