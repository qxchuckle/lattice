import { createHash } from 'node:crypto';
import type { SyncDomainConfig, SyncDomainsConfig } from '../types';
import { readLocalConfig, writeLocalConfig } from '../config';
import { getSyncDomainDir } from '../paths';

/**
 * 域配置层：身份 hash、配置读写（config-local.json 的 sync.domains）、
 * routes 语法解析与校验。
 *
 * 域身份 = sha256(`${remote}#${branch}`) 前 16 位 hex，跨机器确定；
 * 一切身份运算（镜像目录名、指纹文件名、来源标注）恒用该 hash。
 */

export const DEFAULT_DOMAIN_BRANCH = 'main';

export function normalizeDomainConfig(
  domain: SyncDomainConfig,
): Required<Pick<SyncDomainConfig, 'remote' | 'branch'>> & SyncDomainConfig {
  return { ...domain, branch: domain.branch || DEFAULT_DOMAIN_BRANCH };
}

/** 域身份 hash：sha256(remote#branch) 前 16 位 hex */
export function computeDomainHash(remote: string, branch: string): string {
  return createHash('sha256').update(`${remote}#${branch}`).digest('hex').slice(0, 16);
}

export function domainHashOf(domain: SyncDomainConfig): string {
  const d = normalizeDomainConfig(domain);
  return computeDomainHash(d.remote, d.branch);
}

/** 域镜像目录（~/.lattice/.sync-domains/<hash>） */
export function mirrorDirOf(domain: SyncDomainConfig): string {
  return getSyncDomainDir(domainHashOf(domain));
}

// ─── routes 语法 ───

export interface ParsedRoutes {
  /** true 表示含 "*" 全匹配 */
  matchAll: boolean;
  /** 项目匹配 glob 集（匹配对象：项目全部 ids + 项目 name，minimatch） */
  projectGlobs: string[];
  /** 用户级 spec relativePath glob 集 */
  userSpecGlobs: string[];
  /** 全局 spec relativePath glob 集 */
  globalSpecGlobs: string[];
}

export const ROUTE_PREFIXES = ['project:', 'user-spec:', 'global-spec:'] as const;

/** 校验单条 route 语法："*" 或 "<前缀><glob>"。非法抛错（消息含原因） */
export function validateRoute(rule: string): void {
  if (rule === '*') return;
  // 否定模式：! 前缀 + 合法 route（如 !user-spec:secret-*.md）
  const inner = rule.startsWith('!') ? rule.slice(1) : rule;
  const hit = ROUTE_PREFIXES.find((p) => inner.startsWith(p));
  if (!hit) {
    throw new Error(
      `非法 route 规则 "${rule}"：须为 "*" 或以 ${ROUTE_PREFIXES.map((p) => `"${p}"`).join(' / ')} 之一开头（支持 ! 否定前缀）`,
    );
  }
  const glob = inner.slice(hit.length);
  if (!glob.trim()) {
    throw new Error(`非法 route 规则 "${rule}"：${hit} 后的 glob 不能为空`);
  }
}

/** 解析整组 routes（已校验）为结构化匹配集 */
export function parseRoutes(routes: string[] | undefined): ParsedRoutes {
  const parsed: ParsedRoutes = {
    matchAll: false,
    projectGlobs: [],
    userSpecGlobs: [],
    globalSpecGlobs: [],
  };
  for (const rule of routes ?? []) {
    validateRoute(rule);
    if (rule === '*') {
      parsed.matchAll = true;
      continue;
    }
    // 否定前缀：剥 ! 后按类型归类，glob 保留 ! 前缀供 globMatchAny 排除
    const neg = rule.startsWith('!');
    const inner = neg ? rule.slice(1) : rule;
    const prefix = neg ? '!' : '';
    if (inner.startsWith('project:')) {
      parsed.projectGlobs.push(prefix + inner.slice('project:'.length));
    } else if (inner.startsWith('user-spec:')) {
      parsed.userSpecGlobs.push(prefix + inner.slice('user-spec:'.length));
    } else if (inner.startsWith('global-spec:')) {
      parsed.globalSpecGlobs.push(prefix + inner.slice('global-spec:'.length));
    }
  }
  return parsed;
}

