import { describe, expect, it } from 'vitest';
import type { ParsedSpec, SearchResult, TaskMeta } from '@qcqx/lattice-core';
import type { SearchFilters, ViewMode } from '../src/store';
import {
  extractSearchResultInfo,
  filterTree,
  filterTreeByKeywordAndFilters,
  flattenSearch,
  inferSpecScope,
  scopeLabelToValue,
  scopeValueToLabel,
  type TreeNode,
} from '../src/components/sidebar/treeUtils';

// ── fixtures ──

function item(
  key: string,
  title: string,
  type: TreeNode['type'],
  extra: Partial<TreeNode> = {},
): TreeNode {
  return { key, title, type, ...extra };
}

function makeTree(): TreeNode[] {
  return [
    {
      key: 'spec-root',
      title: '规范树 (3)',
      type: 'spec-root',
      children: [
        item('s1', '全局规范', 'spec-item', { meta: { scope: '全局级' } }),
        item('s2', '用户规范', 'spec-item', { meta: { scope: '用户级' } }),
        item('s3', '项目规范', 'spec-item', { meta: { scope: '项目级' } }),
      ],
    },
    {
      key: 'task-root',
      title: '任务树 (2)',
      type: 'task-root',
      children: [
        item('t1', '进行中任务', 'task-item', { meta: { status: 'in_progress' } }),
        item('t2', '已完成任务', 'task-item', { meta: { status: 'completed' } }),
      ],
    },
    {
      key: 'project-root',
      title: '项目树 (1)',
      type: 'project-root',
      children: [
        {
          ...item('p1', '项目甲', 'project-item'),
          children: [item('pt1', '关联任务', 'task-item', { meta: { status: 'in_progress' } })],
        },
      ],
    },
  ];
}

function filters(partial: Partial<SearchFilters> = {}): SearchFilters {
  return { type: 'all', taskStatus: [], specScope: [], ...partial };
}

function keys(nodes: TreeNode[]): string[] {
  return nodes.map((n) => n.key);
}

// ── scope 辅助 ──

describe('spec scope 辅助', () => {
  it('inferSpecScope：项目/用户/全局/未知', () => {
    expect(inferSpecScope('/home/u/projects/proj/specs/a.md')).toBe('project');
    expect(inferSpecScope('/home/u/specs/a.md')).toBe('global');
    expect(inferSpecScope('/x/user/spec/a.md')).toBe('user');
    expect(inferSpecScope('/tmp/other/a.md')).toBe('');
  });

  it('scope 值 ↔ 中文标签往返；未知返回空串', () => {
    for (const [value, label] of [
      ['global', '全局级'],
      ['user', '用户级'],
      ['project', '项目级'],
    ] as const) {
      expect(scopeValueToLabel(value)).toBe(label);
      expect(scopeLabelToValue(label)).toBe(value);
    }
    expect(scopeValueToLabel('other')).toBe('');
    expect(scopeLabelToValue('其他')).toBe('');
  });
});

// ── extractSearchResultInfo ──

