import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { TreeBrowserSidebar } from '../src/components/sidebar/TreeBrowserSidebar';
import { setLanguage } from '../src/i18n';
import { canvasStore, sidebarStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

const state = vi.hoisted(() => ({
  mobile: false,
  tree: [] as unknown[],
  searchData: [] as unknown[],
  searchLoading: false,
  users: { users: ['alice', 'bob'], currentUser: 'alice' },
  domains: null as unknown,
}));

vi.mock('../src/hooks', () => ({
  useSearch: () => ({ data: state.searchData, isLoading: state.searchLoading }),
  useUsers: () => ({ data: state.users }),
  useIsMobile: () => state.mobile,
  useDomainsData: () => ({ data: state.domains }),
}));

vi.mock('../src/components/sidebar/treeData', () => ({
  useTreeData: () => ({ tree: state.tree, loading: false, tasks: [], specs: [] }),
}));

function makeTree() {
  return [
    {
      key: 'root-spec',
      title: '规范根',
      type: 'spec-root',
      children: [
        {
          key: 'spec-scope-user',
          title: '用户级',
          type: 'spec-scope',
          children: [
            {
              key: 'spec-a',
              title: '规范A',
              type: 'spec-item',
              entityId: 'spec-a',
              viewMode: 'spec',
              meta: { scope: '用户级' },
            },
          ],
        },
      ],
    },
    {
      key: 'root-project',
      title: '项目根',
      type: 'project-root',
      children: Array.from({ length: 7 }, (_, i) => ({
        key: `proj-${i + 1}`,
        title: `项目${i + 1}`,
        type: 'project-item',
        entityId: `p${i + 1}`,
        viewMode: 'project',
      })),
    },
    {
      key: 'root-task',
      title: '任务根',
      type: 'task-root',
      children: [
        {
          key: 'task-t1',
          title: '任务一',
          type: 'task-item',
          entityId: 't1',
          viewMode: 'task',
          meta: { status: 'in_progress' },
        },
      ],
    },
  ];
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname}</div>;
}

function checkboxByText(text: string | RegExp): HTMLInputElement {
  const cb = screen.getAllByRole('checkbox').find((item) => {
    const label = item.closest('label');
    const content = label?.textContent ?? '';
    return typeof text === 'string' ? content.includes(text) : text.test(content);
  });
  if (!cb) throw new Error(`checkbox not found: ${text}`);
  return cb as HTMLInputElement;
}

function checkboxByTextLast(text: string | RegExp): HTMLInputElement {
  const all = screen.getAllByRole('checkbox').filter((item) => {
    const content = item.closest('label')?.textContent ?? '';
    return typeof text === 'string' ? content.includes(text) : text.test(content);
  });
  const cb = all.at(-1);
  if (!cb) throw new Error(`checkbox not found: ${text}`);
  return cb as HTMLInputElement;
}

function clickTypeOption(container: HTMLElement, index: number) {
  const options = Array.from(container.querySelectorAll<HTMLElement>('.sidebar-panel div')).filter(
    (d) => d.style.flex === '1 1 0%',
  );
  const el = options[index];
  if (!el) throw new Error(`type option not found: ${index}`);
  fireEvent.click(el);
}

function textAny(candidates: string[]): HTMLElement {
  for (const text of candidates) {
    const found = screen.queryAllByText(text);
    if (found.length > 0) return found[0];
  }
  throw new Error(`text not found: ${candidates.join(' / ')}`);
}

beforeEach(() => {
  installDomStubs();
  setLanguage('zh-cn');
  state.mobile = false;
  state.tree = makeTree();
  state.searchData = [];
  state.searchLoading = false;
  state.users = { users: ['alice', 'bob'], currentUser: 'alice' };
  state.domains = {
    domains: [
      { hash: 'hash1111aaaa', label: '域A', use: 'trusted', users: ['alice'] },
      { hash: 'hash2222bbbb', label: '域B', use: 'reference', users: [] },
    ],
    degraded: [],
    specs: [],
    tasks: [],
    projects: [],
  };
  sidebarStore.activeView = 'search';
  sidebarStore.collapsed = false;
  sidebarStore.fullyCollapsed = false;
  sidebarStore.width = 280;
  sidebarStore.searchKeyword = '';
  sidebarStore.expandedKeys = {};
  sidebarStore.searchExpandedKeys = {};
  sidebarStore.searchFilters = { type: 'all', taskStatus: [], specScope: [] };
  canvasStore.visibleTypes = { task: true, project: true, spec: true };
  canvasStore.visibleEdgeTypes = Object.fromEntries(
    ['task-project', 'task-spec', 'task-task', 'spec-project', 'project-project'].map((k) => [
      k,
      true,
    ]),
  );
  canvasStore.focusDepth = 1;
  canvasStore.selectedNodeId = null;
  canvasStore.taskStatusFilter = [];
  canvasStore.specScopeFilter = [];
  canvasStore.projectFilter = [];
  canvasStore.userFilter = [];
  canvasStore.domainFilter = [];
  canvasStore.domainUserFilter = [];
  canvasStore.localDataFilter = true;
  canvasStore.canvasKeyword = '';
  window.innerWidth = 1280;
});

