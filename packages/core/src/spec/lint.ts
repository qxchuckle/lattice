import type { ParsedSpec, SpecFrontmatter } from '../types';
import { isValidSpecId } from './id';

/** Description 长度建议（中文字符宽度，按字符数判断） */
export const DESCRIPTION_MIN_LENGTH = 30;
export const DESCRIPTION_MAX_LENGTH = 500;

/** Lint 单条诊断 */
export interface SpecLintIssue {
  severity: 'error' | 'warning';
  field: 'id' | 'title' | 'description' | 'tags' | 'updated' | 'frontmatter';
  message: string;
}

/** Lint 报告 */
export interface SpecLintReport {
  filePath: string;
  relativePath: string;
  issues: SpecLintIssue[];
  ok: boolean;
}

/**
 * 校验 spec frontmatter 的完整性与规范性。
 *
 * 严格校验项（error）：
 * - `id` 缺失或不符合 `spec-{8 位 base36}` 格式
 * - `title` 缺失或为空字符串
 *
 * 提示性校验（warning）：
 * - `description` 缺失：标记 `[缺失摘要]`，由 `spec suggest-description` 引导补全
 * - `description` 过短或过长（<30 或 >500 字符）
 * - `updated` 缺失或非合法 ISO 8601 时间戳
 * - `tags` 字段类型不是字符串数组
 */
export function lintSpecFrontmatter(spec: ParsedSpec): SpecLintReport {
  const fm = spec.frontmatter ?? ({} as SpecFrontmatter);
  const issues: SpecLintIssue[] = [];

  // id
  if (fm.id === undefined || fm.id === null || fm.id === '') {
    issues.push({
      severity: 'error',
      field: 'id',
      message:
        'frontmatter.id 缺失。运行 `lattice spec set <file>` 或 `lattice spec migrate` 自动补全。',
    });
  } else if (!isValidSpecId(fm.id)) {
    issues.push({
      severity: 'error',
      field: 'id',
      message: `frontmatter.id "${fm.id}" 不符合格式 spec-{8 位 base36}。`,
    });
  }

  // title
  const title = typeof fm.title === 'string' ? fm.title.trim() : '';
  if (!title) {
    issues.push({
      severity: 'error',
      field: 'title',
      message: 'frontmatter.title 缺失。每个 spec 必须有标题。',
    });
  }

  // description
  const description = typeof fm.description === 'string' ? fm.description.trim() : '';
  if (!description) {
    issues.push({
      severity: 'warning',
      field: 'description',
      message:
        'frontmatter.description 缺失。`lattice context` 输出会标 [缺失摘要]，请用 `lattice spec suggest-description` 生成草稿后用 `lattice spec set --description` 落盘。',
    });
  } else if (description.length < DESCRIPTION_MIN_LENGTH) {
    issues.push({
      severity: 'warning',
      field: 'description',
      message: `frontmatter.description 过短（${description.length} 字符 < ${DESCRIPTION_MIN_LENGTH}）。建议三段式：作用范围 + 约束 + 作用。`,
    });
  } else if (description.length > DESCRIPTION_MAX_LENGTH) {
    issues.push({
      severity: 'warning',
      field: 'description',
      message: `frontmatter.description 过长（${description.length} 字符 > ${DESCRIPTION_MAX_LENGTH}）。建议精简为核心 80~300 字符。`,
    });
  }

  // updated（接受 ISO 8601 完整时间戳或兼容旧格式 YYYY-MM-DD）
  if (fm.updated !== undefined) {
    if (
      typeof fm.updated !== 'string' ||
      (!/^\d{4}-\d{2}-\d{2}T/.test(fm.updated) && !/^\d{4}-\d{2}-\d{2}$/.test(fm.updated))
    ) {
      issues.push({
        severity: 'warning',
        field: 'updated',
        message: 'frontmatter.updated 应为 ISO 8601 时间戳。`lattice spec set` 会自动刷新。',
      });
    }
  }

  // tags
  if (fm.tags !== undefined) {
    if (!Array.isArray(fm.tags) || fm.tags.some((t) => typeof t !== 'string')) {
      issues.push({
        severity: 'warning',
        field: 'tags',
        message: 'frontmatter.tags 必须是字符串数组。',
      });
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return {
    filePath: spec.filePath,
    relativePath: spec.relativePath,
    issues,
    ok: !hasError,
  };
}

/** 批量 lint */
export function lintSpecs(specs: ParsedSpec[]): SpecLintReport[] {
  return specs.map((s) => lintSpecFrontmatter(s));
}
