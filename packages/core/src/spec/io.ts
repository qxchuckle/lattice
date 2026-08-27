import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SpecFrontmatter, SpecParseError, ParsedSpec } from '../types';
import { readText, writeText, fileExists, removeFile, basename } from '../paths';
import { generateSpecId, isValidSpecId } from './id';
import { nowISO } from '../utils/time';

/**
 * frontmatter 围栏切分正则：`---` 行之间的 YAML 文本 + 闭合围栏后的正文。
 *
 * 与 gray-matter 行为对齐：空围栏（`---\n---\n`）、闭合围栏尾随空格（`--- \n`）均视为有效 frontmatter。
 *
 * 不再使用 gray-matter：其内部 js-yaml 状态污染后，同一坏 frontmatter 首次解析抛错、
 * 后续静默返回空 data（且 stringify 也会抛错），导致同进程内后续 spec 静默丢 frontmatter。
 * `yaml`（eemeli）无状态且连续解析同一坏文本行为稳定，core 已依赖（export.ts 等在用）。
 */
const FRONTMATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*\r?\n?/;

/** eemeli/yaml YAMLParseError 的最小形状 */
interface YAMLParseErrorLike {
  message?: string;
  /** [line, col]（1-based，相对 frontmatter 文本）；首项为错误起点 */
  linePos?: Array<{ line: number; col: number }>;
}

/** 去掉 message 首行尾部的位置后缀（如 " at line 5, column 1:"），避免与 parseError.line 双重行号混清 */
function extractReason(message: string): string {
  return message
    .split('\n')[0]
    .replace(/\s*at line \d+(?:, column \d+)?:?$/, '')
    .trim();
}

/** 把解析错误格式化为一行可读文本（lint / migrate / CLI 共用，保证口径一致） */
export function formatSpecParseError(err: SpecParseError): string {
  const pos =
    err.line !== undefined
      ? `（第 ${err.line} 行${err.column !== undefined ? `，第 ${err.column} 列` : ''}）`
      : '';
  return `${err.message}${pos}`;
}

/** 字符串级 frontmatter 解析结果（不读盘，供 parseSpec 与模板应用共用） */
export interface ParsedFrontmatter {
  frontmatter: SpecFrontmatter;
  content: string;
  parseError?: SpecParseError;
}

/** 解析 markdown 文本中的 YAML frontmatter（不读盘）。
 *
 * YAML 语法错误不抛出：返回带 `parseError` 的结果（frontmatter 为空对象、
 * content 为去围栏后的正文）。
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) {
    // 无 frontmatter 围栏：与 gray-matter 行为一致，空 data + 全文正文
    return { frontmatter: {} as SpecFrontmatter, content: raw.trim() };
  }

  const fmText = m[1] ?? '';
  const content = raw
    .slice(m[0].length)
    .replace(/^\s*\n/, '')
    .trim();

  try {
    const data = parseYaml(fmText);
    // 防御：frontmatter 顶层必须是映射（纯标量/数组/空文本归一为空对象）
    const frontmatter: SpecFrontmatter =
      data && typeof data === 'object' && !Array.isArray(data) ? (data as SpecFrontmatter) : {};
    return { frontmatter, content };
  } catch (e) {
    const err = e as YAMLParseErrorLike;
    const pos = err.linePos?.[0];
    // linePos 相对 frontmatter 文本（文件第 2 行起），+1 后即文件内绝对行号
    const parseError: SpecParseError = {
      message: extractReason(err.message ?? String(e)),
      line: typeof pos?.line === 'number' ? pos.line + 1 : undefined,
      column: typeof pos?.col === 'number' ? pos.col : undefined,
    };
    return { frontmatter: {} as SpecFrontmatter, content, parseError };
  }
}

/** 解析 spec 文件（markdown + YAML frontmatter）。
 *
 * YAML 语法错误不抛出：返回带 `parseError` 的 ParsedSpec（frontmatter 为空对象、
 * content 为去围栏后的正文），保证单个坏文件不阻塞同目录其他 spec 的加载。
 */
export async function parseSpec(
  filePath: string,
  relativePath?: string,
): Promise<ParsedSpec | null> {
  const raw = await readText(filePath);
  if (raw === null) return null;

  // 项目级 spec 的 filePath 含 /projects/<projectId>/，提取 projectId
  const projectMatch = filePath.match(/\/projects\/([^/]+)\//);
  const projectId = projectMatch ? projectMatch[1] : undefined;

  const { frontmatter, content, parseError } = parseFrontmatter(raw);
  return {
    frontmatter,
    content,
    filePath,
    fileName: basename(filePath),
    relativePath: relativePath ?? basename(filePath),
    projectId,
    ...(parseError ? { parseError } : {}),
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
 * - 围栏由本函数拼接（`yaml` 包序列化），content 原样保留（一字不改）
 * - 注：`updated` 等时间戳序列化为裸标量（`yaml` 解析回字符串，无 js-yaml 的 Date 陷阱）
 */
export async function writeSpec(
  filePath: string,
  frontmatter: SpecFrontmatter,
  content: string,
): Promise<void> {
  const fm = normalizeSpecFrontmatter(frontmatter);
  const raw = `---\n${stringifyYaml(fm)}---\n${content}\n`;
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