afterEach(() => {
  cleanup();
  window.innerWidth = 1280;
});

describe('TreeBrowserSidebar 搜索 Tab', () => {
  it('树展开/叶子导航/搜索分组与筛选 chip/空态/IME', async () => {
    const { container } = renderUi(
      <>
        <TreeBrowserSidebar />
        <LocationProbe />
      </>,
    );
    expect(screen.getByText('规范根')).toBeTruthy();
    fireEvent.click(screen.getByText('规范根'));
    await waitFor(() => expect(screen.getByText('用户级')).toBeTruthy());
    fireEvent.click(screen.getByText('用户级'));
    await waitFor(() => expect(screen.getByText('规范A')).toBeTruthy());
    fireEvent.click(screen.getByText('规范A'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/spec/spec-a'));

    state.searchData = [
      {
        type: 'task',
        title: '搜索任务',
        snippet: '',
        meta: { id: 't1' },
      },
      {
        type: 'spec',
        title: '搜索规范',
        snippet: '',
        meta: { filePath: '/u/spec/x.md' },
      },
    ];
    const input = screen.getByPlaceholderText(/搜索 spec\/项目\/任务/);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '搜索' } });
    expect(sidebarStore.searchKeyword).toBe('');
    fireEvent.compositionEnd(input);
    expect(sidebarStore.searchKeyword).toBe('搜索');
    await waitFor(() => expect(screen.getByText(/搜索结果 \(2\)/)).toBeTruthy());
    expect(screen.getByText('搜索任务')).toBeTruthy();

    clickTypeOption(container, 1);
    await waitFor(() => expect(sidebarStore.searchFilters.type).toBe('task'));
    fireEvent.click(textAny(['In Progress', '进行中']));
    expect(sidebarStore.searchFilters.taskStatus).toEqual(['in_progress']);
    clickTypeOption(container, 3);
    await waitFor(() => expect(sidebarStore.searchFilters.type).toBe('spec'));
    fireEvent.click(textAny(['User', '用户级']));
    expect(sidebarStore.searchFilters.specScope).toEqual(['user']);

    state.searchData = [];
    fireEvent.change(input, { target: { value: '不存在' } });
    await waitFor(() => expect(screen.getByText('无搜索结果')).toBeTruthy());
  });

  it('无数据/仅筛选无匹配空态、折叠子分组、清空关键字', async () => {
    state.tree = [];
    renderUi(<TreeBrowserSidebar />);
    await waitFor(() => expect(screen.getByText('暂无数据')).toBeTruthy());
    sidebarStore.searchFilters = { type: 'task', taskStatus: [], specScope: [] };
    await waitFor(() => expect(screen.getByText('无匹配数据')).toBeTruthy());

    cleanup();
    state.tree = makeTree();
    sidebarStore.searchFilters = { type: 'all', taskStatus: [], specScope: [] };
    renderUi(<TreeBrowserSidebar />);
    fireEvent.click(screen.getByText('规范根'));
    await waitFor(() => expect(screen.getByText('用户级')).toBeTruthy());
    fireEvent.click(screen.getByText('用户级'));
    await waitFor(() => expect(sidebarStore.expandedKeys['root-spec']).toBe(true));
    expect(sidebarStore.expandedKeys['spec-scope-user']).toBe(true);
  });
});

