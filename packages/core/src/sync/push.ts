import { join } from 'node:path';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import type { SyncDomainConfig } from '../types';
import { readJSON, writeJSON, getSyncBaselinePath } from '../paths';
import { normalizeDomainConfig, domainHashOf, parseRoutes } from './domain-config';
import { mirrorPull, mirrorCommitAllAndPush } from './mirror';
import { computeContribution } from './contribution';

/**
 * push 白名单增量复制器（实施红线：严禁全量重建镜像）。
 *
 * push 只做两件事：
 *   1. 覆盖「本次贡献集」内的路径（我的内容我更新）；
 *   2. 退出传播：基线指纹中我上次推过、本次不再贡献的路径（我的内容我退出）。
 * 其余路径（别人的贡献）永不触碰 —— 互删防护的根本机制。
 *
 * 基线指纹 ~/.lattice/.cache/sync-baseline/<hash>.json 记录上次成功 push 的
 * 文件级路径集；push 成功才更新，失败保持不动；指纹缺失时保守不删只增改。
 */

export interface DomainBaseline {
  domainHash: string;
  updatedAt: string;
  /** 上次成功 push 的镜像内相对路径集（文件级，POSIX 风格） */
  paths: string[];
}

export type DomainPushStatus =
  | 'pushed'
  | 'no-changes'
  | 'skipped-no-routes'
  | 'pull-conflict'
  | 'push-failed'
  | 'error';

export interface DomainPushResult {
  domainHash: string;
  status: DomainPushStatus;
  message: string;
  copied: number;
  removed: number;
  conflicts?: string[];
  /** 上行文件清单（destRel，审计展示用；截前 50） */
  copiedFiles?: string[];
  /** 退出传播清单（destRel，审计展示用；截前 50） */
  removedFiles?: string[];
  /** 目标域 remote#branch（审计展示用） */
  target?: string;
}

export async function readBaseline(domainHash: string): Promise<DomainBaseline | null> {
  return readJSON<DomainBaseline>(getSyncBaselinePath(domainHash));
}

export async function writeBaseline(domainHash: string, paths: string[]): Promise<void> {
  await writeJSON(getSyncBaselinePath(domainHash), {
    domainHash,
    updatedAt: new Date().toISOString(),
    paths: [...paths].sort(),
  } satisfies DomainBaseline);
}

/** 单域 push（增量式）。pull 失败/贡献集空/推送失败均结构化返回，不抛错。 */
export async function pushDomain(
  username: string,
  domain: SyncDomainConfig,
): Promise<DomainPushResult> {
  const d = normalizeDomainConfig(domain);
  const hash = domainHashOf(d);
  const base: DomainPushResult = {
    domainHash: hash,
    status: 'error',
    message: '',
    copied: 0,
    removed: 0,
  };

  try {
    // 1. 拉远端最新（镜像 = 远端现状基线）
    const pull = await mirrorPull(d);
    if (!pull.ok) {
      return { ...base, status: 'pull-conflict', message: pull.message, conflicts: pull.conflicts };
    }

    // 2. 计算贡献集
    const hasRoutes = (d.routes ?? []).length > 0;
    const baseline = await readBaseline(hash);
    if (!hasRoutes && !baseline) {
      return { ...base, status: 'skipped-no-routes', message: '无推送规则，仅拉取' };
    }
    // routes 被清空但历史推过 → 贡献集为空集 → 退出传播撤回全部历史贡献（语义正确）
    const plan = await computeContribution(username, d.routes);

    // 3. 增量复制贡献集（只覆盖我的贡献；不碰其余路径）
    const { mirrorDirOf } = await import('./domain-config');
    const mirrorDir = mirrorDirOf(d);
    for (const f of plan.files) {
      const dest = join(mirrorDir, ...f.destRel.split('/'));
      await mkdir(join(dest, '..'), { recursive: true });
      await copyFile(f.src, dest);
    }
    const planPaths = new Set(plan.files.map((f) => f.destRel));

    // 4. 退出传播：仅限基线指纹内我的历史贡献（缺失指纹 → 保守不删）
    let removed = 0;
    if (baseline) {
      for (const prev of baseline.paths) {
        if (planPaths.has(prev)) continue;
        await rm(join(mirrorDir, ...prev.split('/')), { force: true });
        removed += 1;
      }
    }

    // 5. 提交并推送
    const cp = await mirrorCommitAllAndPush(d, `sync: push contribution from ${username}`);
    if (!cp.pushed && cp.committed) {
      return {
        ...base,
        status: 'push-failed',
        message: cp.message,
        copied: plan.files.length,
        removed,
        copiedFiles: plan.files.map((f) => f.destRel).slice(0, 50),
        removedFiles: baseline ? baseline.paths.filter((p) => !planPaths.has(p)).slice(0, 50) : [],
        target: `${d.remote}#${d.branch}`,
      };
    }
    if (!cp.pushed) {
      // committed=false：镜像与远端已一致，本次无变更（指纹仍刷新，贡献集可能已收缩）
      await writeBaseline(hash, [...planPaths]);
      return {
        ...base,
        status: 'no-changes',
        message: cp.message,
        copied: plan.files.length,
        removed,
      };
    }

    // 6. 成功才更新指纹
    await writeBaseline(hash, [...planPaths]);
    return {
      ...base,
      status: cp.committed ? 'pushed' : 'no-changes',
      message: cp.committed
        ? `推送 ${plan.files.length} 个文件，退出 ${removed} 个 → ${d.remote}#${d.branch}`
        : '无变更（镜像与远端一致）',
      copied: plan.files.length,
      removed,
      copiedFiles: cp.committed ? plan.files.map((f) => f.destRel).slice(0, 50) : [],
      removedFiles: cp.committed
        ? baseline
          ? baseline.paths.filter((p) => !planPaths.has(p)).slice(0, 50)
          : []
        : [],
      target: `${d.remote}#${d.branch}`,
    };
  } catch (err) {
    return { ...base, status: 'error', message: (err as Error).message };
  }
}

/** routes 是否会推送任何内容（配置派生态展示用） */
export function derivePushState(routes: string[] | undefined, hasBaseline: boolean): string {
  const parsed = parseRoutes(routes);
  if (parsed.matchAll) return '全量推送';
  if ((routes ?? []).length === 0) return hasBaseline ? '撤回中（历史贡献待退出）' : '只读消费';
  return `选择性推送（${routes!.length} 条规则）`;
}
