import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import type { SyncDomainConfig } from '../types';
import { getSyncBaselinePath, getSyncDomainsDir, removeDir, readJSON } from '../paths';
import {
  addSyncDomain,
  removeSyncDomain,
  readSyncDomains,
  domainHashOf,
  mirrorDirOf,
  normalizeDomainConfig,
} from './domain-config';
import { ensureMirror, mirrorPull } from './mirror';
import { pushDomain, readBaseline, derivePushState, type DomainPushResult } from './push';

/**
 * 域同步编排：join / unlink / list / 全域同步。
 *
 * join = 一行命令关联经验包（G3 安全面：内容摘要 + 同名用户提示 + 全局 spec 生效提示）。
 * sync = 全域 pull（use=off 也保持镜像新鲜）+ 有 routes/有指纹的域 push。
 */

export interface DomainSummary {
  users: number;
  projects: number;
  specs: number;
  globalSpecTitles: string[];
  /** 与本机同名的用户目录存在（其用户级 spec 将生效——trusted 档提示用） */
  sameNameUserPresent: boolean;
}

/** 枚举镜像内容摘要（join 输出 / doctor 检查复用） */
export async function summarizeMirror(
  mirrorDir: string,
  localUsername: string,
): Promise<DomainSummary> {
  const { walkFiles } = await import('./contribution');
  const users = (
    await (await import('node:fs/promises'))
      .readdir(join(mirrorDir, 'users'))
      .catch(() => [] as string[])
  ).filter((n) => !n.startsWith('.'));
  const projects = users.length
    ? (
        await Promise.all(
          users.map((u) =>
            (async () => {
              const dirs = await (await import('node:fs/promises'))
                .readdir(join(mirrorDir, 'users', u, 'projects'))
                .catch(() => [] as string[]);
              return dirs.filter((n) => !n.startsWith('.')).length;
            })(),
          ),
        )
      ).reduce((a, b) => a + b, 0)
    : 0;
  const specs = users.length
    ? (
        await Promise.all(
          users.map(async (u) => (await walkFiles(join(mirrorDir, 'users', u, 'spec'))).length),
        )
      ).reduce((a, b) => a + b, 0)
    : 0;
  const globalFiles = await walkFiles(join(mirrorDir, 'spec'));
  const globalSpecTitles: string[] = [];
  for (const rel of globalFiles.slice(0, 5)) {
    const raw = await (await import('node:fs/promises'))
      .readFile(join(mirrorDir, 'spec', rel), 'utf-8')
      .catch(() => '');
    const m = raw.match(/^title:\s*(.+)$/m);
    globalSpecTitles.push(m ? m[1].trim() : rel);
  }
  return {
    users: users.length,
    projects,
    specs,
    globalSpecTitles,
    sameNameUserPresent: users.includes(localUsername),
  };
}

export interface JoinResult {
  domainHash: string;
  mirrorDir: string;
  summary: DomainSummary | null;
  warnings: string[];
}

