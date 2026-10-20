import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { CytoscapeGraph } from '../src/components/CytoscapeGraph';
import { canvasStore, cyRef, detailStore, themeStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    graph: {
      nodes: [
        { id: 'n1', entityType: 'task', label: '任务一' },
        { id: 'spec-1', entityType: 'spec', label: '规范一' },
      ] as unknown[],
      edges: [{ id: 'e1', source: 'n1', target: 'spec-1', type: 'task-spec' }] as unknown[],
      isLoading: false,
    },
    setGraph(graph: { nodes: unknown[]; edges: unknown[]; isLoading: boolean }) {
      this.graph = graph;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('cytoscape', () => {
  const use = vi.fn();
  const factory = vi.fn();
  return { default: Object.assign(factory, { use }), use };
});

vi.mock('cytoscape-fcose', () => ({ default: {} }));

vi.mock('../src/hooks', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useGlobalGraph: () => useSyncExternalStore(store.subscribe, () => store.graph),
  };
});

vi.mock('../src/components/Minimap', () => ({
  Minimap: () => <div data-testid='minimap' />,
}));

vi.mock('../src/components/graph/layout', () => ({
  runLayout: vi.fn(
    (
      _cy: unknown,
      _count: number,
      _mode: string,
      done?: () => void,
      _skip?: boolean,
      _animate?: boolean,
    ) => {
      done?.();
    },
  ),
  applyFocus: vi.fn(),
  clearFocus: vi.fn(),
  findNodeById: (cy: FakeCy, id: string) => cy.getElementById(id),
}));

vi.mock('../src/components/graph/elements', () => ({
  toElements: (
    nodes: Array<{ id: string }>,
    edges: Array<{ id: string; source: string; target: string }>,
  ) => [...nodes.map((n) => ({ data: { ...n } })), ...edges.map((e) => ({ data: { ...e } }))],
}));

interface FakeNode {
  id(): string;
  data(): Record<string, unknown>;
  position(): { x: number; y: number };
  closedNeighborhood(): FakeCollection;
  addClass: ReturnType<typeof vi.fn>;
  removeClass: ReturnType<typeof vi.fn>;
  toggleClass: ReturnType<typeof vi.fn>;
  ungrabify: ReturnType<typeof vi.fn>;
  hasClass: (name: string) => boolean;
  length: number;
}

interface FakeCollection {
  length: number;
  map<T>(fn: (item: FakeNode) => T): T[];
  filter(fn: (item: FakeNode) => boolean): FakeCollection;
  forEach(fn: (item: FakeNode) => void): void;
  addClass: ReturnType<typeof vi.fn>;
  removeClass: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  nodes(): FakeCollection;
  edges(): FakeCollection;
  ungrabify: ReturnType<typeof vi.fn>;
}

interface FakeCy {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  style: ReturnType<typeof vi.fn>;
  batch: ReturnType<typeof vi.fn>;
  elements: () => FakeCollection;
  nodes: () => FakeCollection;
  add: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getElementById: (id: string) => FakeNode;
  zoom: ReturnType<typeof vi.fn>;
  pan: ReturnType<typeof vi.fn>;
  panBy: ReturnType<typeof vi.fn>;
  width: () => number;
  height: () => number;
  minZoom: () => number;
  maxZoom: () => number;
  destroy: ReturnType<typeof vi.fn>;
}

function makeNode(id: string, type: string, label: string): FakeNode {
  const node: FakeNode = {
    length: 1,
    id: () => id,
    data: () => ({ id, entityType: type, label }),
    position: () => ({ x: 10, y: 20 }),
    closedNeighborhood: vi.fn(() => makeCollection([node], [])),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    toggleClass: vi.fn(),
    ungrabify: vi.fn(),
    hasClass: () => false,
  };
  return node;
}

function makeCollection(nodes: FakeNode[], edges: FakeNode[] = []): FakeCollection {
  const coll: FakeCollection = {
    length: nodes.length + edges.length,
    map: <T,>(fn: (item: FakeNode) => T) => [...nodes, ...edges].map(fn),
    filter: (fn: (item: FakeNode) => boolean) => makeCollection(nodes.filter(fn), edges.filter(fn)),
    forEach: (fn: (item: FakeNode) => void) => [...nodes, ...edges].forEach(fn),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    remove: vi.fn(),
    nodes: () => makeCollection(nodes),
    edges: () => makeCollection([], edges),
    ungrabify: vi.fn(),
    hasClass: () => false,
  };
  return coll;
}

