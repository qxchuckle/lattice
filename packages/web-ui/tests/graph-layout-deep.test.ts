import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLayoutConfig, runLayout } from '../src/components/graph/layout';
import {
  estimateNodeSize,
  runRadialLayout,
  TYPE_RING,
} from '../src/components/graph/radial-layout';
import { runSequentialLayout } from '../src/components/graph/sequential-layout';
import { resolveOverlaps } from '../src/components/graph/overlap-resolution';

function makeNode(id: string, type = 'task', label?: string) {
  const node: Record<string, unknown> = {
    id: () => id,
    data: (key?: string) => {
      if (key === 'entityType') return type;
      if (key === 'label') return label ?? id;
      return { entityType: type, label: label ?? id };
    },
    position: vi.fn((pos?: { x: number; y: number }) => {
      if (pos) node.__pos = { ...pos };
      return node.__pos ?? { x: 10, y: 20 };
    }),
    width: () => 100,
    height: () => 40,
    degree: () => 2,
    addClass: vi.fn(),
    removeClass: vi.fn(),
  };
  return node;
}

function collection(arr: ReturnType<typeof makeNode>[]) {
  const fn = () => arr;
  Object.defineProperty(fn, 'length', { value: arr.length, configurable: true });
  return Object.assign(fn, {
    forEach: (cb: (n: unknown) => void) => arr.forEach(cb),
    eq: (i: number) => arr[i],
    removeClass: vi.fn(),
  });
}

function makeCy(nodeCount = 3, options: { failBatchOnce?: boolean } = {}) {
  const nodes = Array.from({ length: nodeCount }, (_, i) =>
    makeNode(`n${i}`, ['project', 'spec', 'task'][i % 3], i === 0 ? '项目' : `节点 ${i}`),
  );
  const edges = [
    {
      source: () => ({ length: 1, id: () => nodes[0].id() }),
      target: () => ({ length: 1, id: () => nodes[1].id() }),
    },
    {
      source: () => ({ length: 0, id: () => 'ghost' }),
      target: () => ({ length: 1, id: () => nodes[1].id() }),
    },
  ];
  const invalid = [edges[1]];
  const edgeRemove = vi.fn();
  let failBatch = options.failBatchOnce ?? false;
  const cy = {
    nodes: () => collection(nodes),
    edges: () => {
      const list = [...edges];
      return Object.assign(list, {
        filter: (pred: (e: unknown) => boolean) => {
          const filtered = Array.prototype.filter.call(list, pred);
          return Object.assign(filtered, { remove: edgeRemove });
        },
      });
    },
    batch: vi.fn((cb: () => void) => {
      if (failBatch) {
        failBatch = false;
        throw new Error('batch failed');
      }
      cb();
    }),
    layout: vi.fn(() => ({
      one: (event: string, cb: () => void) => {
        if (event === 'layoutstop') cb();
      },
    })),
    fit: vi.fn(),
    elements: () => ({ length: 3 }),
    animate: vi.fn(),
    zoom: () => 1,
    container: () => ({ clientWidth: 800, clientHeight: 600 }),
    getElementById: (id: string) =>
      nodes.find((n) => n.id() === id) ?? { length: 0, data: () => ({}) },
  };
  return { cy, nodes, invalid, edgeRemove };
}

let clock = 0;
beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
    clock += 16;
    cb(clock);
    return 1;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('buildLayoutConfig', () => {
  it('顺序/径向/力导向与增量、跳过动画、保留视口参数', () => {
    const sequential = buildLayoutConfig(10, 'sequential', true, true) as Record<string, unknown>;
    expect(sequential.name).toBe('breadthfirst');
    expect(sequential.animate).toBe(false);
    expect(sequential.fit).toBe(false);
    expect(sequential.spacingFactor).toBeCloseTo(1.5);

    const radial = buildLayoutConfig(100, 'radial', false, false) as Record<string, unknown>;
    expect(radial.name).toBe('concentric');
    expect(radial.animate).toBe('end');
    expect(radial.minNodeSpacing).toBe(60);
    expect((radial.levelWidth as () => number)()).toBe(2);
    expect(
      (radial.concentric as (e: { degree: () => number }) => number)({ degree: () => 3 }),
    ).toBe(3);

    const force = buildLayoutConfig(100, 'force', false, false, true) as Record<string, unknown>;
    expect(force.name).toBe('fcose');
    expect(force.animate).toBe('end');
    expect(force.randomize).toBe(false);
    expect(force.gravity).toBe(0.35);
    expect(force.nodeRepulsion).toBe(60000);

    const big = buildLayoutConfig(1000, 'force') as Record<string, unknown>;
    expect(big.nodeRepulsion).toBe(300000);
    expect(big.idealEdgeLength).toBe(450);
    expect(big.numIter).toBe(6000);

    const tiny = buildLayoutConfig(1, 'force') as Record<string, unknown>;
    expect(tiny.nodeRepulsion).toBe(20000);
    expect(tiny.idealEdgeLength).toBe(150);
    expect(tiny.numIter).toBe(2500);
  });
});

