/**
 * spec 元数据纯逻辑单测（L1）：ID 生成/校验、frontmatter 规范化、lint、适用范围校验
 */
import { describe, it, expect } from 'vitest';
import { generateSpecId, isValidSpecId, SPEC_ID_PATTERN } from './id';
import { normalizeSpecFrontmatter } from './io';
import { lintSpecFrontmatter, DESCRIPTION_MIN_LENGTH } from './lint';
import { validateSpecScope } from './validate';
import type { ParsedSpec, SpecFrontmatter } from '../types';

describe('generateSpecId / isValidSpecId', () => {
  it('生成的 ID 符合 spec-{8 位 base36} 格式', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSpecId()).toMatch(SPEC_ID_PATTERN);
    }
  });

  it('多次生成不重复（碰撞概率极低）', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSpecId()));
    expect(ids.size).toBe(100);
  });

  it('isValidSpecId 边界：前缀/长度/字符集/类型', () => {
    expect(isValidSpecId('spec-a3f9c2d1')).toBe(true);
    expect(isValidSpecId('spec-A3F9C2D1'), '大写非法').toBe(false);
    expect(isValidSpecId('spec-a3f9c2d'), '7 位非法').toBe(false);
    expect(isValidSpecId('spec-a3f9c2d12'), '9 位非法').toBe(false);
    expect(isValidSpecId('spc-a3f9c2d1'), '前缀错误').toBe(false);
    expect(isValidSpecId(undefined)).toBe(false);
    expect(isValidSpecId(123)).toBe(false);
  });
});

describe('normalizeSpecFrontmatter', () => {
  it('非法/缺失 id 自动补新 ID，updated 刷新为 ISO 8601', () => {
    const fm = normalizeSpecFrontmatter({ title: 't' } as SpecFrontmatter);
    expect(fm.id).toMatch(SPEC_ID_PATTERN);
    expect(fm.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('合法 id 保留', () => {
    const fm = normalizeSpecFrontmatter({ id: 'spec-a3f9c2d1', title: 't' });
    expect(fm.id).toBe('spec-a3f9c2d1');
  });

  it('字段顺序固定：id → title → description → tags → updated → 扩展字段', () => {
    const fm = normalizeSpecFrontmatter({
      customField: 'x',
      updated: '2020-01-01',
      tags: ['a'],
      description: 'd',
      title: 't',
      id: 'spec-a3f9c2d1',
    } as SpecFrontmatter);
    expect(Object.keys(fm)).toEqual([
      'id',
      'title',
      'description',
      'tags',
      'updated',
      'customField',
    ]);
    expect(fm.customField, '扩展字段保留').toBe('x');
  });
});

function makeSpec(frontmatter: SpecFrontmatter, content = '正文'): ParsedSpec {
  return {
    frontmatter,
    content,
    filePath: '/spec/x.md',
    fileName: 'x.md',
    relativePath: 'x.md',
  };
}

describe('lintSpecFrontmatter', () => {
  it('id/title 缺失 → error；ok=false', () => {
    const report = lintSpecFrontmatter(makeSpec({} as SpecFrontmatter));
    const errorFields = report.issues.filter((i) => i.severity === 'error').map((i) => i.field);
    expect(errorFields).toContain('id');
    expect(errorFields).toContain('title');
    expect(report.ok).toBe(false);
  });

  it('id 格式非法 → error', () => {
    const report = lintSpecFrontmatter(makeSpec({ id: 'bad-id', title: 't' }));
    expect(report.issues.some((i) => i.field === 'id' && i.severity === 'error')).toBe(true);
  });

  it('description 缺失/过短 → warning（不影响 ok）', () => {
    const missing = lintSpecFrontmatter(makeSpec({ id: 'spec-a3f9c2d1', title: 't' }));
    expect(missing.issues.some((i) => i.field === 'description' && i.severity === 'warning')).toBe(
      true,
    );
    expect(missing.ok, 'warning 不影响 ok').toBe(true);

    const short = lintSpecFrontmatter(
      makeSpec({
        id: 'spec-a3f9c2d1',
        title: 't',
        description: '短'.repeat(DESCRIPTION_MIN_LENGTH - 1),
      }),
    );
    expect(short.issues.some((i) => i.field === 'description')).toBe(true);
  });

  it('updated 非 ISO 格式 → warning；tags 非字符串数组 → warning', () => {
    const report = lintSpecFrontmatter(
      makeSpec({
        id: 'spec-a3f9c2d1',
        title: 't',
        description: 'x'.repeat(50),
        updated: 'yesterday',
        tags: [1, 2] as unknown as string[],
      }),
    );
    expect(report.issues.some((i) => i.field === 'updated')).toBe(true);
    expect(report.issues.some((i) => i.field === 'tags')).toBe(true);
  });

  it('完整合法 frontmatter → 无 issue', () => {
    const report = lintSpecFrontmatter(
      makeSpec({
        id: 'spec-a3f9c2d1',
        title: 't',
        description: 'x'.repeat(50),
        updated: '2026-01-01T00:00:00.000Z',
        tags: ['a'],
      }),
    );
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('validateSpecScope', () => {
  it('含「## 适用范围」标题 → 通过（支持变体）', () => {
    expect(validateSpecScope(makeSpec({ title: 't' }, '## 适用范围\n所有项目'), 'user')).toBeNull();
    expect(
      validateSpecScope(makeSpec({ title: 't' }, '### 适用范围（重要）\nx'), 'global'),
    ).toBeNull();
  });

  it('缺少适用范围 → missing-scope warning，标注层级', () => {
    const warning = validateSpecScope(makeSpec({ title: 't' }, '正文无范围'), 'user');
    expect(warning?.type).toBe('missing-scope');
    expect(warning?.message).toContain('用户级');
  });
});
