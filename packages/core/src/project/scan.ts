/**
 * 扫描逻辑 + 黑名单 — 依赖 identity + lookup + register
 *
 * 核心函数：
 * - scanForProjects() — 扫描入口
 * - scanDir() — 递归扫描
 * - SKIP_DIR_PATTERNS / isBlacklisted() — 黑名单 glob 匹配
 */

import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { minimatch } from 'minimatch';
import type { FingerprintDerived } from './identity';
import { normalizeLegacyId } from './identity';
import { computeProjectIds } from './identity-generate';
import { CONCURRENCY } from '../utils/constants';
import { autoRegisterProject } from './register';
import { collectFingerprint } from './fingerprint';
import { detectAndLinkNestedIn } from './nested-in';
import { selectPrimaryId } from './identity';
import { readJSON, join } from '../paths';

// ─── 黑名单 ───

/** 扫描时跳过的目录名（glob 语法匹配） */
const SKIP_DIR_PATTERNS = [
  // ── 包管理器 ──
  'node_modules',
  'bower_components',
  '.pnpm-store',
  'pnpm-store',
  '.yarn',
  '.yarn-cache',
  'yarn-cache',
  '.pnpm',
  '.npm',
  // ── VCS ──
  '.git',
  '.hg',
  '.svn',
  '.bzr',
  'CVS',
  // ── JS/TS 构建输出 ──
  'dist',
  'build',
  'out',
  '.output',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.remix',
  '.expo',
  '.turbo',
  '.parcel-cache',
  '.cache',
  // ── Python ──
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.env',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'site-packages',
  '.eggs',
  'egg-info',
  '*.egg-info',
  // ── Java/JVM ──
  'target',
  '.gradle',
  '.mvn',
  'gradle-cache',
  '.maven',
  'build-classes',
  // ── Go ──
  'bin',
  'pkg',
  // ── Rust ──
  'Cargo.lock',
  // ── C/C++ ──
  'cmake-build-debug',
  'cmake-build-release',
  'CMakeFiles',
  'CMakeCache',
  '.ccls-cache',
  '.clangd',
  'compile_commands',
  // ── .NET/C# ──
  'obj',
  'packages',
  // ── Ruby ──
  '.bundle',
  'vendor/bundle',
  '.rspec',
  // ── PHP ──
  'vendor',
  'composer.lock',
  // ── 测试覆盖率 ──
  'coverage',
  '.nyc_output',
  '.codecov',
  'htmlcov',
  // ── IDE/编辑器 ──
  '.idea',
  '.vscode',
  '.vs',
  '.history',
  '.fleet',
  // ── 临时文件 ──
  '*.tmp',
  'tmp',
  'temp',
  // ── 其他工具缓存 ──
  '.sass-cache',
  '.tscache',
  '.rollup.cache',
  '.eslintcache',
  '.turbo',
  '.docusaurus',
  '.nuxt',
  // ── Dart/Flutter ──
  '.dart_tool',
  '.flutter-plugins',
  '.packages',
  'build',
  // ── Elixir/Erlang ──
  '_build',
  'deps',
  '.elixir_ls',
  // ── Swift/Xcode ──
  'DerivedData',
  '.build',
  'build',
  // ── Haskell ──
  'dist',
  '.stack-work',
  // ── Lua ──
  '.luarocks',
  // ── Julia ──
  '.julia',
  // ── R ──
  '.Rhistory',
  'packrat',
  'renv',
  // ── 通配模式 ──
  '.*', // 所有隐藏目录
  '*.tmp',
  '*.log',
  '*.bak',
  '*.swp',
  // ── macOS 系统目录 ──
  'Library',
  'Applications',
  'Volumes',
  'private',
  '.Trash',
  '.fseventsd',
  '.Spotlight-V100',
  '.DocumentRevisions-V100',
  '.TemporaryItems',
  '.vol',
  'Mobile Documents',
  // ── Windows 系统目录 ──
  'Windows',
  'System32',
  'SysWOW64',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
  'AppData',
  'Application Data',
  'Local Settings',
  'My Documents',
  '$Recycle.Bin',
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'System Volume Information',
  'Config.Msi',
  'Prefetch',
  // ── Linux 系统目录 ──
  'proc',
  'sys',
  'dev',
  'boot',
  'run',
  'srv',
  'lost+found',
  'snap',
  'var',
  'etc',
  'usr',
  'bin',
  'sbin',
  'lib',
  'lib64',
  'media',
  'mnt',
  'opt',
  'root',
  // ── 虚拟/容器目录 ──
  'docker',
  '.docker',
  // ── 移动设备备份 ──
  'iPod Photo Cache',
  '.MobileBackups',
  // ── 其他不可能有项目的 ──
  'Music',
  'Movies',
  'Pictures',
  'Photos Library.photoslibrary',
];

