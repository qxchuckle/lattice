import type { ParsedSpec } from '../types';

export interface SpecValidationWarning {
  type: 'missing-scope';
  message: string;
  spec: ParsedSpec;
}

/**
 * 适用范围标题的匹配模式：
 * 支持 "## 适用范围"、"## 适用范围（重要）" 等变体
 */
const SCOPE_HEADING_PATTERN = /^#{1,3}\s*适用范围/m;

/**
 * 校验 user/global 级 spec 是否包含适用范围声明。
 * 仅针对 user 和 global 层级的 spec 校验，project 级 spec 不需要
 * （项目级 spec 天然只对该项目生效）。
 *
 * 返回 warning 级别的校验结果（不阻断写入，仅提示）。
 */
export function validateSpecScope(
  spec: ParsedSpec,
  scope: 'user' | 'global',
): SpecValidationWarning | null {
  if (SCOPE_HEADING_PATTERN.test(spec.content)) {
    return null;
  }

  const scopeLabel = scope === 'user' ? '用户级' : '全局级';
  return {
    type: 'missing-scope',
    message: `${scopeLabel} spec「${spec.frontmatter.title ?? spec.fileName}」缺少「## 适用范围」声明。建议添加适用范围段，明确该规范适用于哪些项目/场景。`,
    spec,
  };
}

/**
 * 批量校验一组 spec 的适用范围声明。
 */
export function validateSpecsScope(
  specs: ParsedSpec[],
  scope: 'user' | 'global',
): SpecValidationWarning[] {
  const warnings: SpecValidationWarning[] = [];
  for (const spec of specs) {
    const warning = validateSpecScope(spec, scope);
    if (warning) warnings.push(warning);
  }
  return warnings;
}
