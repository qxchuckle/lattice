import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { DetailPanel } from '../src/components/DetailPanel';
import { setAdapter } from '../src/adapters';
import { canvasStore, detailStore, terminalStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname}</div>;
}

const task = {
  id: 't1',
  title: '任务详情',
  status: 'in_progress',
  created: '2026-01-01 10:00:00',
  updated: '2026-01-02 11:00:00',
  projects: ['p1', 'p2'],
  referencedSpecs: [
    { id: 'spec-a', scope: 'project' },
    { id: 'spec-b', scope: 'user' },
  ],
  scopePaths: [
    { path: '/home/u/projects/p1/src', projectId: 'p1', note: '核心路径' },
    { path: '/home/u/projects/p2/lib' },
  ],
};

const progress = [
  {
    id: 'cp1',
    type: 'milestone',
    title: '里程碑一',
    message: '完成核心功能',
    time: '2026-01-03 12:00:00',
  },
];

const adapter = {
  getTask: vi.fn(async () => task),
  getTaskProgress: vi.fn(async () => progress),
  getTaskLineage: vi.fn(async () => [
    { id: 'parent', title: '父任务' },
    { id: 't1', title: '任务详情' },
  ]),
  getContent: vi.fn(async (_type: string) =>
    _type === 'progress' ? '' : `# ${_type} 标题\n\n${_type} 正文`,
  ),
  getProjects: vi.fn(async () => [
    { id: 'p1', ids: ['p1'], name: '项目一', description: '项目描述' },
    { id: 'p2', ids: ['p2'], name: '项目二' },
  ]),
  getSpecs: vi.fn(async () => ({
    global: [],
    user: [],
    project: [
      {
        fileName: 'spec-a.md',
        filePath: '/u/spec-a.md',
        frontmatter: { id: 'spec-a', title: '规范A' },
        content: '',
      },
    ],
  })),
  getEntityPath: vi.fn(async () => '/home/u/.lattice/users/u/tasks/t1'),
  getGlobalStatus: vi.fn(async () => ({ home: '/home/u', pathSep: '/' })),
  updateTaskStatus: vi.fn(async () => true),
  archiveTask: vi.fn(async () => true),
  deleteTask: vi.fn(async () => true),
  addCheckpoint: vi.fn(async () => true),
  openPathByPath: vi.fn(async () => true),
  getModelStatus: vi.fn(async () => ({ installed: true, loaded: false })),
  getRagStatus: vi.fn(async () => ({})),
};

beforeEach(() => {
  installDomStubs();
  for (const fn of Object.values(adapter)) fn.mockClear();
  setAdapter(adapter as never);
  detailStore.open = true;
  detailStore.collapsed = false;
  detailStore.entityId = 't1';
  detailStore.entityType = 'task';
  detailStore.entityData = null;
  canvasStore.locateNodeId = null;
  terminalStore.open = false;
});

afterEach(() => {
  cleanup();
  detailStore.entityId = null;
  detailStore.entityType = null;
  detailStore.open = false;
  terminalStore.open = false;
});

function openHeaderMenu() {
  const button = document.querySelector('.detail-component__tags button') as HTMLButtonElement;
  fireEvent.click(button);
}