/** 检查目录名是否在黑名单中（使用 minimatch 做 glob 匹配） */
export function isBlacklisted(name: string): boolean {
  return SKIP_DIR_PATTERNS.some((pattern) => minimatch(name, pattern));
}

// ─── 扫描结果 ───

export interface ScanResult {
  added: string[];
  updated: string[];
}

/** 扫描进度回调 */
export interface ScanProgress {
  /** 当前正在扫描的目录 */
  currentDir: string;
  /** 已扫描到的项目总数（含新增+更新） */
  found: number;
  /** 新增项目数 */
  added: number;
  /** 更新项目数 */
  updated: number;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

// ─── 扫描 ───

/**
 * 扫描指定目录列表，发现并注册 git 项目
 *
 * @param username 用户名
 * @param scanDirs 要扫描的目录列表
 * @param onProgress 进度回调（可选）
 * @returns 扫描结果（新增/更新的路径）
 */
export async function scanForProjects(
  username: string,
  scanDirs: string[],
  onProgress?: ScanProgressCallback,
): Promise<ScanResult> {
  const added: string[] = [];
  const updated: string[] = [];
  const registeredProjects: { id: string; dir: string }[] = [];

  for (const dir of scanDirs) {
    await scanDir(username, dir, added, updated, onProgress, registeredProjects);
  }

  // 所有项目注册完成后，统一串行执行嵌套关系检测
  // （避免并行递归下多个 detectAndLinkNestedIn 同时写 relations.json 导致竞态）
  for (const { id, dir } of registeredProjects) {
    await detectAndLinkNestedIn(username, id, dir);
  }

  return { added, updated };
}

/**
 * 递归扫描目录，发现 git 项目或 lattice.json 并注册
 *
 * 所有目录都递归子目录（不因当前目录有 id 源就跳过）
 * 使用 readdir({withFileTypes:true}) 一次获取 entries + 类型信息，避免额外 stat
 * 子目录并行递归（并发限制 8）
 */
async function scanDir(
  username: string,
  dir: string,
  added: string[],
  updated: string[],
  onProgress: ScanProgressCallback | undefined,
  registeredProjects: { id: string; dir: string }[],
): Promise<void> {
  // 通知进度
  if (onProgress) {
    onProgress({
      currentDir: dir,
      found: added.length + updated.length,
      added: added.length,
      updated: updated.length,
    });
  }

  // 一次读取所有 entries + 类型信息（替代 listDir + stat）
  let dirents: Dirent[];
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 目录不可读
  }

  // 一次遍历：检查 .git / lattice.json + 收集子目录
  let isGitRepo = false;
  let hasLatticeJson = false;
  const subDirs: string[] = [];
  for (const d of dirents) {
    if (d.name === '.git') {
      isGitRepo = true;
    } else if (d.name === 'lattice.json') {
      hasLatticeJson = true;
    } else if (d.isDirectory() && !isBlacklisted(d.name)) {
      subDirs.push(join(dir, d.name));
    }
  }

  let legacyId: string | null = null;
  if (hasLatticeJson) {
    const data = await readJSON<{ id?: string }>(join(dir, 'lattice.json'));
    if (data?.id) {
      legacyId = normalizeLegacyId(data.id);
    }
  }

  // 如果是 git 仓库或有 lattice.json → 采集指纹
  // skipNestedIn=true：嵌套关系检测延迟到 scanForProjects 所有扫描完成后统一执行
  if (isGitRepo || legacyId) {
    const { derived } = await collectFingerprint(dir);
    const ids = computeProjectIds(derived as FingerprintDerived, legacyId);

    if (ids.length > 0) {
      const { meta, isNew } = await autoRegisterProject(username, ids, dir, derived, true);
      if (isNew) {
        added.push(dir);
      } else if (meta) {
        updated.push(dir);
      }
      const primaryId = selectPrimaryId(ids);
      if (primaryId) {
        registeredProjects.push({ id: primaryId, dir });
      }
    }
  }

  // 并行递归（并发数根据 CPU 核心数动态确定）
  const concurrency = CONCURRENCY;
  for (let i = 0; i < subDirs.length; i += concurrency) {
    await Promise.all(
      subDirs
        .slice(i, i + concurrency)
        .map((d: string) => scanDir(username, d, added, updated, onProgress, registeredProjects)),
    );
  }
}