describe('estimateNodeSize / radial / sequential', () => {
  it('中英文/超长文本估算与最小尺寸', () => {
    expect(estimateNodeSize('abc')).toEqual({ w: 60, h: 30 });
    expect(estimateNodeSize('中文').w).toBe(60);
    const long = estimateNodeSize('a'.repeat(1000));
    expect(long.w).toBe(204);
    expect(long.h).toBeGreaterThan(30);
    const cjkLong = estimateNodeSize('中'.repeat(100));
    expect(cjkLong.w).toBe(204);
  });

  it('径向：空图/单项目/多项目/多层/未知类型/子环', () => {
    const empty = makeCy(0);
    runRadialLayout(empty.cy as never, 0, vi.fn());

    const single = makeCy(1);
    runRadialLayout(single.cy as never, 1, vi.fn());
    expect(single.nodes[0].position()).toEqual({ x: 0, y: 0 });

    const mixed = Array.from({ length: 25 }, (_, i) =>
      makeNode(`m${i}`, i < 15 ? 'spec' : 'task', i === 0 ? undefined : `很长的节点标签 ${i}`),
    );
    const mixedCy = {
      ...makeCy(0).cy,
      nodes: () => collection(mixed),
    };
    const done = vi.fn();
    runRadialLayout(mixedCy as never, mixed.length, done);
    expect(done).toHaveBeenCalled();
    expect(mixed.every((n) => n.position)).toBeTruthy();

    const projects = [makeNode('p1', 'project'), makeNode('p2', 'project')];
    const projectCy = {
      ...makeCy(0).cy,
      nodes: () => collection(projects),
    };
    runRadialLayout(projectCy as never, 2, vi.fn());
    expect(TYPE_RING.project).toBe(0);
  });

  it('顺序：空图/多层/长标签换行', () => {
    runSequentialLayout(makeCy(0).cy as never, 0, vi.fn());
    const nodes = Array.from({ length: 60 }, (_, i) =>
      makeNode(
        `s${i}`,
        i % 3 === 0 ? 'project' : i % 3 === 1 ? 'spec' : 'task',
        `节点-${i}-${'x'.repeat(30)}`,
      ),
    );
    const cy = {
      ...makeCy(0).cy,
      nodes: () => collection(nodes),
    };
    const done = vi.fn();
    runSequentialLayout(cy as never, nodes.length, done);
    expect(done).toHaveBeenCalled();
  });
});

describe('runLayout', () => {
  it('清理无效边 + 径向（跳过动画/动画）', () => {
    const radialSkip = makeCy(3);
    const done = vi.fn();
    runLayout(radialSkip.cy as never, 3, 'radial', done, true, false);
    expect(radialSkip.invalid[0]).toBeTruthy();
    expect(radialSkip.edgeRemove).toHaveBeenCalled();
    expect(radialSkip.cy.fit).toHaveBeenCalled();
    expect(done).toHaveBeenCalled();

    const radialAnim = makeCy(3);
    runLayout(radialAnim.cy as never, 3, 'radial', vi.fn(), false, true);
    expect(radialAnim.cy.animate).toHaveBeenCalledWith(
      expect.objectContaining({ fit: expect.any(Object), duration: 200 }),
    );
  });

  it('顺序成功与失败回退力导向', () => {
    const seq = makeCy(3);
    const done = vi.fn();
    runLayout(seq.cy as never, 3, 'sequential', done, true, false);
    expect(seq.cy.fit).toHaveBeenCalled();
    expect(done).toHaveBeenCalled();

    const failed = makeCy(3, { failBatchOnce: true });
    const fallbackDone = vi.fn();
    runLayout(failed.cy as never, 3, 'sequential', fallbackDone, true, false);
    expect(failed.cy.layout).toHaveBeenCalled();
    expect(fallbackDone).toHaveBeenCalled();
  });

  it('力导向：首次跳跃/动画过渡/保留视口', () => {
    const first = makeCy(3);
    const done = vi.fn();
    runLayout(first.cy as never, 3, 'force', done, true, false);
    expect(first.cy.fit).toHaveBeenCalled();
    expect(done).toHaveBeenCalled();

    const animated = makeCy(3);
    const animDone = vi.fn();
    runLayout(animated.cy as never, 3, 'force', animDone, false, false, true);
    expect(animated.cy.animate).toHaveBeenCalled();
    expect(animDone).toHaveBeenCalled();

    const preserved = makeCy(3);
    runLayout(preserved.cy as never, 3, 'force', vi.fn(), true, true);
    expect(preserved.cy.fit).not.toHaveBeenCalled();
  });

  it('resolveOverlaps 重叠推送与无节点早退', () => {
    const empty = makeCy(0);
    resolveOverlaps(empty.cy as never);

    const cy = makeCy(4).cy;
    resolveOverlaps(cy as never, { minSpacing: 400 });
    expect(cy.batch).toHaveBeenCalled();
  });
});
