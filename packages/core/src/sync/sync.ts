import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import type { SyncDomainConfig } from '../types';
import {
  getSyncBaselinePath,
  getSyncDomainsDir,
  getSyncDomainDir,
  removeDir,
  readJSON,
  writeJSON,
} from '../paths';
import {
  addSyncDomain,
  removeSyncDomain,
  readSyncDomains,
  writeSyncDomains,
  domainHashOf,
  mirrorDirOf,
  normalizeDomainConfig,
} from './domain-config';
import { ensureMirror, mirrorPull } from './mirror';
import { appendSyncLog } from './log';
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
  await appendSyncLog({
    at: new Date().toISOString(),
    target: hash,
    action: 'join',
    status: pull.ok ? 'ok' : 'error',
    message: `关联域 ${d.remote}#${d.branch}${pull.ok ? '，初始拉取成功' : `，初始拉取失败：${pull.message}`}`,
    detail: summary
      ? {
          users: summary.users,
          projects: summary.projects,
          specs: summary.specs,
          globalSpecs: summary.globalSpecTitles,
        }
      : undefined,
  });
  return {
    domainHash: hash,
    mirrorDir,
    summary,
    warnings: pull.ok
      ? buildWarnings(summary)
      : [`拉取失败：${pull.message}`, ...buildWarnings(summary)],
  };
}