describe('DetailPanel 任务详情', () => {
  it('项目/Spec/范围路径/文档/Checkpoint Tab、搜索与导航', { timeout: 15000 }, async () => {
    renderUi(
      <>
        <DetailPanel />
        <LocationProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByText('任务详情')).toBeTruthy());
    expect(screen.getByText('in_progress')).toBeTruthy();
    expect(screen.getByText(/ID: t1/)).toBeTruthy();
    expect(screen.getByText(/2026-01-02/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/父任务/)).toBeTruthy());
    fireEvent.click(screen.getByText('父任务'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/task/parent'));

    // 关联项目：搜索过滤、空态与导航
    fireEvent.click(screen.getByText(/关联项目 \(2\)/));
    await waitFor(() => expect(screen.getByText('项目一')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('搜索关联项目...'), {
      target: { value: '不存在' },
    });
    await waitFor(() => expect(screen.getByText('无匹配项目')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('搜索关联项目...'), { target: { value: '' } });
    fireEvent.click(screen.getByText('项目一'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/project/p1'));

    // 引用 Spec：标题映射、过滤与导航
    fireEvent.click(screen.getByText(/引用 Spec \(2\)/));
    await waitFor(() => expect(screen.getByText('规范A')).toBeTruthy());
    fireEvent.click(screen.getByText('规范A'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/spec/spec-a'));

    // 范围路径：打开目录/终端、项目标签导航
    fireEvent.click(screen.getByText(/范围路径 \(2\)/));
    await waitFor(() => expect(screen.getByText(/核心路径/)).toBeTruthy());
    const pathActions = document.querySelectorAll('.scope-path__actions button');
    fireEvent.click(pathActions[0]);
    expect(adapter.openPathByPath).toHaveBeenCalledWith('/home/u/projects/p1/src', 'finder');
    fireEvent.click(pathActions[pathActions.length - 1]);
    expect(terminalStore.open).toBe(true);
    fireEvent.click(screen.getByText('p1', { selector: '.ant-tag' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/project/p1'));

    // 文档：PRD/设计内容、进度空态
    fireEvent.click(screen.getByText('文档预览'));
    await waitFor(() => expect(screen.getByText('prd 标题')).toBeTruthy());
    fireEvent.click(screen.getByText('设计文档'));
    await waitFor(() => expect(screen.getByText('design 标题')).toBeTruthy());
    fireEvent.click(screen.getByText('进度文件'));
    await waitFor(() => expect(screen.getByText('文件为空')).toBeTruthy());

    // Checkpoint：展示、搜索与空态
    fireEvent.click(screen.getByText(/Checkpoint \(1\)/));
    await waitFor(() => expect(screen.getByText('里程碑一')).toBeTruthy());
    expect(screen.getByText('完成核心功能')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('搜索 Checkpoint...'), {
      target: { value: '不存在' },
    });
    await waitFor(() => expect(screen.getByText('无匹配 Checkpoint')).toBeTruthy());
  });

  it('状态下拉、添加 Checkpoint、归档与删除', { timeout: 15000 }, async () => {
    renderUi(<DetailPanel />);
    await waitFor(() => expect(screen.getByText('任务详情')).toBeTruthy());

    openHeaderMenu();
    await waitFor(() => expect(screen.getByText('planning')).toBeTruthy());
    fireEvent.click(screen.getByText('planning'));
    await waitFor(() => expect(adapter.updateTaskStatus).toHaveBeenCalledWith('t1', 'planning'));
    await waitFor(() => expect(screen.getByText(/状态已更新为 planning/)).toBeTruthy());

    openHeaderMenu();
    fireEvent.click(await screen.findByText('添加 Checkpoint'));
    await waitFor(() =>
      expect(screen.getByText('添加 Checkpoint', { selector: '.ant-modal-title' })).toBeTruthy(),
    );
    fireEvent.mouseDown(screen.getByLabelText('类型'));
    await waitFor(() => expect(screen.getByText('note - 事实')).toBeTruthy());
    fireEvent.click(screen.getByText('note - 事实'));
    fireEvent.change(screen.getByPlaceholderText('检查点标题'), {
      target: { value: '新检查点' },
    });
    fireEvent.change(screen.getByPlaceholderText('详细内容'), {
      target: { value: '检查点内容' },
    });
    const checkpointOk = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-footer button'),
    ).at(-1);
    fireEvent.click(checkpointOk!);
    await waitFor(() => expect(adapter.addCheckpoint).toHaveBeenCalled());

    openHeaderMenu();
    fireEvent.click(await screen.findByText('归档'));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe('归档任务'),
    );
    fireEvent.click(
      Array.from(document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button')).at(
        -1,
      )!,
    );
    await waitFor(() => expect(adapter.archiveTask).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(screen.getByText('已归档')).toBeTruthy());

    openHeaderMenu();
    fireEvent.click(await screen.findByText('删除'));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe('删除任务'),
    );
    fireEvent.click(
      Array.from(document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button')).at(
        -1,
      )!,
    );
    await waitFor(() => expect(adapter.deleteTask).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(screen.getByText('已删除')).toBeTruthy());
    expect(detailStore.open).toBe(false);
  });
});
