import matter from 'gray-matter';
import type { SpecFrontmatter, ParsedSpec } from '../types';
import { readText, writeText, fileExists, removeFile, basename } from '../paths';
import { generateSpecId, isValidSpecId } from './id';
import { nowISO } from '../utils/time';

/** 解析 spec 文件（markdown + YAML frontmatter） */
export async function parseSpec(
  filePath: string,
  relativePath?: string,
): Promise<ParsedSpec | null> {
  const raw = await readText(filePath);
  if (raw === null) return null;

  const { data, content } = matter(raw);
  return {
    frontmatter: data as SpecFrontmatter,
    content: content.trim(),
    filePath,
    fileName: basename(filePath),
    relativePath: relativePath ?? basename(filePath),
  };
}

/**
 * 规范化 frontmatter：保证字段顺序固定（id → title → description → tags → updated → 其他）。
 *
 * - 缺失或非法 `id` 会自动补一个新的合法 ID
 * - `updated` 会被刷新到当前时刻（ISO 8601 完整时间戳）
 * - 其他未知字段保留在末尾，避免误删第三方扩展字段
 */
export function normalizeSpecFrontmatter(frontmatter: SpecFrontmatter): SpecFrontmatter {
  const id = isValidSpecId(frontmatter.id) ? frontmatter.id : generateSpecId();

  // 用一个新对象保证序列化字段顺序：id → title → description → tags → updated → 其他
  const ordered: SpecFrontmatter = { id };
  if (frontmatter.title !== undefined) ordered.title = frontmatter.title;
  if (frontmatter.description !== undefined) ordered.description = frontmatter.description;
  if (frontmatter.tags !== undefined) ordered.tags = frontmatter.tags;
  ordered.updated = nowISO();

  // 保留其他扩展字段（如未来新增的实验性字段）
  for (const [k, v] of Object.entries(frontmatter)) {
    if (k === 'id' || k === 'title' || k === 'description' || k === 'tags' || k === 'updated') {
      continue;
    }
    ordered[k] = v;
  }
  return ordered;
}

/**
 * 写入 spec 文件。
 *
 * 写入策略：
 * - frontmatter 经过 `normalizeSpecFrontmatter` 规范化（自动补 id、刷 updated、固定字段顺序）
 * - content 通过 `gray-matter` 原样拼接，不做任何 markdown 序列化（一字不改）
 */
export async function writeSpec(
  filePath: string,
  frontmatter: SpecFrontmatter,
  content: string,
): Promise<void> {
  const fm = normalizeSpecFrontmatter(frontmatter);
  const raw = matter.stringify(content, fm);
  await writeText(filePath, raw);
}

/** 写入 spec 原始内容（不处理 frontmatter） */
export async function writeSpecRaw(filePath: string, content: string): Promise<void> {
  await writeText(filePath, content);
}

/** 删除 spec 文件 */
export async function deleteSpec(filePath: string): Promise<void> {
  await removeFile(filePath);
}

/** 检查 spec 文件是否存在 */
export async function specExists(filePath: string): Promise<boolean> {
  return fileExists(filePath);
}
