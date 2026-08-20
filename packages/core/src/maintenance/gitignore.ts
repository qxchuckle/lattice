import ignore from 'ignore';
import { fileExists, readText, writeText } from '../paths';

/**
 * ~/.lattice 主仓库 .gitignore 的段定义与维护逻辑。
 *
 * 单一来源：`ltc init` 的自动补段与 `ltc doctor` 的缺段检查共用本模块，
 * 段清单变更只改这里。
 */

export interface GitignoreEntry {
  /** gitignore 模式 */
  pattern: string;
  /** 探测路径：用于验证现有 .gitignore 是否已覆盖该条目（非真实文件） */
  probePath: string;
}

export interface GitignoreSection {
  title: string;
  entries: GitignoreEntry[];
}

export const GITIGNORE_SECTIONS: GitignoreSection[] = [
  {
    title: 'Lattice 本机配置',
    entries: [{ pattern: 'config/config-local.json', probePath: 'config/config-local.json' }],
  },
  {
    title: '个人敏感信息',
    entries: [{ pattern: '**/private/', probePath: 'workspace/private/secret.txt' }],
  },
  {
    title: '本地缓存（SQLite 数据库等）',
    entries: [{ pattern: '.cache/', probePath: '.cache/lattice.db' }],
  },
  {
    title: '软删除回收站',
    entries: [{ pattern: '.trash/', probePath: '.trash/2026-01-01-abcd-xxx/.trash-meta.json' }],
  },
  {
    title: '本地 embedding 模型',
    entries: [{ pattern: 'models/', probePath: 'models/model.onnx' }],
  },
  {
    title: '域同步镜像（本机物化视图，各机独立 clone，不经本仓同步）',
    entries: [
      {
        pattern: '.sync-domains/',
        probePath: '.sync-domains/a1b2c3d4e5f60718/users/qcqx/spec/example.md',
      },
    ],
  },
  {
    title: '其他',
    entries: [
      { pattern: '.DS_Store', probePath: '.DS_Store' },
      { pattern: 'node_modules/', probePath: 'node_modules/package.json' },
    ],
  },
];

/** 渲染 gitignore 段为文本块 */
export function renderGitignoreSections(sections: GitignoreSection[]): string {
  return sections
    .map((section) =>
      [`# ${section.title}`, ...section.entries.map((entry) => entry.pattern)].join('\n'),
    )
    .join('\n\n');
}

/** 计算现有 .gitignore 内容尚未覆盖的段（返回空数组 = 全覆盖） */
export function computeMissingGitignoreSections(existingContent: string): GitignoreSection[] {
  if (!existingContent.trim()) return GITIGNORE_SECTIONS;
  const matcher = ignore();
  matcher.add(existingContent);
  return GITIGNORE_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => !matcher.ignores(entry.probePath)),
  })).filter((section) => section.entries.length > 0);
}

/**
 * 确保 .gitignore 覆盖全部标准段：不存在则创建；存在则追加缺失段（幂等）。
 */
export async function ensureGitignore(gitignorePath: string): Promise<void> {
  const existingContent = (await fileExists(gitignorePath))
    ? ((await readText(gitignorePath)) ?? '')
    : '';
  if (!existingContent.trim()) {
    await writeText(gitignorePath, `${renderGitignoreSections(GITIGNORE_SECTIONS)}\n`);
    return;
  }

  const missingSections = computeMissingGitignoreSections(existingContent);
  if (missingSections.length === 0) {
    return;
  }

  const nextBlock = renderGitignoreSections(missingSections);
  const normalizedExisting = existingContent.trimEnd();
  await writeText(gitignorePath, `${normalizedExisting}\n\n${nextBlock}\n`);
}