/** 域配置更新（label/use/routes 就地改；remote/branch 变更 = 身份迁移：保留配置重建镜像） */
export async function updateDomain(
  domainHash: string,
  patch: Partial<Pick<SyncDomainConfig, 'remote' | 'branch' | 'label' | 'use' | 'routes'>>,
): Promise<{
  domain: SyncDomainConfig;
  hash: string;
  migrated: boolean;
  mirrorDir?: string;
  pullWarning?: string;
}> {
  const domains = await readSyncDomains();
  const idx = domains.findIndex((d) => domainHashOf(d) === domainHash);
  if (idx === -1) throw new Error(`未找到域：${domainHash}`);
  const current = normalizeDomainConfig(domains[idx]);
  const next = normalizeDomainConfig({ ...current, ...patch });
  const newHash = domainHashOf(next);

  if (newHash === domainHash) {
    // 身份未变：就地更新
    domains[idx] = next;
    await writeSyncDomains(domains);
    return { domain: next, hash: newHash, migrated: false };
  }

  // 身份迁移：同一数组位置替换 + 清理旧镜像/指纹 + 重建镜像并初始拉取
  domains[idx] = next;
  await writeSyncDomains(domains);
  await removeDir(join(getSyncDomainsDir(), domainHash));
  await rm(getSyncBaselinePath(domainHash), { force: true });
  const mirrorDir = await ensureMirror(next);
  // 拉取失败不回滚配置（与 joinDomain 同策略）：域已迁移，镜像缺失由下次同步重试
  const pull = await mirrorPull(next).catch((err: Error) => ({
    ok: false,
    message: err.message,
  }));
  await appendSyncLog({
    at: new Date().toISOString(),
    target: newHash,
    action: 'join',
    status: pull.ok ? 'ok' : 'error',
    message: `域地址/分支变更迁移：${current.remote}#${current.branch}（${domainHash.slice(0, 8)}）→ ${next.remote}#${next.branch}（${newHash.slice(0, 8)}）${pull.ok ? '，镜像已重建' : `，初始拉取失败：${pull.message}`}`,
  });
  return {
    domain: next,
    hash: newHash,
    migrated: true,
    mirrorDir,
    pullWarning: pull.ok ? undefined : pull.message,
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
  await appendSyncLog({
    at: new Date().toISOString(),
    target: domainHash,
    action: 'unlink',
    status: 'ok',
    message: `解除域 ${target.remote}#${target.branch ?? 'main'}（配置/镜像/指纹已清理）`,
  });
  return { remote: target.remote, label: target.label };
}

export interface DomainLastSync {
  /** ok=全部成功；error=拉取或推送失败 */
  status: 'ok' | 'error';
  /** 人类可读结果摘要（含失败原因） */
  message: string;
  /** ISO 时间 */
  at: string;
}

export interface DomainStats {
  users: number;
  projects: number;
  specs: number;
  tasks: number;
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
  /** 上次同步结果（~/.cache/sync-status/<hash>.json，面板展示） */
  lastSync: DomainLastSync | null;
  /** 镜像内容统计（各域数据概况对比） */
  stats: DomainStats | null;
}

/** 域列表（数组顺序 = 遮蔽优先级） */
export async function listDomains(): Promise<DomainInfo[]> {
  const domains = await readSyncDomains();
  const out: DomainInfo[] = [];
  for (let i = 0; i < domains.length; i++) {
    const d = normalizeDomainConfig(domains[i]);
    const hash = domainHashOf(d);
    const baseline = await readJSON<{ updatedAt: string }>(getSyncBaselinePath(hash));
    const mirrorExistsFlag = await (
      await import('node:fs/promises')
    )
      .access(mirrorDirOf(d))
      .then(() => true)
      .catch(() => false);
    out.push({
      hash,
      remote: d.remote,
      branch: d.branch,
      label: d.label,
      use: d.use ?? 'trusted',
      routes: d.routes,
      pushState: derivePushState(d.routes, baseline !== null),
      mirrorExists: mirrorExistsFlag,
      lastPushAt: baseline?.updatedAt ?? null,
      priority: i + 1,
      lastSync: await readDomainLastSync(hash),
      stats: mirrorExistsFlag ? await readDomainStats(hash) : null,
    });
  }
  return out;
}

/** 读取域上次同步结果（失败/成功+原因+时间） */
async function readDomainLastSync(domainHash: string): Promise<DomainLastSync | null> {
  const { getSyncStatusPath } = await import('./status');
  return readJSON<DomainLastSync>(getSyncStatusPath(domainHash));
}

/** 镜像内容统计（枚举目录，不读文件内容） */
async function readDomainStats(domainHash: string): Promise<DomainStats | null> {
  const mirrorDir = getSyncDomainDir(domainHash);
  const { readdir } = await import('node:fs/promises');
  const users = (await readdir(join(mirrorDir, 'users')).catch(() => [] as string[])).filter(
    (n) => !n.startsWith('.'),
  );
  let projects = 0;
  let specs = 0;
  let tasks = 0;
  for (const u of users) {
    projects += (
      await readdir(join(mirrorDir, 'users', u, 'projects')).catch(() => [] as string[])
    ).filter((n) => !n.startsWith('.')).length;
    specs += (
      await readdir(join(mirrorDir, 'users', u, 'spec')).catch(() => [] as string[])
    ).filter((n) => n.endsWith('.md')).length;
    specs += (await readdir(join(mirrorDir, 'spec')).catch(() => [] as string[])).filter((n) =>
      n.endsWith('.md'),
    ).length;
    tasks += (
      await readdir(join(mirrorDir, 'users', u, 'tasks')).catch(() => [] as string[])
    ).filter((n) => !n.startsWith('.')).length;
  }
  if (users.length + projects + specs + tasks === 0) return null;
  return { users: users.length, projects, specs, tasks };
}

export interface DomainSyncOutcome {
  domainHash: string;
  label?: string;
  pulled: boolean;
  pullMessage: string;
  push?: DomainPushResult;
}

/** 全域同步：逐域 pull（use=off 也拉，镜像保鲜随时可切档）+ 有 routes/指纹的域 push */
/** 写域同步结果状态（面板 lastSync 展示） */
async function writeDomainLastSync(
  domainHash: string,
  status: 'ok' | 'error',
  message: string,
): Promise<void> {
  const { getSyncStatusPath } = await import('./status');
  await writeJSON(getSyncStatusPath(domainHash), {
    status,
    message,
    at: new Date().toISOString(),
  } satisfies DomainLastSync);
}

export async function syncDomains(username: string): Promise<DomainSyncOutcome[]> {
  // 汇总审计：本次同步操作了哪些域（写在最前，面板首条可见）
  {
    const domains = await readSyncDomains();
    if (domains.length > 0) {
      const list = domains
        .map((d) => `${domainHashOf(d).slice(0, 8)}${d.label ? `(${d.label})` : ''}`)
        .join('、');
      await appendSyncLog({
        at: new Date().toISOString(),
        target: 'origin',
        action: 'commit',
        status: 'ok',
        message: `域同步开始：共 ${domains.length} 个域（顺序即遮蔽优先级）——${list}`,
      }).catch(() => undefined);
    }
  }
  const domains = await readSyncDomains();
  const out: DomainSyncOutcome[] = [];
  for (const raw of domains) {
    const d = normalizeDomainConfig(raw);
    const hash = domainHashOf(d);
    try {
      const pull = await mirrorPull(d);
      const hasPushBusiness = (d.routes ?? []).length > 0 || (await readBaseline(hash)) !== null;
      const push = hasPushBusiness ? await pushDomain(username, d) : undefined;
      // 状态持久化：拉取/推送全部成功=ok；任一失败=error（附原因）
      const syncOk =
        pull.ok && (!push || ['pushed', 'no-changes', 'skipped-no-routes'].includes(push.status));
      const syncMsg = [
        pull.ok ? `拉取✓` : `拉取✗ ${pull.message}`,
        push
          ? push.status === 'pushed'
            ? `推送✓ ${push.message}`
            : push.status === 'no-changes'
              ? '无变更'
              : `推送✗ ${push.message}`
          : '只读',
      ].join('；');
      await writeDomainLastSync(hash, syncOk ? 'ok' : 'error', syncMsg);
      // JSONL 同步日志：pull / push（含明细）/ 冲突各自一条
      const now = new Date().toISOString();
      await appendSyncLog({
        at: now,
        target: hash,
        action: 'pull',
        status: pull.ok ? 'ok' : 'error',
        message: pull.message,
        detail: {
          ...(pull.changedFiles ? { changedFiles: pull.changedFiles } : {}),
          ...(pull.target ? { remote: pull.target } : {}),
        },
      }).catch(() => undefined);
      if (push) {
        await appendSyncLog({
          at: now,
          target: hash,
          action: push.status === 'pull-conflict' ? 'conflict' : 'push',
          status: ['pushed', 'no-changes', 'skipped-no-routes'].includes(push.status)
            ? 'ok'
            : 'error',
          message: push.message,
          detail: {
            ...(push.copied !== undefined ? { copied: push.copied } : {}),
            ...(push.removed !== undefined ? { removed: push.removed } : {}),
            ...(push.copiedFiles?.length ? { copiedFiles: push.copiedFiles } : {}),
            ...(push.removedFiles?.length ? { removedFiles: push.removedFiles } : {}),
            ...(push.target ? { remote: push.target } : {}),
            ...(push.conflicts?.length ? { conflicts: push.conflicts } : {}),
          },
        }).catch(() => undefined);
      }
      out.push({
        domainHash: hash,
        label: d.label,
        pulled: pull.ok,
        pullMessage: pull.message,
        push,
      });
    } catch (err) {
      await writeDomainLastSync(hash, 'error', `同步异常：${(err as Error).message}`).catch(
        () => undefined,
      );
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
