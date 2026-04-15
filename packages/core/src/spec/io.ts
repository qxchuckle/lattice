import matter from 'gray-matter';
import type { SpecFrontmatter, ParsedSpec } from '../types';
import { readText, writeText, fileExists, basename } from '../paths';

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

/** 写入 spec 文件 */
export async function writeSpec(
  filePath: string,
  frontmatter: SpecFrontmatter,
  content: string,
): Promise<void> {
  const fm = { ...frontmatter, updated: new Date().toISOString().slice(0, 10) };
  const raw = matter.stringify(content, fm);
  await writeText(filePath, raw);
}

/** 写入 spec 原始内容（不处理 frontmatter） */
export async function writeSpecRaw(filePath: string, content: string): Promise<void> {
  await writeText(filePath, content);
}

/** 删除 spec 文件 */
export async function deleteSpec(filePath: string): Promise<void> {
  const { removeFile } = await import('../paths');
  await removeFile(filePath);
}

/** 检查 spec 文件是否存在 */
export async function specExists(filePath: string): Promise<boolean> {
  return fileExists(filePath);
}
