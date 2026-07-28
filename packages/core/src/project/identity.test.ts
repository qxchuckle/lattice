/**
 * 项目身份标识 ID 模型单测（L1，纯函数零依赖）
 *
 * ID 格式：<prefix>:<content>，优先级 legacy > git > remote。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeGitRemote,
  resolveProjectIds,
  normalizeProjectMeta,
  normalizeLegacyId,
  normalizeProjectId,
  parsePrefixedId,
  selectPrimaryId,
  sortIdsByPriority,
  mergeIds,
} from './identity';
import type { ProjectMeta } from '../types';

describe('normalizeGitRemote', () => {
  it('SSH 与 HTTPS 归一化到同一形式', () => {
    expect(normalizeGitRemote('git@github.com:user/repo.git')).toBe('github.com/user/repo');
    expect(normalizeGitRemote('https://github.com/user/repo.git')).toBe('github.com/user/repo');
    expect(normalizeGitRemote('http://github.com/User/Repo')).toBe('github.com/user/repo');
  });

  it('空串与空白 → 空串', () => {
    expect(normalizeGitRemote('')).toBe('');
    expect(normalizeGitRemote('  ')).toBe('');
  });
});

describe('normalizeLegacyId / normalizeProjectId', () => {
  it('无前缀补 legacy:，有前缀原样', () => {
    expect(normalizeLegacyId('abc123')).toBe('legacy:abc123');
    expect(normalizeLegacyId('git:deadbeef')).toBe('git:deadbeef');
    expect(normalizeProjectId('abc123')).toBe('legacy:abc123');
  });
});

describe('parsePrefixedId', () => {
  it('解析前缀与内容', () => {
    expect(parsePrefixedId('legacy:abc')).toEqual({ prefix: 'legacy', content: 'abc' });
    expect(parsePrefixedId('remote:a:b')).toEqual({ prefix: 'remote', content: 'a:b' });
  });

  it('无冒号 → 空前缀', () => {
    expect(parsePrefixedId('abc')).toEqual({ prefix: '', content: 'abc' });
  });
});

describe('selectPrimaryId', () => {
  it('优先级 legacy > git > remote', () => {
    expect(selectPrimaryId(['remote:r1', 'git:g1', 'legacy:l1'])).toBe('legacy:l1');
    expect(selectPrimaryId(['remote:r1', 'git:g1'])).toBe('git:g1');
    expect(selectPrimaryId(['remote:r1'])).toBe('remote:r1');
  });

  it('空数组 → null；未知前缀取第一个', () => {
    expect(selectPrimaryId([])).toBeNull();
    expect(selectPrimaryId(['x:1', 'y:2'])).toBe('x:1');
  });

  it('同优先级取数组顺序第一个', () => {
    expect(selectPrimaryId(['remote:r1', 'remote:r2'])).toBe('remote:r1');
  });
});

describe('sortIdsByPriority', () => {
  it('按优先级排序，稳定去重，未知前缀最后', () => {
    expect(
      sortIdsByPriority(['remote:r1', 'unknown:u', 'git:g1', 'legacy:l1', 'remote:r1']),
    ).toEqual(['legacy:l1', 'git:g1', 'remote:r1', 'unknown:u']);
  });

  it('同优先级保持原有相对顺序', () => {
    expect(sortIdsByPriority(['remote:r2', 'remote:r1'])).toEqual(['remote:r2', 'remote:r1']);
  });
});

describe('mergeIds', () => {
  it('合并去重并按优先级排序', () => {
    expect(mergeIds(['remote:r1', 'legacy:l1'], ['git:g1', 'remote:r1'])).toEqual([
      'legacy:l1',
      'git:g1',
      'remote:r1',
    ]);
  });
});

describe('resolveProjectIds / normalizeProjectMeta', () => {
  const base: ProjectMeta = {
    ids: [],
    name: 'p',
    localPaths: [],
    created: '2026-01-01T00:00:00.000Z',
  } as unknown as ProjectMeta;

  it('resolveProjectIds：ids 优先，其次 id 转 legacy，都无 → 空数组', () => {
    expect(resolveProjectIds({ ...base, ids: ['git:g1'] })).toEqual(['git:g1']);
    expect(resolveProjectIds({ ...base, id: 'abc' })).toEqual(['legacy:abc']);
    expect(resolveProjectIds(base)).toEqual([]);
  });

  it('normalizeProjectMeta：合并 id 到 ids、补前缀、排序、设置 primaryId', () => {
    const meta = normalizeProjectMeta({
      ...base,
      id: 'abc',
      ids: ['remote:r1', 'nolegacyprefix'],
    });
    expect(meta.ids).toContain('legacy:abc');
    expect(meta.ids).toContain('legacy:nolegacyprefix');
    expect(meta.ids).toContain('remote:r1');
    expect(meta.ids[meta.ids.length - 1], 'remote 排最后').toBe('remote:r1');
    expect(meta.id, 'primaryId 为最高优先级 legacy').toMatch(/^legacy:/);
  });
});