describe('extractSearchResultInfo', () => {
  function res(type: string, meta: Record<string, unknown> = {}, title = '标题'): SearchResult {
    return { type, title, meta } as unknown as SearchResult;
  }

  it('优先 meta 直取 ID 并映射视角', () => {
    expect(extractSearchResultInfo(res('task', { id: 't-1' }))).toEqual({
      id: 't-1',
      mode: 'task',
    });
    expect(extractSearchResultInfo(res('project', { projectId: 'legacy:p1' }))).toEqual({
      id: 'legacy:p1',
      mode: 'project',
    });
    expect(extractSearchResultInfo(res('spec', { specId: 'spec-abcd1234' }))).toEqual({
      id: 'spec-abcd1234',
      mode: 'spec',
    });
    expect(extractSearchResultInfo(res('relation', { id: 'rel-1' }))).toEqual({
      id: 'rel-1',
      mode: 'global',
    });
  });

  it('spec 走 specIdByPath；project 走 projectIds[0]；task/spec 从 filePath 提取', () => {
    const map = new Map([['/u/specs/x.md', 'spec-aaaaaaaa']]);
    expect(extractSearchResultInfo(res('spec', { filePath: '/u/specs/x.md' }), map)).toEqual({
      id: 'spec-aaaaaaaa',
      mode: 'spec',
    });
    expect(extractSearchResultInfo(res('project', { projectIds: ['p1', 'p2'] }))).toEqual({
      id: 'p1',
      mode: 'project',
    });
    expect(
      extractSearchResultInfo(res('task', { filePath: '/u/task/2026-01-01-abcd/task.json' })),
    ).toEqual({
      id: '2026-01-01-abcd',
      mode: 'task',
    });
    expect(extractSearchResultInfo(res('checkpoint', { filePath: '/u/task/t9/cp.json' }))).toEqual({
      id: 't9',
      mode: 'task',
    });
    expect(extractSearchResultInfo(res('spec', { filePath: '/u/spec/y.md' }))).toEqual({
      id: 'y.md',
      mode: 'spec',
    });
    expect(extractSearchResultInfo(res('spec', { filePath: '/no/match' }, '兜底标题'))).toEqual({
      id: '兜底标题',
      mode: 'spec',
    });
  });
});

// ── filterTree ──

describe('filterTree（纯关键词）', () => {
  it('空关键词原样返回（引用不变）', () => {
    const tree = makeTree();
    expect(filterTree(tree, '')).toBe(tree);
  });

  it('标题命中或子节点命中都保留；保留原 children 当子树无命中', () => {
    const byTitle = filterTree(makeTree(), '项目');
    // spec-root 经子节点「项目规范」命中保留；project-root 标题命中保留原 children
    expect(keys(byTitle)).toEqual(['spec-root', 'project-root']);
    expect(byTitle[0].children?.map((c) => c.key)).toEqual(['s3']);
    expect(byTitle[1].children).toHaveLength(1);

    const byChild = filterTree(makeTree(), '已完成');
    expect(keys(byChild)).toEqual(['task-root']);
    expect(byChild[0].children?.map((c) => c.key)).toEqual(['t2']);
  });

  it('大小写不敏感', () => {
    const tree = [item('x', 'Fix Login Bug', 'task-item')];
    expect(filterTree(tree, 'LOGIN')).toHaveLength(1);
  });
});

// ── filterTreeByKeywordAndFilters ──

describe('filterTreeByKeywordAndFilters', () => {
  it('无关键词且无筛选 → 原样返回', () => {
    const tree = makeTree();
    expect(filterTreeByKeywordAndFilters(tree, '', filters())).toBe(tree);
  });

  it('类型筛选：task 顶层保留 task-root/project-root；非顶层过滤 spec-item', () => {
    const result = filterTreeByKeywordAndFilters(makeTree(), '', filters({ type: 'task' }));
    expect(keys(result)).toEqual(['task-root', 'project-root']);
    const projectChildren = result[1].children?.[0].children ?? [];
    expect(projectChildren.map((c) => c.key)).toEqual(['pt1']);
  });

  it('任务状态筛选：仅 task-item 受影响', () => {
    const result = filterTreeByKeywordAndFilters(
      makeTree(),
      '',
      filters({ taskStatus: ['completed'] }),
    );
    const taskRoot = result.find((n) => n.key === 'task-root')!;
    expect(taskRoot.children?.map((c) => c.key)).toEqual(['t2']);
    // spec 项不受任务状态影响
    expect(keys(result)).toContain('spec-root');
  });

  it('spec scope 筛选：按中文标签转值匹配', () => {
    const result = filterTreeByKeywordAndFilters(
      makeTree(),
      '',
      filters({ specScope: ['project'] }),
    );
    const specRoot = result.find((n) => n.key === 'spec-root')!;
    expect(specRoot.children?.map((c) => c.key)).toEqual(['s3']);
  });

  it('关键词 + 类型筛选：容器计数按直接子节点更新，item 节点保留', () => {
    const result = filterTreeByKeywordAndFilters(makeTree(), '任务', filters({ type: 'task' }));
    // task-root 标题计数更新为 2
    expect(result[0].title).toBe('任务树 (2)');
    // project-root 自身标题不匹配，但子任务匹配 → 保留并更新计数
    const projectRoot = result.find((n) => n.key === 'project-root');
    expect(projectRoot?.children?.map((c) => c.key)).toEqual(['p1']);
  });

  it('纯筛选（无关键词）：item 节点即使子节点被清空也保留', () => {
    const result = filterTreeByKeywordAndFilters(makeTree(), '', filters({ type: 'spec' }));
    expect(keys(result)).toEqual(['spec-root', 'project-root']);
    // project-item 是 item 节点 → 保留（其 task 子节点被类型筛掉）
    expect(result[1].children?.map((c) => c.key)).toEqual(['p1']);
  });
});