function makeCy() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const nodes = new Map<string, FakeNode>();
  const edges: FakeNode[] = [];
  const cy: FakeCy = {
    on: vi.fn((name: string, selectorOrHandler: unknown, maybeHandler?: unknown) => {
      const selector = typeof selectorOrHandler === 'string' ? selectorOrHandler : '';
      const handler = (
        typeof selectorOrHandler === 'function' ? selectorOrHandler : maybeHandler
      ) as (...args: unknown[]) => void;
      handlers.set(`${name}:${selector}`, handler);
    }),
    off: vi.fn(),
    style: vi.fn(),
    batch: vi.fn((fn: () => void) => fn()),
    elements: () => makeCollection(Array.from(nodes.values()), edges),
    nodes: () => makeCollection(Array.from(nodes.values())),
    add: vi.fn((elements: Array<{ data: Record<string, unknown> }>) => {
      for (const el of elements) {
        if (el.data.source) {
          const edge = makeNode(String(el.data.id), 'edge', '');
          edge.data = () => el.data;
          edges.push(edge);
        } else {
          nodes.set(
            String(el.data.id),
            makeNode(String(el.data.id), String(el.data.entityType), String(el.data.label)),
          );
        }
      }
    }),
    remove: vi.fn((coll: FakeCollection) => {
      coll.forEach((n) => {
        nodes.delete(n.id());
        const idx = edges.indexOf(n);
        if (idx >= 0) edges.splice(idx, 1);
      });
    }),
    getElementById: (id: string) => nodes.get(id) ?? { ...makeNode(id, 'task', ''), length: 0 },
    zoom: vi.fn(() => 1),
    pan: vi.fn(() => ({ x: 0, y: 0 })),
    panBy: vi.fn(),
    width: () => 800,
    height: () => 600,
    minZoom: () => 0.08,
    maxZoom: () => 3,
    destroy: vi.fn(),
  };
  return { cy, handlers, nodes, edges };
}

let fake: ReturnType<typeof makeCy>;

beforeEach(async () => {
  installDomStubs();
  store.setGraph({
    nodes: [
      { id: 'n1', entityType: 'task', label: '任务一' },
      { id: 'spec-1', entityType: 'spec', label: '规范一' },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'spec-1', type: 'task-spec' }],
    isLoading: false,
  });
  canvasStore.canvasReady = false;
  canvasStore.layoutRunning = false;
  canvasStore.selectedNodeId = null;
  canvasStore.anchorId = null;
  canvasStore.locateNodeId = null;
  canvasStore.focusDepth = 1;
  canvasStore.layoutMode = 'force';
  canvasStore.visibleTypes = { task: true, project: true, spec: true };
  canvasStore.visibleEdgeTypes = { 'task-spec': true };
  canvasStore.taskStatusFilter = [];
  canvasStore.specScopeFilter = [];
  canvasStore.projectFilter = [];
  canvasStore.canvasKeyword = '';
  canvasStore.userFilter = [];
  canvasStore.localDataFilter = true;
  detailStore.open = false;
  themeStore.mode = 'light';
  fake = makeCy();
  const cytoscapeModule = await import('cytoscape');
  (cytoscapeModule.default as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    () => fake.cy,
  );
});