/** 预览域内容（--peek）：浅 clone 到临时目录读摘要后即删，不落配置不落镜像 */
export async function peekDomain(
  remote: string,
  branch: string,
  localUsername: string,
): Promise<JoinResult> {
  const { computeDomainHash } = await import('./domain-config');
  const hash = computeDomainHash(remote, branch);
  const tmp = await mkdtemp(join(tmpdir(), 'lattice-peek-'));
  try {
    const git = simpleGit(tmp);
    await git.raw(['clone', '--depth', '1', '--branch', branch, remote, '.']);
    const summary = await summarizeMirror(tmp, localUsername);
    return { domainHash: hash, mirrorDir: '', summary, warnings: buildWarnings(summary) };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

function buildWarnings(summary: DomainSummary | null): string[] {
  const warnings: string[] = [];
  if (!summary) return warnings;
  if (summary.sameNameUserPresent) {
    warnings.push(
      '该域含与你同名的用户数据：use=trusted 时其用户级 spec 将约束本机，可用 use:reference 关闭',
    );
  }
  if (summary.globalSpecTitles.length > 0) {
    warnings.push(
      `该域含 ${summary.globalSpecTitles.length}+ 个全局 spec：join 即接受其全局规范约束（titles：${summary.globalSpecTitles.slice(0, 3).join('、')}）`,
    );
  }
  return warnings;
}

/** 正式 join：配置登记 + 镜像初始化/拉取 + 摘要 */
export async function joinDomain(
  domain: SyncDomainConfig,
  localUsername: string,
): Promise<JoinResult> {
  const d = normalizeDomainConfig(domain);
  await addSyncDomain(d);
  const hash = domainHashOf(d);
  const mirrorDir = await ensureMirror(d);
  const pull = await mirrorPull(d);
  const summary = await summarizeMirror(mirrorDir, localUsername).catch(() => null);
  return {
    domainHash: hash,
    mirrorDir,
    summary,
    warnings: pull.ok
      ? buildWarnings(summary)
      : [`拉取失败：${pull.message}`, ...buildWarnings(summary)],
  };
}

/** unlink：配置移除 + 镜像目录删除 + 指纹删除（主数据毫发无伤） */
export async function unlinkDomain(
  domainHash: string,
): Promise<{ remote: string; label?: string }> {
  const domains = await readSyncDomains();
  const target = domains.find((d) => domainHashOf(d) === domainHash);
  if (!target) throw new Error(`未找到域：${domainHash}`);
  await removeSyncDomain(domainHash);
  await removeDir(join(getSyncDomainsDir(), domainHash));
  await rm(getSyncBaselinePath(domainHash), { force: true });
  return { remote: target.remote, label: target.label };
}

export interface DomainInfo {
  hash: string;
  remote: string;
  branch: string;
  label?: string;
  use: 'trusted' | 'reference' | 'off';
  routes?: string[];
  pushState: string;
  mirrorExists: boolean;
  lastPushAt: string | null;
  priority: number;
}

/** 域列表（数组顺序 = 遮蔽优先级） */
export async function listDomains(): Promise<DomainInfo[]> {
  const domains = await readSyncDomains();
  const out: DomainInfo[] = [];
  for (let i = 0; i < domains.length; i++) {
    const d = normalizeDomainConfig(domains[i]);
    const hash = domainHashOf(d);
    const baseline = await readJSON<{ updatedAt: string }>(getSyncBaselinePath(hash));
    out.push({
      hash,
      remote: d.remote,
      branch: d.branch,
      label: d.label,
      use: d.use ?? 'trusted',
      routes: d.routes,
      pushState: derivePushState(d.routes, baseline !== null),
      mirrorExists: await (
        await import('node:fs/promises')
      )
        .access(mirrorDirOf(d))
        .then(() => true)
        .catch(() => false),
      lastPushAt: baseline?.updatedAt ?? null,
      priority: i + 1,
    });
  }
  return out;
}

export interface DomainSyncOutcome {
  domainHash: string;
  label?: string;
  pulled: boolean;
  pullMessage: string;
  push?: DomainPushResult;
}

/** 全域同步：逐域 pull（use=off 也拉，镜像保鲜随时可切档）+ 有 routes/指纹的域 push */
export async function syncDomains(username: string): Promise<DomainSyncOutcome[]> {
  const domains = await readSyncDomains();
  const out: DomainSyncOutcome[] = [];
  for (const raw of domains) {
    const d = normalizeDomainConfig(raw);
    const hash = domainHashOf(d);
    try {
      const pull = await mirrorPull(d);
      const hasPushBusiness = (d.routes ?? []).length > 0 || (await readBaseline(hash)) !== null;
      const push = hasPushBusiness ? await pushDomain(username, d) : undefined;
      out.push({
        domainHash: hash,
        label: d.label,
        pulled: pull.ok,
        pullMessage: pull.message,
        push,
      });
    } catch (err) {
      out.push({
        domainHash: hash,
        label: d.label,
        pulled: false,
        pullMessage: (err as Error).message,
      });
    }
  }
  return out;
}
