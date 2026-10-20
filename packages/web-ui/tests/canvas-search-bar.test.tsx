import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { CanvasSearchBar } from '../src/components/CanvasSearchBar';
import { canvasSearchStore, canvasStore, closeCanvasSearch, cyRef, themeStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

vi.mock('../src/components/graph/layout', () => ({
  applyFocus: vi.fn(),
  clearFocus: vi.fn(),
}));

function makeNode(id: string, type: string, title: string) {
  return {
    id: () => id,
    data: () => ({ entityType: type, title, name: title, taskId: id, projectId: id, specId: id }),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    position: () => ({ x: 100, y: 50 }),
    length: 1,
  };
}

function installFakeCy() {
  const nodes = [
    makeNode('n1', 'task', 'Alpha 任务'),
    makeNode('n2', 'project', 'Beta 项目'),
    makeNode('n3', 'spec', 'Alpha 规范'),
  ];
  const collection = {
    length: nodes.length,
    forEach: (cb: (n: unknown) => void) => nodes.forEach(cb),
    removeClass: vi.fn(),
    addClass: vi.fn(),
  };
  const cy = {
    nodes: () => collection,
    batch: vi.fn((cb: () => void) => cb()),
    getElementById: (id: string) =>
      nodes.find((n) => n.id() === id) ?? { length: 0, data: () => ({}) },
    container: () => ({ clientWidth: 800, clientHeight: 600 }),
    zoom: () => 1,
    animate: vi.fn(),
    fit: vi.fn(),
  };
  cyRef.current = cy as never;
  return { cy, nodes, collection };
}

function openSearch() {
  canvasSearchStore.open = true;
  canvasSearchStore.query = '';
  canvasSearchStore.matchIds = [];
  canvasSearchStore.matchIndex = -1;
  canvasSearchStore.autoSelect = true;
}

beforeEach(() => {
  installDomStubs();
  openSearch();
  themeStore.mode = 'light';
  canvasStore.selectedNodeId = null;
  canvasStore.focusDepth = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  closeCanvasSearch();
  cyRef.current = null;
  themeStore.mode = 'light';
  vi.unstubAllGlobals();
});

describe('CanvasSearchBar', () => {
  it('关闭时不渲染；打开后 Enter 搜索、匹配计数与上下切换', async () => {
    canvasSearchStore.open = false;
    const closed = renderUi(<CanvasSearchBar />);
    expect(closed.container.textContent).toBe('');
    closed.unmount();

    openSearch();
    const { cy } = installFakeCy();
    renderUi(<CanvasSearchBar />);
    const input = screen.getByPlaceholderText(/搜索画布节点/);
    fireEvent.change(input, { target: { value: 'alpha' } });
    expect(canvasSearchStore.matchIds).toEqual([]);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(canvasSearchStore.matchIds).toEqual(['n1', 'n3']);
    expect(canvasSearchStore.matchIndex).toBe(0);
    await waitFor(() => expect(screen.getByText('1/2')).toBeTruthy());
    expect(cy.batch).toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(canvasSearchStore.matchIndex).toBe(1);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(canvasSearchStore.matchIndex).toBe(0);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(canvasSearchStore.matchIndex).toBe(1);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(canvasSearchStore.matchIndex).toBe(0);
    fireEvent.click(buttons[0]);
    expect(canvasSearchStore.matchIndex).toBe(1);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(canvasSearchStore.open).toBe(false);
  });

  it('修改查询清除旧匹配；仅聚焦模式取消选中并移动视口', async () => {
    installFakeCy();
    canvasStore.selectedNodeId = 'old';
    canvasSearchStore.autoSelect = false;
    renderUi(<CanvasSearchBar />);
    const input = screen.getByPlaceholderText(/搜索画布节点/);
    fireEvent.change(input, { target: { value: 'alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(canvasSearchStore.matchIds).toEqual(['n1', 'n3']);
    expect(canvasStore.selectedNodeId).toBeNull();
    await waitFor(() => expect(screen.getByText('1/2')).toBeTruthy());

    fireEvent.change(input, { target: { value: 'beta' } });
    expect(canvasSearchStore.matchIds).toEqual([]);
    await waitFor(() => expect(screen.getByText('0/0')).toBeTruthy());

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(canvasSearchStore.matchIds).toEqual(['n2']);
    await waitFor(() => expect(screen.getByText('1/1')).toBeTruthy());
  });

  it('IME 输入期间忽略 Enter；空查询与关闭按钮、仅聚焦复选框、暗色主题', async () => {
    themeStore.mode = 'dark';
    const { cy } = installFakeCy();
    const { container } = renderUi(<CanvasSearchBar />);
    const input = screen.getByPlaceholderText(/搜索画布节点/);

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(canvasSearchStore.matchIds).toEqual([]);
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: 'alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(canvasSearchStore.matchIds.length).toBe(2);

    const checkbox = screen.getByRole('checkbox');
    await waitFor(() => expect(screen.getByText('1/2')).toBeTruthy());
    fireEvent.click(checkbox);
    expect(canvasSearchStore.autoSelect).toBe(false);
    expect(cy.animate).toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(canvasSearchStore.matchIds).toEqual([]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const closeButton = screen.getAllByRole('button')[2];
    fireEvent.click(closeButton);
    expect(canvasSearchStore.open).toBe(false);
    await waitFor(() => expect(container.querySelector('#canvas-search-input')).toBeNull());
  });
});