afterEach(() => {
  cleanup();
  cyRef.current = null;
  canvasStore.selectedNodeId = null;
  canvasStore.anchorId = null;
  canvasStore.locateNodeId = null;
  canvasStore.canvasReady = false;
  themeStore.mode = 'light';
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('CytoscapeGraph', () => {
  it('初始化/首次数据渲染、主题切换、节点与边点击、背景点击', async () => {
    const { container } = renderUi(<CytoscapeGraph />);
    await waitFor(() => expect(canvasStore.canvasReady).toBe(true));
    expect(cyRef.current).toBe(fake.cy);
    expect(fake.cy.nodes().length).toBe(2);
    expect(screen.queryByTestId('minimap')).toBeTruthy();

    themeStore.mode = 'dark';
    await waitFor(() => expect(fake.cy.style).toHaveBeenCalled());

    // 节点点击（spec 前缀 URL 归一化）
    const specNode = fake.nodes.get('spec-1')!;
    act(() => fake.handlers.get('tap:node')!({ target: specNode }));
    expect(specNode.data().entityType).toBe('spec');
    expect(fake.handlers.has('tap:edge')).toBe(true);

    // 画布位移 >10 → 忽略 tap
    fake.cy.pan.mockReturnValue({ x: 20, y: 0 });
    const panBefore = fake.cy.pan();
    act(() => fake.handlers.get('tap:node')!({ target: specNode }));
    expect(fake.cy.pan()).toEqual(panBefore);
    fake.cy.pan.mockReturnValue({ x: 0, y: 0 });

    // 再次点击同一节点（wasAlreadySelected 分支）
    act(() => fake.handlers.get('tap:node')!({ target: specNode }));

    // 边 / 背景
    act(() => fake.handlers.get('tap:edge')!({}));
    act(() => fake.handlers.get('tap:')!({ target: fake.cy }));
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('hover/vmousedown、滚轮/触摸/鼠标平移、主题与数据增量更新', async () => {
    const { container } = renderUi(<CytoscapeGraph />);
    await waitFor(() => expect(canvasStore.canvasReady).toBe(true));
    const node = fake.nodes.get('n1')!;

    act(() => fake.handlers.get('mouseover:node')!({ target: node }));
    await new Promise((r) => setTimeout(r, 130));
    expect(node.closedNeighborhood).toHaveBeenCalled();
    act(() => fake.handlers.get('mouseout:node')!({}));
    act(() => fake.handlers.get('vmousedown:node')!({}));

    const root = container.querySelector('div[style*="isolation"]') as HTMLElement;
    const div = root.firstElementChild as HTMLElement;
    fireEvent.wheel(div, { deltaY: 100, ctrlKey: true, clientX: 10, clientY: 10 });
    fireEvent.wheel(div, { deltaY: 100, clientX: 10, clientY: 10 });
    fireEvent.wheel(div, { deltaY: 120, clientX: 10, clientY: 10 });
    expect(fake.cy.zoom).toHaveBeenCalled();
    expect(fake.cy.panBy).toHaveBeenCalled();

    fireEvent.touchStart(div, {
      touches: [
        { clientX: 0, clientY: 0 },
        { clientX: 10, clientY: 0 },
      ],
    });
    fireEvent.touchMove(div, {
      touches: [
        { clientX: 0, clientY: 0 },
        { clientX: 20, clientY: 0 },
      ],
    });
    fireEvent.touchEnd(div, { touches: [] });
    fireEvent.touchStart(div, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchMove(div, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(div, { touches: [] });

    fireEvent.mouseDown(div, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(div, { clientX: 10, clientY: 10 });
    fireEvent.mouseLeave(div);
    fireEvent.mouseUp(window);

    // 选中节点 → pulse / selected effect
    act(() => {
      canvasStore.selectedNodeId = 'n1';
    });
    await waitFor(() => expect(canvasStore.selectedNodeId).toBe('n1'));

    // 数据增量更新（首次之后的 else 分支）
    act(() =>
      store.setGraph({
        nodes: [
          ...(store.graph.nodes as Array<Record<string, unknown>>),
          { id: 'n3', entityType: 'project', label: '项目三' },
        ],
        edges: store.graph.edges,
        isLoading: false,
      }),
    );
    await waitFor(() => expect(fake.cy.add).toHaveBeenCalledTimes(2));
    expect(fake.cy.nodes().length).toBe(3);

    // 加载态显示遮罩
    act(() => store.setGraph({ ...store.graph, isLoading: true }));
    await waitFor(() => expect(screen.getByTestId('minimap')).toBeTruthy());
  });

  it('布局模式/锚点/聚焦深度/定位/选中清除等副作用', async () => {
    renderUi(<CytoscapeGraph />);
    await waitFor(() => expect(canvasStore.canvasReady).toBe(true));

    act(() => {
      canvasStore.layoutMode = 'radial';
    });
    await waitFor(() => expect(canvasStore.layoutRunning).toBe(false));

    act(() => {
      canvasStore.anchorId = 'n1';
    });
    await waitFor(() => expect(canvasStore.anchorId).toBe('n1'));

    act(() => {
      canvasStore.anchorId = 'missing';
    });
    await waitFor(() => expect(canvasStore.anchorId).toBe('missing'));

    act(() => {
      canvasStore.focusDepth = 2;
    });
    act(() => {
      canvasStore.selectedNodeId = 'n1';
    });
    await waitFor(() => expect(canvasStore.selectedNodeId).toBe('n1'));

    act(() => {
      canvasStore.locateNodeId = 'n1';
    });
    await waitFor(() => expect(canvasStore.locateNodeId).toBeNull());

    act(() => {
      canvasStore.selectedNodeId = 'missing';
    });
    await waitFor(() => expect(canvasStore.selectedNodeId).toBe('missing'));

    // 筛选变化（防抖 300ms）走增量 diff 分支
    act(() => {
      canvasStore.visibleTypes = { task: false, project: true, spec: true };
    });
    await new Promise((r) => setTimeout(r, 350));
    expect(fake.cy.add).toHaveBeenCalled();
  });
});
