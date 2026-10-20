import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Minimap } from '../src/components/Minimap';
import {
  canvasSearchStore,
  canvasStore,
  cyRef,
  detailStore,
  themeStore,
  toggleMinimap,
} from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

function makeCtx() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
}

function makeCy() {
  const mkNode = (id: string, type: string, x: number, y: number, selected = false) => ({
    id: () => id,
    data: () => ({ entityType: type, label: id }),
    position: () => ({ x, y }),
    width: () => 20,
    height: () => 10,
    hasClass: (c: string) => selected && c === 'dimmed',
    addClass: vi.fn(),
    removeClass: vi.fn(),
  });
  const nodes = [
    mkNode('n1', 'task', 20, 10),
    mkNode('n2', 'project', 50, 25),
    mkNode('n3', 'spec', 80, 40),
  ];
  const collection = {
    length: nodes.length,
    forEach: (cb: (n: unknown) => void) => nodes.forEach(cb),
    boundingBox: () => ({ x1: 0, y1: 0, x2: 100, y2: 50, w: 100, h: 50 }),
  };
  nodes.forEach((n) => {
    (n as unknown as { closedNeighborhood: () => unknown }).closedNeighborhood = () => collection;
  });
  const edges = [
    {
      source: () => ({ position: () => ({ x: 20, y: 10 }) }),
      target: () => ({ position: () => ({ x: 50, y: 25 }) }),
    },
  ];
  const edgeCollection = { length: 1, forEach: (cb: (e: unknown) => void) => edges.forEach(cb) };
  const cy = {
    nodes: () => collection,
    edges: () => edgeCollection,
    elements: () => collection,
    getElementById: vi.fn((id: string) => nodes.find((n) => n.id() === id) ?? { length: 0 }),
    container: () => ({ clientWidth: 800, clientHeight: 600 }),
    width: () => 800,
    height: () => 600,
    minZoom: () => 0.2,
    maxZoom: () => 4,
    zoom: vi.fn(() => 1),
    pan: vi.fn(() => ({ x: 0, y: 0 })),
    animate: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  cyRef.current = cy as never;
  return { cy, nodes, collection };
}

let ctx: ReturnType<typeof makeCtx>;
let getContext: ReturnType<typeof vi.spyOn>;
let raf: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installDomStubs();
  ctx = makeCtx();
  getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 208,
    height: 146,
    right: 208,
    bottom: 146,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  raf = vi.fn((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  canvasStore.canvasReady = true;
  canvasStore.minimapOpen = true;
  canvasStore.selectedNodeId = 'n2';
  canvasStore.visibleTypes = { task: true, project: true, spec: true };
  canvasSearchStore.matchIds = ['n2', 'n3'];
  canvasSearchStore.matchIndex = 0;
  detailStore.open = false;
  themeStore.mode = 'dark';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cyRef.current = null;
  canvasStore.canvasReady = false;
  canvasStore.minimapOpen = false;
  canvasStore.selectedNodeId = null;
  canvasSearchStore.matchIds = [];
  canvasSearchStore.matchIndex = -1;
  window.innerWidth = 1280;
  themeStore.mode = 'light';
});

describe('Minimap', () => {
  it('绘制节点/边/选中/搜索/可视区域，并更新图例计数', async () => {
    makeCy();
    const { container } = renderUi(<Minimap />);
    await waitFor(() => expect(ctx.clearRect).toHaveBeenCalled());
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(208);
    expect(canvas.height).toBe(146);
    await waitFor(() => expect(screen.getByTitle('隐藏 task 节点')).toBeTruthy());
    expect(screen.getByTitle('隐藏 project 节点')).toBeTruthy();
    expect(screen.getByTitle('隐藏 spec 节点')).toBeTruthy();
  });

  it('缩放条、图例显隐、拖拽导航、双击、悬停与收起/展开', async () => {
    const { cy } = makeCy();
    const { container } = renderUi(<Minimap />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    fireEvent.click(screen.getByTitle('缩小'));
    fireEvent.click(screen.getByTitle('放大'));
    fireEvent.click(screen.getByTitle('重置为 100%'));
    expect(cy.zoom).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('适配全部'));
    expect(cy.animate).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('聚焦到选中节点'));
    fireEvent.click(screen.getByTitle('缩放至选中节点及其关联节点'));

    fireEvent.click(screen.getByTitle('隐藏 task 节点'));
    expect(canvasStore.visibleTypes.task).toBe(false);
    await waitFor(() => expect(screen.getByTitle('显示 task 节点')).toBeTruthy());
    fireEvent.click(screen.getByTitle('显示 task 节点'));
    expect(canvasStore.visibleTypes.task).toBe(true);

    fireEvent.mouseDown(canvas, { clientX: 104, clientY: 73 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 70 });
    fireEvent.mouseUp(window);
    expect(cy.pan).toHaveBeenCalled();

    fireEvent.doubleClick(canvas, { clientX: 104, clientY: 73 });
    expect(cy.zoom).toHaveBeenCalledWith(
      expect.objectContaining({ level: expect.any(Number), position: expect.any(Object) }),
    );

    fireEvent.mouseMove(canvas, { clientX: 104, clientY: 73 });
    expect(cy.getElementById).toHaveBeenCalledWith('n2');
    fireEvent.mouseLeave(canvas);

    fireEvent.click(screen.getByTitle('收起全景导航'));
    await waitFor(() => expect(screen.getByTitle('展开全景导航')).toBeTruthy());
    fireEvent.click(screen.getByTitle('展开全景导航'));
    await waitFor(() => expect(canvasStore.minimapOpen).toBe(true));
  });

  it('快捷键 M 切换、输入焦点忽略；移动端/未就绪返回 null', async () => {
    makeCy();
    renderUi(<Minimap />);
    fireEvent.keyDown(window, { key: 'm' });
    expect(canvasStore.minimapOpen).toBe(false);
    toggleMinimap();
    fireEvent.keyDown(window, { key: 'M', metaKey: true });
    expect(canvasStore.minimapOpen).toBe(true);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'm' });
    expect(canvasStore.minimapOpen).toBe(true);
    input.remove();

    cleanup();
    canvasStore.canvasReady = false;
    const notReady = renderUi(<Minimap />);
    expect(notReady.container.textContent).toBe('');

    cleanup();
    canvasStore.canvasReady = true;
    window.innerWidth = 500;
    const mobile = renderUi(<Minimap />);
    expect(mobile.container.textContent).toBe('');
  });
});