/** 校验完整域配置（remote 非空、branch 合法、use 枚举、逐条 route 语法）。非法抛错 */
export function validateDomainConfig(domain: SyncDomainConfig): void {
  if (!domain.remote || !domain.remote.trim()) {
    throw new Error('域配置非法：remote 不能为空');
  }
  if (domain.branch && /[\s~^:?*[\]\\]/.test(domain.branch)) {
    throw new Error(`域配置非法：branch "${domain.branch}" 含非法字符`);
  }
  if (domain.use && !['trusted', 'reference', 'off'].includes(domain.use)) {
    throw new Error(`域配置非法：use 须为 trusted | reference | off，当前 "${domain.use}"`);
  }
  for (const rule of domain.routes ?? []) {
    validateRoute(rule);
  }
}

// ─── hash 引用解析（CLI/Web 统一体验：完整 16 位或 ≥4 位前缀） ───

export interface DomainRefResolution {
  /** 唯一命中 */
  domain?: SyncDomainConfig;
  index: number;
  /** 未命中/歧义时的错误信息（含可用域清单，附人类可读指引） */
  error?: string;
}

/**
 * 按完整 hash 或唯一前缀（≥4 位）解析域引用。
 * 未命中/歧义时返回带可用域清单的 error，把「未找到」升级为可操作的指引。
 */
export async function resolveDomainRef(ref: string): Promise<DomainRefResolution> {
  const domains = await readSyncDomains();
  const candidates = domains
    .map((domain, index) => ({ domain, index }))
    .filter((c) => domainHashOf(c.domain).startsWith(ref));

  if (candidates.length === 1) {
    return { domain: candidates[0].domain, index: candidates[0].index };
  }
  if (candidates.length > 1) {
    const list = candidates.map((c) => domainHashOf(c.domain)).join('、');
    return {
      index: -1,
      error: `前缀 "${ref}" 匹配到 ${candidates.length} 个域（${list}），请用更长的前缀或完整 hash`,
    };
  }
  if (domains.length === 0) {
    return {
      index: -1,
      error: `未找到域：${ref}（尚未关联任何域，先 ltc sync domain join <remote>）`,
    };
  }
  const list = domains.map((d) => `${domainHashOf(d)}${d.label ? `(${d.label})` : ''}`).join('、');
  return { index: -1, error: `未找到域：${ref}。已关联的域：${list}` };
}

// ─── 配置读写（config-local.json 合并写） ───

/** 读取域列表（未配置返回 []） */
export async function readSyncDomains(): Promise<SyncDomainConfig[]> {
  const config = await readLocalConfig();
  return config?.sync?.domains ?? [];
}

/** 按写回整份域列表（保持其余配置不动） */
export async function writeSyncDomains(domains: SyncDomainConfig[]): Promise<void> {
  const config = (await readLocalConfig()) as NonNullable<
    Awaited<ReturnType<typeof readLocalConfig>>
  >;
  if (!config) {
    throw new Error('config-local.json 不存在：请先 lattice init');
  }
  for (const d of domains) validateDomainConfig(d);
  // 同 hash 去重校验
  const seen = new Set<string>();
  for (const d of domains) {
    const h = domainHashOf(d);
    if (seen.has(h))
      throw new Error(
        `域重复：${d.remote}#${d.branch || DEFAULT_DOMAIN_BRANCH} 已存在（hash ${h}）`,
      );
    seen.add(h);
  }
  config.sync = { domains };
  await writeLocalConfig(config);
}

/** 追加一个域（hash 重复抛错） */
export async function addSyncDomain(domain: SyncDomainConfig): Promise<SyncDomainConfig[]> {
  const domains = await readSyncDomains();
  const h = domainHashOf(domain);
  if (domains.some((d) => domainHashOf(d) === h)) {
    throw new Error(
      `域已存在：${domain.remote}#${domain.branch || DEFAULT_DOMAIN_BRANCH}（hash ${h}）`,
    );
  }
  validateDomainConfig(domain);
  const next = [...domains, domain];
  await writeSyncDomains(next);
  return next;
}

/** 移除一个域（按 hash；不存在抛错） */
export async function removeSyncDomain(domainHash: string): Promise<SyncDomainConfig[]> {
  const domains = await readSyncDomains();
  const idx = domains.findIndex((d) => domainHashOf(d) === domainHash);
  if (idx === -1) {
    throw new Error(`未找到域：${domainHash}`);
  }
  const next = domains.filter((_, i) => i !== idx);
  await writeSyncDomains(next);
  return next;
}
