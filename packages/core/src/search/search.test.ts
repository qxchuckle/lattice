/**
 * 搜索打分/归一化纯函数单测（L1）
 *
 * 覆盖混合搜索里最容易回归的纯逻辑：文本归一化、关键词提取、中文 n-gram、
 * lexical 查询变体、FTS 列限定、标题 boost、scope/type 加权、同名聚合。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  extractKeywords,
  buildChineseNgrams,
  buildLexicalQueries,
  wrapFtsColumnQuery,
  inferScopeWeight,
  getTypeWeight,
  normalizeTitleForGrouping,
  collapseDuplicateTitles,
  getTitleBoost,
} from './search';
import type { SearchResult } from '../types';

describe('normalizeText', () => {
  it('小写化并去除空白/标点/符号', () => {
    expect(normalizeText('Hello World!')).toBe('helloworld');
    expect(normalizeText('状态 管理，规范。')).toBe('状态管理规范');
    expect(normalizeText('a-b_c.d')).toBe('abcd');
  });

  it('空串与纯标点 → 空串', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('！？。，')).toBe('');
  });
});

describe('extractKeywords', () => {
  it('提取汉字/字母数字词元，过滤单字符', () => {
    expect(extractKeywords('状态管理 state mgmt')).toEqual(['状态管理', 'state', 'mgmt']);
    expect(extractKeywords('a 前端 b2')).toEqual(['前端', 'b2']);
  });

  it('标点分隔的词元各自独立', () => {
    expect(extractKeywords('前端-组件.规范')).toEqual(['前端', '组件', '规范']);
  });
});

describe('buildChineseNgrams', () => {
  it('生成 2-3 字 n-gram', () => {
    expect(buildChineseNgrams('状态管理')).toEqual(['状态', '态管', '管理', '状态管', '态管理']);
  });

  it('单字段落跳过；空白压缩后再切分', () => {
    expect(buildChineseNgrams('的')).toEqual([]);
    expect(buildChineseNgrams('状 态')).toEqual(['状态']);
  });

  it('非中文内容不产生 n-gram', () => {
    expect(buildChineseNgrams('state management')).toEqual([]);
  });
});

describe('buildLexicalQueries', () => {
  it('包含原查询 + AND 变体 + 关键词 + 长 n-gram（≥3 字）', () => {
    const queries = buildLexicalQueries('状态管理 规范');
    expect(queries).toContain('状态管理 规范');
    expect(queries).toContain('状态管理 AND 规范');
    expect(queries).toContain('状态管理');
    expect(queries).toContain('状态管');
    // 2 字 ngram 不进 lexical（避免 LIKE 误命中）
    expect(queries).not.toContain('状态');
  });

  it('单关键词无 AND 变体', () => {
    expect(buildLexicalQueries('frontend').some((q) => q.includes(' AND '))).toBe(false);
  });
});

describe('wrapFtsColumnQuery', () => {
  it('普通查询包裹列限定 + 短语引号', () => {
    expect(wrapFtsColumnQuery('前端')).toBe('{title content tags ngram}: "前端"');
  });

  it('AND 变体每项独立列限定', () => {
    expect(wrapFtsColumnQuery('a AND b')).toBe(
      '{title content tags ngram}: "a" AND {title content tags ngram}: "b"',
    );
  });

  it('双引号转义为 FTS5 合法形式', () => {
    expect(wrapFtsColumnQuery('say "hi"')).toBe('{title content tags ngram}: "say ""hi"""');
  });

  it('空白查询原样返回', () => {
    expect(wrapFtsColumnQuery('  ')).toBe('');
  });
});

describe('inferScopeWeight（spec 分层 project > user > global）', () => {
  it('项目级 > 用户级 > 全局级', () => {
    const project = inferScopeWeight('/home/u/.lattice/users/a/projects/p1/spec/x.md', 'spec');
    const user = inferScopeWeight('/home/u/.lattice/users/a/spec/x.md', 'spec');
    const global = inferScopeWeight('/home/u/.lattice/spec/x.md', 'spec');
    expect(project).toBeGreaterThan(user);
    expect(user).toBeGreaterThan(global);
  });

  it('非 spec 类型权重恒为 1', () => {
    expect(inferScopeWeight('/users/a/projects/p1/spec/x.md', 'task')).toBe(1);
  });

  it('Windows 路径分隔符兼容', () => {
    const w = inferScopeWeight('C:\\u\\.lattice\\users\\a\\projects\\p\\spec\\x.md', 'spec');
    expect(w).toBeGreaterThan(1);
  });
});

describe('getTypeWeight', () => {
  it('relation 降权，其余为 1', () => {
    expect(getTypeWeight('relation')).toBeLessThan(1);
    expect(getTypeWeight('spec')).toBe(1);
    expect(getTypeWeight('task')).toBe(1);
  });
});

describe('getTitleBoost', () => {
  it('精确命中 > 部分命中 > 关键词命中 > 无命中', () => {
    const exact = getTitleBoost('状态管理规范', '状态管理规范');
    const partial = getTitleBoost('状态管理', '状态管理规范');
    const keyword = getTitleBoost('状态管理 组件', '组件设计');
    const none = getTitleBoost('数据库', '组件设计');
    expect(exact).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(0);
    expect(none).toBe(0);
  });

  it('归一化后比较（忽略空白/标点/大小写）', () => {
    expect(getTitleBoost('State Management', 'state management')).toBe(
      getTitleBoost('statemanagement', 'statemanagement'),
    );
  });

  it('多关键词命中按数量叠加', () => {
    const one = getTitleBoost('组件 布局', '组件设计');
    const two = getTitleBoost('组件 布局', '组件布局设计');
    expect(two).toBeGreaterThan(one);
  });

  it('空查询/空标题 → 0', () => {
    expect(getTitleBoost('', 'x')).toBe(0);
    expect(getTitleBoost('x', '')).toBe(0);
  });
});

describe('normalizeTitleForGrouping', () => {
  it('小写 + 去空白 + 去标点，保留中英文数字', () => {
    expect(normalizeTitleForGrouping('Demo-App （测试）')).toBe('demoapp测试');
  });
});

function result(
  type: SearchResult['type'],
  title: string,
  score: number,
  filePath: string,
): SearchResult {
  return { type, title, snippet: '', score, meta: { filePath, projectIds: [] } };
}

describe('collapseDuplicateTitles（同名聚合）', () => {
  it('同 (type, 归一化标题) 合并进 duplicates，保留首条', () => {
    const collapsed = collapseDuplicateTitles([
      result('project', 'demo-app', 0.9, '/a/demo-app'),
      result('project', 'Demo App', 0.5, '/b/demo-app'),
      result('project', 'other', 0.4, '/c/other'),
    ]);
    expect(collapsed.length).toBe(2);
    expect(collapsed[0].meta.filePath, '保留首条（分高者）').toBe('/a/demo-app');
    expect(collapsed[0].meta.duplicateCount).toBe(1);
    const dups = collapsed[0].meta.duplicates as { filePath: string }[];
    expect(dups[0].filePath).toBe('/b/demo-app');
  });

  it('不同 type 同名不合并', () => {
    const collapsed = collapseDuplicateTitles([
      result('project', 'lattice', 0.9, '/p'),
      result('spec', 'lattice', 0.8, '/s'),
    ]);
    expect(collapsed.length).toBe(2);
  });

  it('无重复时每条补空 duplicates 字段', () => {
    const collapsed = collapseDuplicateTitles([result('spec', 'a', 1, '/a')]);
    expect(collapsed[0].meta.duplicates).toEqual([]);
    expect(collapsed[0].meta.duplicateCount).toBe(0);
  });
});