describe('TreeBrowserSidebar 筛选 Tab', () => {
  it('来源/用户/域筛选、节点/边/预设/项目/状态/范围/深度与折叠', async () => {
    sidebarStore.activeView = 'filter';
    const { container } = renderUi(<TreeBrowserSidebar />);
    await waitFor(() => expect(screen.getByText('来源')).toBeTruthy());

    // 本机用户展开与勾选
    fireEvent.click(screen.getByText(/2 用户/));
    await waitFor(() => expect(screen.getByText('@bob')).toBeTruthy());
    fireEvent.click(checkboxByText('@bob'));
    expect(canvasStore.userFilter).toContain('bob');

    // 域勾选自动展开域内用户
    fireEvent.click(checkboxByText('域A'));
    await waitFor(() => expect(canvasStore.domainFilter).toEqual(['hash1111aaaa']));
    expect(canvasStore.domainUserFilter).toContain('hash1111aaaa:alice');
    await waitFor(() => expect(screen.getAllByText('@alice').length).toBeGreaterThan(0));
    fireEvent.click(checkboxByTextLast('@alice'));
    expect(canvasStore.domainUserFilter).not.toContain('hash1111aaaa:alice');

    // 清空来源
    const clearButtons = screen.getAllByRole('button', { name: /清\s*空/ });
    fireEvent.click(clearButtons[0]);
    expect(canvasStore.domainFilter).toEqual([]);
    expect(canvasStore.userFilter).toEqual([]);

    // 任务状态（需 task 可见）
    fireEvent.click(textAny(['In Progress', '进行中']));
    expect(canvasStore.taskStatusFilter).toEqual(['in_progress']);

    // 节点类型 / 预设
    fireEvent.click(checkboxByText(/^(Task|任务)$/));
    await waitFor(() => expect(canvasStore.visibleTypes.task).toBe(false));
    const preset = screen.getAllByRole('button', { name: 'Spec' })[0];
    fireEvent.click(preset);
    expect(canvasStore.visibleTypes.spec).toBe(true);
    expect(canvasStore.visibleTypes.task).toBe(false);

    // 项目筛选全选/清空 + 搜索
    await waitFor(() => expect(screen.getByPlaceholderText('搜索项目...')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('搜索项目...'), { target: { value: '项目1' } });
    fireEvent.click(screen.getByRole('button', { name: /全\s*选/ }));
    expect(canvasStore.projectFilter.length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText('搜索项目...'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /全\s*选/ }));
    expect(canvasStore.projectFilter).toHaveLength(7);
    fireEvent.click(screen.getAllByRole('button', { name: /清\s*空/ }).at(-1)!);
    expect(canvasStore.projectFilter).toEqual([]);

    // spec 范围 / 聚焦深度
    fireEvent.click(textAny(['Global', '全局级']));
    expect(canvasStore.specScopeFilter).toEqual(['global']);
    fireEvent.click(textAny(['2 hops', '2跳']));
    expect(canvasStore.focusDepth).toBe(2);

    // 边类型分组折叠/勾选
    fireEvent.click(checkboxByText(/^(Task edges|任务关系)/));
    expect(Object.values(canvasStore.visibleEdgeTypes).some((v) => v === false)).toBe(true);
    const collapseToggles = Array.from(
      container.querySelectorAll<HTMLElement>('.sidebar-panel span'),
    ).filter((el) => el.textContent === '▾' || el.textContent === '▸');
    expect(collapseToggles.length).toBeGreaterThan(0);
    fireEvent.click(collapseToggles[0]);

    // 项目分组折叠、侧栏 resize、Activity Bar 切换与收起/展开
    const projectHeaderToggle = Array.from(
      container.querySelectorAll<HTMLElement>('.sidebar-panel span'),
    ).find((el) => el.textContent === '▾');
    if (projectHeaderToggle) fireEvent.click(projectHeaderToggle);

    const handle = container.querySelector('.sidebar-resize-handle') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 340 });
    fireEvent.mouseUp(document);
    expect(sidebarStore.width).toBe(320);

    const activityButtons = container.querySelectorAll<HTMLButtonElement>(
      '.sidebar-activity-bar__item',
    );
    fireEvent.click(activityButtons[1]);
    expect(sidebarStore.activeView).toBe('search');
    fireEvent.click(activityButtons[0]);
    expect(sidebarStore.fullyCollapsed).toBe(true);
    fireEvent.click(container.querySelector('.sidebar-expand-btn') as HTMLElement);
    expect(sidebarStore.fullyCollapsed).toBe(false);
  });

  it('移动端隐藏收起按钮；全选本机用户与无域提示', async () => {
    state.mobile = true;
    state.domains = { domains: [], degraded: [], specs: [], tasks: [], projects: [] };
    sidebarStore.activeView = 'filter';
    const { container } = renderUi(<TreeBrowserSidebar />);
    expect(screen.getByText(/未关联域/)).toBeTruthy();
    expect(container.querySelector('.sidebar-expand-btn')).toBeNull();
    expect(container.querySelectorAll('.sidebar-activity-bar__item')).toHaveLength(2);

    fireEvent.click(checkboxByText('本机'));
    expect(canvasStore.localDataFilter).toBe(true);
    expect(canvasStore.userFilter).toEqual(['alice', 'bob']);
    await waitFor(() => expect(checkboxByText('本机').checked).toBe(true));
    fireEvent.click(checkboxByText('本机'));
    expect(canvasStore.localDataFilter).toBe(false);
  });
});