// ── flattenSearch ──

describe('flattenSearch（搜索结果分组 + 补全 + 筛选）', () => {
  function res(type: string, title: string, meta: Record<string, unknown> = {}): SearchResult {
    return { type, title, meta } as unknown as SearchResult;
  }

  const results = [
    res('project', '项目A', { projectId: 'legacy:p1' }),
    res('spec', '规范X', { filePath: '/u/specs/x.md' }),
    res('task', '任务Y', { filePath: '/u/task/t-y/task.json', domain: 'abcdef123456' }),
    res('design', '设计Z', { filePath: '/u/task/t-z/design.md' }),
    res('relation', '关系W', { id: 'rel-w' }),
  ];

  const tasks = [{ id: 't-y', status: 'completed' }] as unknown as TaskMeta[];
  const specs = [
    { filePath: '/u/specs/x.md', fileName: 'x.md', frontmatter: { id: 'spec-aaaaaaaa' } },
  ] as unknown as ParsedSpec[];

  it('按类型分组（项目/Spec/任务含 design/关联关系），补全 spec id、任务状态与域 hash8', () => {
    const tree = flattenSearch(results, undefined, tasks, specs);
    expect(tree.map((n) => n.key)).toEqual([
      'search-group-project',
      'search-group-spec',
      'search-group-task',
      'search-group-relation',
    ]);
    expect(tree.map((n) => n.title)).toEqual([
      '项目（1）',
      'Spec（1）',
      '任务（2）',
      '关联关系（1）',
    ]);

    const specNode = tree[1].children![0];
    expect(specNode.entityId).toBe('spec-aaaaaaaa');
    expect(specNode.meta?.scope).toBe('全局级');

    const taskNode = tree[2].children!.find((c) => c.title === '任务Y')!;
    expect(taskNode.meta?.status).toBe('completed');
    expect(taskNode.meta?.domain).toBe('abcdef12');
    const designNode = tree[2].children!.find((c) => c.title === '设计Z')!;
    expect(designNode.entityId).toBe('t-z');
  });

  it('筛选：任务状态 / spec scope 过滤后组内计数同步', () => {
    const byStatus = flattenSearch(results, filters({ taskStatus: ['completed'] }), tasks, specs);
    const taskGroup = byStatus.find((n) => n.key === 'search-group-task')!;
    // design 类型不参与任务状态筛选（仅 meta.desc === 'task' 受影响）
    expect(taskGroup.children?.map((c) => c.title)).toEqual(['任务Y', '设计Z']);

    const byScope = flattenSearch(results, filters({ specScope: ['project'] }), tasks, specs);
    expect(byScope.find((n) => n.key === 'search-group-spec')).toBeUndefined();

    const userScope = flattenSearch(
      [res('spec', '用户规范', { filePath: '/x/user/spec/u.md' })],
      filters({ specScope: ['user'] }),
    );
    expect(userScope[0].children).toHaveLength(1);
  });

  it('空结果返回空数组', () => {
    expect(flattenSearch([], filters())).toEqual([]);
  });
});

// 占位：确保 ViewMode 类型被使用（类型口径守卫）
const _mode: ViewMode = 'global';
void _mode;
