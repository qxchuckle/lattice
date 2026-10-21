#!/usr/bin/env node
/**
 * CHANGELOG 写入逻辑（纯函数，便于单测）。
 *
 * 由 `scripts/release.mjs` 调用：发布时把 `[Unreleased]` 里手写的条目搬进新版本段，
 * 没写则按 Conventional Commits 从上一个 tag 生成。
 */

export const SECTION_TYPES = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  refactor: 'Changed',
  revert: 'Changed',
  docs: 'Documentation',
};

/** 章节输出顺序 */
export const SECTION_ORDER = ['Added', 'Changed', 'Fixed', 'Documentation'];

/** 纯内部提交不进 CHANGELOG */
export const SKIP_TYPES = new Set(['test', 'chore', 'ci', 'build', 'style']);

/** 没有任何可见变更时的占位条目 */
export const PLACEHOLDER = '- No user-facing changes.';

/** 按 Conventional Commits 类型把提交标题归组；release 提交与内部类型被丢弃 */
export function groupCommits(messages) {
  const groups = new Map();
  for (const raw of messages) {
    const line = String(raw).trim();
    if (!line || /^release: v?\d/.test(line)) continue;

    const match = line.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
    if (match && SKIP_TYPES.has(match[1])) continue;

    const section = (match && SECTION_TYPES[match[1]]) || 'Changed';
    const scope = match?.[2];
    const text = match ? match[3] : line;
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(scope ? `**${scope}**: ${text}` : text);
  }
  return groups;
}

/** 不带版本标题的段落正文，用于拼在 `## [x.y.z] - date` 之后 */
export function renderBody(groups) {
  const emitted = SECTION_ORDER.filter((title) => groups.get(title)?.length);
  if (!emitted.length) return PLACEHOLDER;

  const lines = [];
  for (const title of emitted) {
    lines.push(`### ${title}`, '');
    for (const entry of groups.get(title)) lines.push(`- ${entry}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** 取 `## [Unreleased]` 段正文；只有占位符时视为空 */
export function readUnreleased(text) {
  const start = text.indexOf('## [Unreleased]');
  if (start < 0) return { start: -1, end: -1, body: '' };
  const end = text.indexOf('\n## [', start + 1);
  const body = (end < 0 ? text.slice(start) : text.slice(start, end))
    .replace('## [Unreleased]', '')
    .trim();
  return { start, end, body: body === PLACEHOLDER ? '' : body };
}

/**
 * 写入一个新版本段：重置 `[Unreleased]`，把版本段插在它之后。
 * 找不到 `[Unreleased]` 抛错；调用方负责先校验。
 */
export function insertVersionSection(text, { version, date, body }) {
  const { start, end } = readUnreleased(text);
  if (start < 0) throw new Error('CHANGELOG.md 缺少 `## [Unreleased]` 段落');

  const head = '## [Unreleased]\n\n';
  const section = `## [${version}] - ${date}\n\n${body}\n\n`;
  const tail = end < 0 ? '' : text.slice(end + 1);
  return `${text.slice(0, start)}${head}${section}${tail}`;
}
