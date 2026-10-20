import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { DetailPanel } from '../src/components/DetailPanel';
import { setAdapter } from '../src/adapters';
import { canvasStore, detailStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname}</div>;
}

function makeAdapter() {
  return {
    getSpecs: vi.fn(async () => ({
      global: [],
      user: [],
      project: [
        {
          fileName: 'alpha.md',
          filePath: '/home/u/.lattice/users/u/projects/p1/spec/alpha.md',
          frontmatter: { id: 'spec-alpha', title: 'Alpha' },
          content: '# 标题一\n\n正文内容\n\n## 子标题\n\n更多',
        },
      ],
    })),
    getTasks: vi.fn(async () => [
      {
        id: 't1',
        title: '关联任务一',
        status: 'in_progress',
        projects: ['p1'],
        referencedSpecs: [{ id: 'spec-alpha', scope: 'project' }],
      },
      {
        id: 't2',
        title: '关联任务二',
        status: 'completed',
        projects: ['p2'],
        referencedSpecs: [{ id: 'other', scope: 'project' }],
      },
    ]),
    getProjects: vi.fn(async () => [
      { id: 'p1', ids: ['p1'], name: '项目一' },
      { id: 'p2', ids: ['p2'], name: '项目二' },
    ]),
    getContent: vi.fn(async () => '# 标题一\n\n正文内容'),
    getGlobalStatus: vi.fn(async () => ({ home: '/home/u', pathSep: '/' })),
    openPathByPath: vi.fn(async () => true),
    getTask: vi.fn(),
    getTaskProgress: vi.fn(),
    getProject: vi.fn(),
    getProjectGitStatus: vi.fn(),
    getProjectSpecs: vi.fn(),
    getProjectTasks: vi.fn(),
    getProjectRelations: vi.fn(),
  };
}

function setSpec(scope = 'project') {
  detailStore.entityId = 'spec-alpha';
  detailStore.entityType = 'spec';
  detailStore.entityData = {
    entityType: 'spec',
    specId: 'spec-alpha',
    title: 'Alpha 规范',
    scope,
    filePath: '/home/u/.lattice/users/u/projects/p1/spec/alpha.md',
  } as never;
}

beforeEach(() => {
  installDomStubs();
  setAdapter(makeAdapter() as never);
  detailStore.open = true;
  detailStore.collapsed = false;
  detailStore.entityId = null;
  detailStore.entityType = null;
  detailStore.entityData = null;
  canvasStore.locateNodeId = null;
});

afterEach(() => {
  cleanup();
  detailStore.entityId = null;
  detailStore.entityType = null;
  detailStore.entityData = null;
  detailStore.open = false;
});

describe('DetailPanel Spec', () => {
  it('渲染 Spec 内容/目录、关联项目/任务 Tab、头部定位/收起/关闭与编辑', async () => {
    setSpec('project');
    const { container } = renderUi(
      <>
        <DetailPanel />
        <LocationProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByText('Alpha 规范')).toBeTruthy());
    expect(screen.getByText('项目级')).toBeTruthy();
    expect(screen.getByText(/文件: spec-alpha/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('标题一')).toBeTruthy());

    fireEvent.click(screen.getByText(/关联项目 \(1\)/));
    await waitFor(() => expect(screen.getByText('项目一')).toBeTruthy());
    fireEvent.click(screen.getByText('项目一'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/project/p1'));

    fireEvent.click(screen.getByText(/关联任务 \(1\)/));
    await waitFor(() => expect(screen.getByText('关联任务一')).toBeTruthy());
    fireEvent.click(screen.getByText('关联任务一'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/task/t1'));

    // 头部：定位、收起、关闭
    const headerButtons = container.querySelectorAll<HTMLButtonElement>(
      '.detail-header__actions button',
    );
    expect(headerButtons.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(headerButtons[0]);
    expect(canvasStore.locateNodeId).toBe('spec-alpha');
    fireEvent.click(headerButtons[1]);
    expect(detailStore.collapsed).toBe(true);
    fireEvent.click(headerButtons[2]);
    expect(detailStore.open).toBe(false);
  });

  it('全局/用户 Scope 标签；无 Spec 内容的回退加载', async () => {
    detailStore.entityId = 'spec-beta';
    detailStore.entityType = 'spec';
    detailStore.entityData = {
      entityType: 'spec',
      specId: 'spec-beta',
      title: 'Beta',
      scope: 'global',
      filePath: undefined,
    } as never;
    const adapter = makeAdapter();
    adapter.getSpecs.mockResolvedValue({ global: [], user: [], project: [] });
    adapter.getContent.mockResolvedValue('# 回退标题\n\n回退正文');
    setAdapter(adapter as never);
    renderUi(<DetailPanel />);
    await waitFor(() => expect(screen.getByText('全局级')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('回退标题')).toBeTruthy());
    expect(adapter.getContent).toHaveBeenCalledWith('spec', 'spec-beta');

    cleanup();
    setSpec('user');
    const user = renderUi(<DetailPanel />);
    await waitFor(() => expect(screen.getByText('用户级')).toBeTruthy());
    expect(user.container.querySelector('.detail-panel-root')).toBeTruthy();
  });

  it('空态与 task/project API 分支的 loading/error/data', async () => {
    const empty = renderUi(<DetailPanel />);
    expect(empty.container.textContent).toContain('选择一个节点查看详情');
    cleanup();

    const adapter = makeAdapter();
    let resolveTask: (v: unknown) => void = () => {};
    adapter.getTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTask = resolve;
        }),
    );
    adapter.getTaskProgress.mockResolvedValue({ total: 1, completed: 0 });
    setAdapter(adapter as never);
    detailStore.entityId = 't1';
    detailStore.entityType = 'task';
    renderUi(<DetailPanel />);
    await waitFor(() => expect(document.querySelector('.detail-loading')).toBeTruthy());
    resolveTask({ id: 't1', title: '加载任务', status: 'in_progress' });
    await waitFor(() => expect(screen.getByText('加载任务')).toBeTruthy());
  });
});
