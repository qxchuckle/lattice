import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { FloatingStatusBar } from '../src/components/FloatingStatusBar';
import {
  adminStore,
  authStore,
  canvasStore,
  cyRef,
  globalSearchStore,
  terminalStore,
  themeStore,
} from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

function makeCy() {
  const bounds = { x1: 0, y1: 0, x2: 100, y2: 50, w: 100, h: 50 };
  const collection = {
    length: 2,
    boundingBox: () => bounds,
  };
  const node = {
    length: 1,
    position: () => ({ x: 10, y: 20 }),
    closedNeighborhood: () => collection,
  };
  const cy = {
    elements: () => collection,
    getElementById: vi.fn(() => node),
    container: () => ({ clientWidth: 800, clientHeight: 600 }),
    minZoom: () => 0.2,
    zoom: () => 1,
    animate: vi.fn(),
  };
  cyRef.current = cy as never;
  return cy;
}

beforeEach(() => {
  installDomStubs();
  themeStore.mode = 'light';
  canvasStore.selectedNodeId = 'n1';
  canvasStore.layoutMode = 'force';
  canvasStore.layoutRunning = true;
  terminalStore.open = false;
  terminalStore.collapsed = false;
  terminalStore.sessions = [];
  authStore.initialized = true;
  authStore.authEnabled = false;
  adminStore.open = false;
  globalSearchStore.open = false;
  window.innerWidth = 1280;
});

afterEach(() => {
  cleanup();
  cyRef.current = null;
  canvasStore.selectedNodeId = null;
  canvasStore.layoutRunning = false;
  terminalStore.sessions = [];
  adminStore.open = false;
  authStore.authEnabled = false;
  vi.unstubAllGlobals();
});

describe('FloatingStatusBar', () => {
  it('布局切换、缩放/聚焦、搜索/刷新/主题/终端/管理按钮与图例', async () => {
    const cy = makeCy();
    renderUi(<FloatingStatusBar />);

    fireEvent.click(screen.getByText('径向'));
    await waitFor(() => expect(canvasStore.layoutMode).toBe('radial'));

    const buttons = () => screen.getAllByRole('button');
    // fit selected + focus selected
    fireEvent.click(buttons()[0]);
    fireEvent.click(buttons()[1]);
    expect(cy.getElementById).toHaveBeenCalled();
    expect(cy.animate).toHaveBeenCalled();

    // 全局搜索 / 画布搜索 开 → 关
    fireEvent.click(buttons()[2]);
    expect(globalSearchStore.open).toBe(true);
    fireEvent.click(buttons()[2]);
    expect(globalSearchStore.open).toBe(false);

    // 刷新（不抛错即可）
    fireEvent.click(buttons()[4]);
    fireEvent.click(buttons()[5]);
    expect(themeStore.mode).toBe('dark');

    fireEvent.click(buttons()[6]);
    expect(terminalStore.open).toBe(true);

    // 无密码警告 + 管理按钮
    fireEvent.click(buttons()[7]);
    expect(adminStore.open).toBe(true);
    adminStore.open = false;
    fireEvent.click(buttons()[8]);
    expect(adminStore.open).toBe(true);

    // 图例 popover 渲染 GraphLegend
    fireEvent.click(buttons()[9]);
    await waitFor(() => expect(screen.getByText('节点结构')).toBeTruthy());
    expect(screen.getByText('[Task] [进行中]')).toBeTruthy();

    // 清除选中后 fit all 分支
    canvasStore.selectedNodeId = null;
    canvasStore.layoutRunning = false;
    await waitFor(() => expect(screen.getAllByRole('button').length).toBe(9));
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(cy.animate).toHaveBeenCalledTimes(3);
  });

  it('移动端渲染菜单按钮与换行布局；终端会话 badge', async () => {
    window.innerWidth = 500;
    makeCy();
    terminalStore.open = true;
    terminalStore.sessions = [{ id: 's1' } as never];
    const { container } = renderUi(<FloatingStatusBar />);
    await waitFor(() => expect(container.querySelector('.ant-badge-count')).toBeTruthy());
    expect(screen.getAllByRole('button').length).toBeGreaterThan(9);
    const bar = container.querySelector('.floating-status-bar') as HTMLElement;
    expect(bar.style.flexWrap).toBe('wrap');
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(adminStore.open).toBe(false);
  });
});
