import { parse, stringify } from 'yaml';

/**
 * 检查点草稿（纯逻辑，供单测）：
 * 长文本检查点通过 untitled Markdown 文档起草，草稿 frontmatter 带标记；
 * 提交时解析回字段，正文即 checkpoint message。
 */

/** 草稿标记键：只有带该标记的 untitled 文档才被认作检查点草稿。 */
export const DRAFT_MARKER_KEY = 'lattice-checkpoint';

export interface CheckpointDraft {
  taskId: string;
  type: string;
  title: string;
  body: string;
}

/** 生成草稿全文（YAML frontmatter + 正文）。 */
export function buildDraftContent(fields: {
  taskId: string;
  type: string;
  title: string;
  body: string;
}): string {
  const frontmatter = stringify({
    [DRAFT_MARKER_KEY]: true,
    task: fields.taskId,
    type: fields.type,
    title: fields.title,
  });
  const body = fields.body.replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${frontmatter}---\n\n${body ? `${body}\n` : ''}`;
}

/** 解析草稿；非草稿（无 frontmatter / 缺标记 / YAML 损坏）返回 null。 */
export function parseCheckpointDraft(text: string): CheckpointDraft | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return null;

  let data: Record<string, unknown> | null = null;
  try {
    const parsed = parse(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // YAML 损坏视为非草稿
  }
  if (!data || data[DRAFT_MARKER_KEY] !== true) return null;

  const str = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };

  return {
    taskId: str(data.task),
    type: str(data.type),
    title: str(data.title),
    body: text.slice(match[0].length),
  };
}

/** 正文首个一级标题（提交时 title 缺省的兜底）。 */
export function firstHeading(body: string): string | undefined {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match?.[1]?.trim() || undefined;
}

/** 任务总结草稿正文骨架（任务行 + 完成项 / 遗留 / 下一步）。 */
export function buildSummaryBody(opts: {
  taskLine: string;
  sections: [string, string, string];
}): string {
  const [done, pending, next] = opts.sections;
  return [
    `> ${opts.taskLine}`,
    '',
    `## ${done}`,
    '',
    '- ',
    '',
    `## ${pending}`,
    '',
    '- ',
    '',
    `## ${next}`,
    '',
    '- ',
    '',
  ].join('\n');
}
