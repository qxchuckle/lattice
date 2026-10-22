import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { DetailPanel } from '../src/components/DetailPanel';
import { setAdapter } from '../src/adapters';
import { detailStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname}</div>;
}

const project = {
  id: 'p1',
  ids: ['p1'],
  name: '项目一',
  description: '项目描述',
  created: '2026-01-01 00:00:00',
  groupPaths: ['frontend', 'backend'],
  tags: ['stable', 'web'],
};

const tasks = [
  { id: 't1', title: '任务一', status: 'in_progress' },
  { id: 't2', title: '任务二', status: 'completed' },
];

const specs = [
  {
    fileName: 'spec-a.md',
    filePath: '/u/spec-a.md',
    frontmatter: { id: 'spec-a', title: '规范A', tags: ['tag1', 'tag2'] },
    content: '# spec',
  },
];

const relations = [
  {
    id: 'rel1',
    projectA: 'p1',
    projectB: 'p2',
    type: 'related',
    created: '2026-01-01T00:00:00Z',
  },
];

const adapter = {
  getProject: vi.fn(async () => project),
  getProjectGitStatus: vi.fn(async () => ({
    branch: 'main',
    dirty: true,
    uncommittedCount: 3,
    ahead: 2,
    behind: 1,
    lastCommitMessage: '最近提交',
    lastCommitTime: '2026-01-02 00:00:00',
  })),
  getProjectSpecs: vi.fn(async () => specs),
  getProjectTasks: vi.fn(async () => tasks),
  getProjectRelations: vi.fn(async () => relations),
  getProjects: vi.fn(async () => [project, { id: 'p2', ids: ['p2'], name: '项目二' }]),
  getProjectLocalPaths: vi.fn(async () => ['/home/u/a', '/home/u/b']),
  getGlobalStatus: vi.fn(async () => ({ home: '/home/u', pathSep: '/' })),
  getEntityPath: vi.fn(async () => '/home/u/.lattice/projects/p1'),
  search: vi.fn(async () => [
    { type: 'task', title: '搜索结果', snippet: '搜索片段', meta: { id: 't1' } },
    { type: 'task', title: '无 ID 结果', meta: { filePath: '/x/task/t2/prd.md' } },
  ]),
  openPathByPath: vi.fn(async () => true),
};

beforeEach(() => {
  installDomStubs();
  for (const fn of Object.values(adapter)) fn.mockClear();
  adapter.search.mockImplementation(async (query: string) =>
    query === '无结果'
      ? []
      : [
          { type: 'task', title: '搜索结果', snippet: '搜索片段', meta: { id: 't1' } },
          { type: 'task', title: '无 ID 结果', meta: { filePath: '/x/task/t2/prd.md' } },
        ],
  );
  setAdapter(adapter as never);
  detailStore.open = true;
  detailStore.collapsed = false;
  detailStore.entityId = 'p1';
  detailStore.entityType = 'project';
  detailStore.entityData = null;
});

afterEach(() => {
  cleanup();
  detailStore.entityId = null;
  detailStore.entityType = null;
  detailStore.open = false;
});

describe('DetailPanel 项目详情', () => {
  it('Git/关联任务/项目关系/Spec Tab、筛选、搜索与路径选择', async () => {
    renderUi(
      <>
        <DetailPanel />
        <LocationProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByText('项目一')).toBeTruthy());
    expect(screen.getByText('项目描述')).toBeTruthy();
    expect(screen.getByText(/ID: p1/)).toBeTruthy();
    expect(screen.getByText(/frontend, backend/)).toBeTruthy();
    expect(screen.getByText(/stable, web/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy());
    expect(screen.getByText(/3.*未提交/)).toBeTruthy();
    expect(screen.getByText('↑2')).toBeTruthy();
    expect(screen.getByText('↓1')).toBeTruthy();
    expect(screen.getByText('最近提交')).toBeTruthy();

    // 本地多路径：打开选择弹窗并打开
    await waitFor(() => expect(screen.getByText(/2.*个本地路径/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /打\s*开/ }));
    await waitFor(() => expect(screen.getByText('选择要打开的路径')).toBeTruthy());
    fireEvent.click(screen.getByText('~/a'));
    await waitFor(() => expect(adapter.openPathByPath).toHaveBeenCalledWith('/home/u/a', 'finder'));

    // 关联任务：状态筛选、任务导航、RAG 搜索与空态
    fireEvent.click(screen.getByText(/关联任务 \(2\)/));
    await waitFor(() => expect(screen.getByText('任务一')).toBeTruthy());
    fireEvent.click(screen.getByText('已完成'));
    await waitFor(() => expect(screen.queryByText('任务一')).toBeNull());
    expect(screen.getByText('任务二')).toBeTruthy();
    fireEvent.click(screen.getByText('任务二'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/task/t2'));

    fireEvent.click(screen.getByText('已完成'));
    fireEvent.change(screen.getByPlaceholderText('RAG 搜索关联任务...'), {
      target: { value: '搜索' },
    });
    await waitFor(() => expect(screen.getByText('搜索结果')).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText('搜索片段')).toBeTruthy();
    fireEvent.click(screen.getByText('搜索结果'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/task/t1'));
    fireEvent.change(screen.getByPlaceholderText('RAG 搜索关联任务...'), {
      target: { value: '无结果' },
    });
    await waitFor(() => expect(screen.getByText('未找到匹配的关联任务')).toBeTruthy(), {
      timeout: 2000,
    });

    // 项目关系：名称、导航、搜索空态
    fireEvent.click(screen.getByText(/项目关系 \(1\)/));
    await waitFor(() => expect(screen.getByText('项目二')).toBeTruthy());
    expect(screen.getByText('related')).toBeTruthy();
    fireEvent.click(screen.getByText('项目二'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/project/p2'));
    fireEvent.change(screen.getByPlaceholderText('搜索项目关系...'), {
      target: { value: '不存在' },
    });
    await waitFor(() => expect(screen.getByText('无匹配的项目关系')).toBeTruthy());

    // Spec：标签、过滤、导航
    fireEvent.click(screen.getByText('Spec (1)'));
    await waitFor(() => expect(screen.getByText('规范A')).toBeTruthy());
    expect(screen.getByText('tag1')).toBeTruthy();
    fireEvent.click(screen.getByText('规范A'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/spec/spec-a'));
    fireEvent.change(screen.getByPlaceholderText('搜索 Spec...'), {
      target: { value: '不存在' },
    });
    await waitFor(() => expect(screen.getByText('无匹配 Spec')).toBeTruthy());
  });

  it('项目不存在与 git 干净分支', async () => {
    adapter.getProject.mockResolvedValueOnce({ error: 'not_found' } as never);
    renderUi(<DetailPanel />);
    await waitFor(() => expect(screen.getByText('加载失败')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(adapter.getProject.mock.calls.length).toBeGreaterThan(1));

    cleanup();
    adapter.getProjectGitStatus.mockResolvedValueOnce({
      branch: '',
      dirty: false,
      uncommittedCount: 0,
      ahead: 0,
      behind: 0,
    } as never);
    renderUi(<DetailPanel />);
    await waitFor(() => expect(screen.getByText('干净')).toBeTruthy());
    expect(screen.getByText('-')).toBeTruthy();
  });
});
