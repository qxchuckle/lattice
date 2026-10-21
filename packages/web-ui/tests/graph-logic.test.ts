import { afterEach, describe, expect, it, vi } from 'vitest';
import type cytoscape from 'cytoscape';
import { getNodeLabel, toElements } from '../src/components/graph/elements';
import {
  resolveOverlaps,
  resolveOverlapsContinuous,
} from '../src/components/graph/overlap-resolution';
import { buildLayoutConfig } from '../src/components/graph/layout';
import { setLanguage } from '../src/i18n';
import { getTaskStatusColor, getEntityColor } from '../src/lib';
import type { LatticeEdge, LatticeNode, LatticeNodeData } from '../src/types/graph';

// ── cytoscape 轻量 mock（只实现 overlap-resolution 用到的面） ──

interface FakeNode {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
}

interface FakeCyResult {
  cy: cytoscape.Core;
  positions: Map<string, { x: number; y: number }>;
  batchCalls: () => number;
}

function makeCy(nodes: FakeNode[], edges: Array<[string, string]> = []): FakeCyResult {
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) positions.set(n.id, { x: n.x, y: n.y });
  let batchCalls = 0;

  const makeNode = (n: FakeNode) => ({
    id: () => n.id,
    width: () => n.w ?? 0,
    height: () => n.h ?? 0,
    position: (p?: { x: number; y: number }) => {
      if (p) {
        positions.set(n.id, { x: p.x, y: p.y });
        return undefined;
      }
      return positions.get(n.id)!;
    },
  });

  const nodesCol = {
    length: nodes.length,
    forEach: (cb: (n: unknown) => void) => nodes.forEach((n) => cb(makeNode(n))),
    eq: (i: number) => makeNode(nodes[i]),
  };
  const edgesCol = {
    forEach: (cb: (e: unknown) => void) =>
      edges.forEach(([s, t]) =>
        cb({ source: () => ({ id: () => s }), target: () => ({ id: () => t }) }),
      ),
  };

  const cy = {
    nodes: () => nodesCol,
    edges: () => edgesCol,
    batch: (fn: () => void) => {
      batchCalls++;
      fn();
    },
  } as unknown as cytoscape.Core;

  return { cy, positions, batchCalls: () => batchCalls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── resolveOverlaps ──

describe('resolveOverlaps（同步防重叠）', () => {
  it('节点数 < 2 时直接返回，不触发 batch', () => {
    const { cy, positions, batchCalls } = makeCy([{ id: 'a', x: 0, y: 0 }]);
    resolveOverlaps(cy);
    expect(batchCalls()).toBe(0);
    expect(positions.get('a')).toEqual({ x: 0, y: 0 });
  });

  it('两个重叠节点沿最小重叠轴推开到无重叠', () => {
    // 同位置：w=100 → hw=50；h=40 → hh=20；padding=12
    const { cy, positions } = makeCy([
      { id: 'a', x: 0, y: 0, w: 100, h: 40 },
      { id: 'b', x: 0, y: 0, w: 100, h: 40 },
    ]);
    resolveOverlaps(cy);
    const a = positions.get('a')!;
    const b = positions.get('b')!;
    // 最小重叠轴为 y（52 < 112），最终 |dy| ≥ hh+hh+padding = 52
    expect(Math.abs(b.y - a.y)).toBeGreaterThanOrEqual(51.99);
    expect(a.x).toBe(0);
    expect(b.x).toBe(0);
  });

  it('minSpacing 密度扩展：非连接对两轴推开', () => {
    const { cy, positions } = makeCy([
      { id: 'a', x: 0, y: 0, w: 100, h: 40 },
      { id: 'b', x: 180, y: 0, w: 100, h: 40 },
    ]);
    resolveOverlaps(cy, { minSpacing: 100 });

    const a = positions.get('a')!;
    const b = positions.get('b')!;
    expect(Math.abs(b.x - a.x) - 100).toBeGreaterThanOrEqual(99);
    expect(Math.abs(b.y - a.y) - 40).toBeGreaterThanOrEqual(99);
  });

  it('有边连接的节点对：无 AABB 重叠时不被密度扩展推开', () => {
    const { cy, positions } = makeCy(
      [
        { id: 'c', x: 0, y: 0, w: 100, h: 40 },
        { id: 'd', x: 180, y: 0, w: 100, h: 40 },
      ],
      [['c', 'd']],
    );
    resolveOverlaps(cy, { minSpacing: 100 });
    expect(positions.get('c')).toEqual({ x: 0, y: 0 });
    expect(positions.get('d')).toEqual({ x: 180, y: 0 });
  });

  it('自定义 padding 生效', () => {
    const { cy, positions } = makeCy([
      { id: 'a', x: 0, y: 0, w: 100, h: 40 },
      { id: 'b', x: 0, y: 0, w: 100, h: 40 },
    ]);
    resolveOverlaps(cy, { padding: 0 });
    expect(Math.abs(positions.get('b')!.y - positions.get('a')!.y)).toBeGreaterThanOrEqual(39.99);
  });
});

// ── resolveOverlapsContinuous ──

describe('resolveOverlapsContinuous（逐帧防重叠）', () => {
  it('节点数 < 2 时同步回调 onDone', () => {
    const { cy } = makeCy([{ id: 'a', x: 0, y: 0 }]);
    const onDone = vi.fn();
    resolveOverlapsContinuous(cy, { onDone });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('逐帧迭代至收敛：位置被应用且 onDone 只回调一次', () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    const { cy, positions } = makeCy([
      { id: 'a', x: 0, y: 0, w: 100, h: 40 },
      { id: 'b', x: 0, y: 0, w: 100, h: 40 },
    ]);
    const onDone = vi.fn();
    resolveOverlapsContinuous(cy, { onDone });
    expect(onDone).not.toHaveBeenCalled();
    let guard = 0;
    while (rafQueue.length > 0 && guard++ < 10) rafQueue.shift()!(0);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(Math.abs(positions.get('b')!.y - positions.get('a')!.y)).toBeGreaterThanOrEqual(51.99);
  });

  it('超过 maxDuration 时停止并回调 onDone', () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    const { cy } = makeCy([
      { id: 'a', x: 0, y: 0, w: 100, h: 40 },
      { id: 'b', x: 0, y: 0, w: 100, h: 40 },
    ]);
    const onDone = vi.fn();
    resolveOverlapsContinuous(cy, { onDone, maxDuration: -1 });
    expect(rafQueue.length).toBe(1);
    rafQueue.shift()!(0);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(rafQueue.length).toBe(0);
  });
});

// ── buildLayoutConfig ──

describe('buildLayoutConfig', () => {
  it('sequential：breadthfirst + 间距随节点数收敛', () => {
    const cfg = buildLayoutConfig(50, 'sequential', false, false, false) as unknown as Record<
      string,
      unknown
    >;
    expect(cfg.name).toBe('breadthfirst');
    expect(cfg.spacingFactor).toBe(1.5);
    expect(cfg.animate).toBe('end');
    expect(cfg.animationDuration).toBe(500);
    expect(cfg.fit).toBe(true);

    const dense = buildLayoutConfig(1000, 'sequential') as unknown as Record<string, unknown>;
    expect(dense.spacingFactor).toBe(0.8);
  });

  it('radial：concentric + minNodeSpacing 收敛', () => {
    const cfg = buildLayoutConfig(30, 'radial', true, true) as unknown as Record<string, unknown>;
    expect(cfg.name).toBe('concentric');
    expect(cfg.minNodeSpacing).toBe(120);
    expect(cfg.animate).toBe(false);
    expect(cfg.animationDuration).toBe(0);
    expect(cfg.fit).toBe(false);
  });

  it('force：fcose 参数随节点数增长；增量模式降排斥/提重力', () => {
    const normal = buildLayoutConfig(100) as unknown as Record<string, unknown>;
    expect(normal.name).toBe('fcose');
    expect(normal.nodeRepulsion).toBe(120000);
    expect(normal.idealEdgeLength).toBe(280);
    expect(normal.numIter).toBe(2500);
    expect(normal.gravity).toBe(0.25);
    expect(normal.randomize).toBe(true);

    const incremental = buildLayoutConfig(100, 'force', false, false, true) as unknown as Record<
      string,
      unknown
    >;
    expect(incremental.nodeRepulsion).toBe(60000);
    expect(incremental.gravity).toBe(0.35);
    expect(incremental.randomize).toBe(false);

    const huge = buildLayoutConfig(1000) as unknown as Record<string, unknown>;
    expect(huge.nodeRepulsion).toBe(300000);
    expect(huge.idealEdgeLength).toBe(450);
    expect(huge.numIter).toBe(6000);
  });
});

// ── getNodeLabel ──

function nodeData(partial: Partial<LatticeNodeData>): LatticeNodeData {
  return { entityType: 'task', ...partial } as LatticeNodeData;
}

describe('getNodeLabel', () => {
  it('任务：类型 + 状态中文标签 + 标题；未知状态回退原值', () => {
    expect(
      getNodeLabel(nodeData({ entityType: 'task', title: '任务甲', status: 'completed' })),
    ).toBe('[Task][已完成]\n任务甲');
    expect(getNodeLabel(nodeData({ entityType: 'task', title: '', taskId: 't-1' }))).toBe(
      '[Task][规划中]\nt-1',
    );
    expect(
      getNodeLabel(nodeData({ entityType: 'task', title: '异常', status: 'weird' as never })),
    ).toBe('[Task][weird]\n异常');
  });

  it('英文宿主使用英文状态与 scope 标签', () => {
    setLanguage('en');
    try {
      expect(
        getNodeLabel(nodeData({ entityType: 'task', title: 'Task A', status: 'completed' })),
      ).toBe('[Task][Completed]\nTask A');
      expect(
        getNodeLabel(nodeData({ entityType: 'spec', title: 'Spec A', scope: 'project' })),
      ).toBe('[Spec][Project]\nSpec A');
    } finally {
      setLanguage('zh-cn');
    }
  });

  it('项目：git 标记；spec：scope 中文标签；未知类型走 [Node]', () => {
    expect(getNodeLabel(nodeData({ entityType: 'project', name: '项目甲', hasGit: true }))).toBe(
      '[Project][git]\n项目甲',
    );
    expect(getNodeLabel(nodeData({ entityType: 'project', name: '无 git' }))).toBe(
      '[Project]\n无 git',
    );
    expect(getNodeLabel(nodeData({ entityType: 'spec', title: '规范', scope: 'project' }))).toBe(
      '[Spec][项目级]\n规范',
    );
    expect(getNodeLabel(nodeData({ entityType: 'checkpoint' as never, title: '忽略' }))).toBe(
      '[Node]\nNode',
    );
  });

  it('多用户/域来源：追加 @用户·域 hash8 后缀', () => {
    const withUser = getNodeLabel(
      nodeData({ entityType: 'project', name: '项目', username: 'alice', domain: 'abcdef123456' }),
    );
    expect(withUser).toBe('[Project]\n项目\n@alice·域abcdef12');

    const domainOnly = getNodeLabel(
      nodeData({ entityType: 'project', name: '项目', domain: 'deadbeefcafe' }),
    );
    expect(domainOnly).toBe('[Project]\n项目\n@域deadbeef');

    const labeled = getNodeLabel(
      nodeData({
        entityType: 'project',
        name: '项目',
        domain: 'deadbeefcafe',
        domainLabel: '远端A',
      }),
    );
    expect(labeled).toBe('[Project]\n项目\n@域hmm'.replace('域hmm', '远端A'));
  });
});

// ── toElements ──

function ln(id: string, data: Partial<LatticeNodeData>): LatticeNode {
  return { id, data } as LatticeNode;
}
function le(id: string, source: string, target: string, label: string): LatticeEdge {
  return { id, source, target, label } as LatticeEdge;
}

const ALL_VISIBLE = { task: true, project: true, spec: true };

describe('toElements', () => {
  it('按可见类型过滤，并注入 label/color/isDomain', () => {
    const nodes = [
      ln('t1', { entityType: 'task', title: '任务', status: 'in_progress' }),
      ln('p1', { entityType: 'project', name: '项目', projectId: 'legacy:p1' }),
      ln('s1', { entityType: 'spec', title: '规范', scope: 'user' }),
    ];
    const result = toElements(nodes, [], { task: true, project: false, spec: true });
    const ids = result.map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['t1', 's1']);
    const taskData = result[0].data as Record<string, unknown>;
    expect(taskData.label).toBe('[Task][进行中]\n任务');
    expect(taskData.color).toBe(getTaskStatusColor('in_progress'));
    expect(taskData.isDomain).toBe('false');
    expect((result[1].data as Record<string, unknown>).color).toBe(getEntityColor('spec'));
  });

  it('localDataFilter=false：仅保留域来源节点（data.domain 存在）', () => {
    const nodes = [
      ln('local', { entityType: 'task', title: '本地' }),
      ln('remote', { entityType: 'task', title: '远端', domain: 'abcdef123456' }),
    ];
    const result = toElements(
      nodes,
      [],
      ALL_VISIBLE,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    );
    expect(result.map((e) => (e.data as { id: string }).id)).toEqual(['remote']);
    expect((result[0].data as Record<string, unknown>).isDomain).toBe('true');
  });

  it('任务状态 / spec scope / 项目范围筛选（项目级 spec 走 projectId 或 filePath 提取）', () => {
    const nodes = [
      ln('t1', {
        entityType: 'task',
        title: 'A',
        status: 'in_progress',
        projectIds: ['legacy:p1'],
      } as never),
      ln('t2', { entityType: 'task', title: 'B', status: 'completed' }),
      ln('s1', { entityType: 'spec', title: 'S1', scope: 'project', projectId: 'legacy:p2' }),
      ln('s2', {
        entityType: 'spec',
        title: 'S2',
        scope: 'project',
        filePath: '/home/u/projects/legacy:p1/spec/x.md',
      }),
      ln('s3', { entityType: 'spec', title: 'S3', scope: 'user' }),
      ln('p1', { entityType: 'project', name: 'P1', projectId: 'legacy:p1' }),
    ];

    // 状态筛选
    const byStatus = toElements(nodes, [], ALL_VISIBLE, undefined, ['completed']);
    expect(byStatus.map((e) => (e.data as { id: string }).id)).toEqual([
      't2',
      's1',
      's2',
      's3',
      'p1',
    ]);

    // spec scope 筛选
    const byScope = toElements(nodes, [], ALL_VISIBLE, undefined, undefined, ['user']);
    expect(byScope.map((e) => (e.data as { id: string }).id)).toEqual(['t1', 't2', 's3', 'p1']);

    // 项目筛选：project 命中 p1；task 经 projectIds 命中；项目级 spec 经 filePath 命中；用户级 spec 不受影响
    const byProject = toElements(nodes, [], ALL_VISIBLE, undefined, undefined, undefined, [
      'legacy:p1',
    ]);
    expect(byProject.map((e) => (e.data as { id: string }).id).sort()).toEqual(
      ['p1', 's2', 's3', 't1'].sort(),
    );
  });

  it('关键字筛选不区分大小写，只匹配 title/name', () => {
    const nodes = [
      ln('t1', { entityType: 'task', title: 'Fix Login Bug' }),
      ln('p1', { entityType: 'project', name: '登录项目' }),
      ln('s1', { entityType: 'spec', title: '其他' }),
    ];
    const result = toElements(
      nodes,
      [],
      ALL_VISIBLE,
      undefined,
      undefined,
      undefined,
      undefined,
      'LOGIN',
    );
    expect(result.map((e) => (e.data as { id: string }).id)).toEqual(['t1']);
  });

  it('边：仅保留两端可见的边；visibleEdgeTypes 按 label 归一化（- → _）过滤', () => {
    const nodes = [
      ln('a', { entityType: 'task', title: 'A' }),
      ln('b', { entityType: 'task', title: 'B' }),
      ln('c', { entityType: 'project', name: 'C' }),
    ];
    const edges = [
      le('e1', 'a', 'b', 'depends-on'),
      le('e2', 'a', 'c', 'belongs-to'),
      le('e3', 'a', 'missing', 'depends-on'),
    ];
    const all = toElements(nodes, edges, ALL_VISIBLE);
    expect(
      all
        .filter((e) => !('source' in (e.data as object)))
        .map((e) => (e.data as { id: string }).id),
    ).toEqual(['a', 'b', 'c']);
    expect(
      all.filter((e) => 'source' in (e.data as object)).map((e) => (e.data as { id: string }).id),
    ).toEqual(['e1', 'e2']);

    const filtered = toElements(nodes, edges, ALL_VISIBLE, { depends_on: true });
    expect(
      filtered
        .filter((e) => 'source' in (e.data as object))
        .map((e) => (e.data as { id: string }).id),
    ).toEqual(['e1']);
  });
});
