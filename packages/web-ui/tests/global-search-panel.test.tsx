import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { GlobalSearchPanel } from '../src/components/GlobalSearchPanel';
import { setAdapter } from '../src/adapters';
import { canvasStore, cyRef, globalSearchStore, themeStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

vi.mock('../src/components/graph/layout', () => ({
  applyFocus: vi.fn(),
  clearFocus: vi.fn(),
}));

const results = [
  {
    type: 'project',
    title: '项目 Alpha',
    snippet: '项目摘要',
    meta: { id: 'legacy:p1' },
  },
  {
    type: 'spec',
    title: '规范 Alpha',
    snippet: '',
    meta: { filePath: '/u/spec/alpha.md' },
  },
  {
    type: 'task',
    title: '任务 Alpha',
    snippet: '任务摘要',
    meta: { id: 'task-1' },
  },
  {
    type: 'relation',
    title: '关联 Alpha',
    meta: {},
  },
];

function makeAdapter() {
  return {
    search: vi.fn(async (_q: string, opts?: { type?: string }) =>
      opts?.type ? results.filter((r) => r.type === opts.type) : results,
    ),
    getSpecs: vi.fn(async () => ({
      global: [
        {
          fileName: 'alpha.md',
          filePath: '/u/spec/alpha.md',
          frontmatter: { id: 'spec-alpha01', title: '规范 Alpha' },
        },
      ],
      user: [],
      project: [],
    })),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname}</div>;
}

function renderPanel() {
  return renderUi(
    <>
      <GlobalSearchPanel />
      <LocationProbe />
    </>,
  );
}

beforeEach(() => {
  installDomStubs();
  globalSearchStore.open = true;
  globalSearchStore.searchType = 'all';
  themeStore.mode = 'light';
  canvasStore.userFilter = [];
  canvasStore.focusDepth = 1;
});

afterEach(() => {
  cleanup();
  globalSearchStore.open = false;
  globalSearchStore.searchType = 'all';
  cyRef.current = null;
});

describe('GlobalSearchPanel', () => {
  it('关闭时不渲染；打开后输入触发防抖搜索并显示分组结果', async () => {
    globalSearchStore.open = false;
    const closed = renderPanel();
    expect(screen.queryByPlaceholderText(/搜索任务、项目、Spec/)).toBeNull();
    closed.unmount();

    globalSearchStore.open = true;
    setAdapter(makeAdapter() as never);
    renderPanel();
    const input = screen.getByPlaceholderText(/搜索任务、项目、Spec/);
    fireEvent.change(input, { target: { value: 'Alpha' } });

    await waitFor(() => expect(screen.getByText('项目 Alpha')).toBeTruthy(), { timeout: 3000 });
    // 手风琴：默认展开第一个分组，切换到任务组
    fireEvent.click(screen.getByText(/任务（1）/));
    expect(screen.getByText('任务 Alpha')).toBeTruthy();
    expect(screen.queryByText('项目 Alpha')).toBeNull();
    fireEvent.click(screen.getByText(/Spec（1）/));
    expect(screen.getByText('规范 Alpha')).toBeTruthy();
  });

  it('类型筛选条切换为单组列表；键盘上下与 Enter 导航', async () => {
    setAdapter(makeAdapter() as never);
    renderPanel();
    const input = screen.getByPlaceholderText(/搜索任务、项目、Spec/);
    fireEvent.change(input, { target: { value: 'Alpha' } });
    await waitFor(() => expect(screen.getByText('项目 Alpha')).toBeTruthy(), { timeout: 3000 });

    fireEvent.click(screen.getAllByText('任务')[0]);
    await waitFor(() => expect(screen.getByText('任务 Alpha')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByText('项目 Alpha')).toBeNull();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('task'));

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(globalSearchStore.open).toBe(false);
  });

  it('画布存在匹配节点：点击结果选中并定位；无画布节点时仅导航', async () => {
    setAdapter(makeAdapter() as never);
    const node = {
      length: 1,
      id: () => 'task-1',
      data: () => ({ entityType: 'task', taskId: 'task-1', title: '任务 Alpha' }),
      position: () => ({ x: 1, y: 2 }),
    };
    cyRef.current = {
      getElementById: vi.fn((id: string) => (id === 'task-1' ? node : { length: 0 })),
      nodes: () => ({ forEach: vi.fn() }),
    } as never;
    canvasStore.userFilter = ['u1', 'u2'];
    renderPanel();
    const input = screen.getByPlaceholderText(/搜索任务、项目、Spec/);
    fireEvent.change(input, { target: { value: 'Alpha' } });
    await waitFor(() => expect(screen.getByText(/任务（1）/)).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(screen.getByText(/任务（1）/));
    await waitFor(() => expect(screen.getByText('任务 Alpha')).toBeTruthy());
    fireEvent.click(screen.getByText('任务 Alpha'));
    expect(canvasStore.selectedNodeId).toBe('task-1');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('task-1'));

    cyRef.current = null;
    fireEvent.change(input, { target: { value: 'Alpha ' } });
    await waitFor(() => expect(screen.getByText('项目 Alpha')).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(screen.getByText('项目 Alpha'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('project'));
  });

  it('无匹配显示空态；hover 更新选中', async () => {
    setAdapter({
      search: vi.fn(async () => []),
      getSpecs: vi.fn(async () => ({ global: [], user: [], project: [] })),
    } as never);
    renderPanel();
    const input = screen.getByPlaceholderText(/搜索任务、项目、Spec/);
    fireEvent.change(input, { target: { value: 'None' } });
    await waitFor(() => expect(screen.getByText(/无搜索结果/)).toBeTruthy(), { timeout: 3000 });
  });
});
