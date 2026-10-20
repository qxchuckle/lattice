import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  ProjectEditModal,
  RelationModal,
  useProjectRemove,
} from '../src/components/modals/ProjectEditModal';
import {
  SpecConflictsModal,
  SpecCreateModal,
  SpecFrontmatterModal,
  SpecLintModal,
} from '../src/components/modals/SpecEditModal';
import { TaskCreateModal } from '../src/components/modals/TaskCreateModal';
import { CheckpointModal } from '../src/components/modals/CheckpointModal';
import { setAdapter } from '../src/adapters';
import { installDomStubs, renderUi } from './helpers/component';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clickOk(): void {
  const footers = Array.from(document.querySelectorAll<HTMLElement>('.ant-modal-footer'));
  const buttons = Array.from(
    footers[footers.length - 1]?.querySelectorAll<HTMLButtonElement>('button') ?? [],
  );
  const button = buttons.find((b) => b.classList.contains('ant-btn-primary')) ?? buttons.at(-1);
  if (!button) throw new Error('modal ok not found');
  fireEvent.click(button);
}

const adapterMock = { addCheckpoint: vi.fn(async () => true) };

const project = {
  id: 'legacy:p1',
  ids: ['legacy:p1', 'git:aaa'],
  name: '项目一',
  description: '描述',
  tags: ['stable'],
  groupPaths: ['frontend', 'backend'],
};

const otherProject = {
  id: 'legacy:p2',
  ids: ['legacy:p2'],
  name: '项目二',
};

beforeEach(() => {
  installDomStubs();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/tasks/create')) {
        return jsonResponse({ success: true, task: { id: 't1' } });
      }
      return jsonResponse({ success: true });
    }),
  );
  adapterMock.addCheckpoint.mockClear();
  setAdapter(adapterMock as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectEditModal', () => {
  it('预填字段、保存成功并关闭；失败分支提示', async () => {
    const onClose = vi.fn();
    renderUi(<ProjectEditModal open onClose={onClose} project={project as never} />);
    await waitFor(() =>
      expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('项目一'),
    );
    expect((screen.getByLabelText('分组（逗号分隔路径）') as HTMLInputElement).value).toBe(
      'frontend, backend',
    );
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '项目一改' } });
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '新描述' } });
    clickOk();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/projects/legacy%3Ap1/update',
      expect.objectContaining({ method: 'POST' }),
    );

    // 失败分支
    cleanup();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: false }));
    renderUi(<ProjectEditModal open onClose={onClose} project={project as never} />);
    await waitFor(() =>
      expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('项目一'),
    );
    clickOk();
    await waitFor(() => expect(screen.getByText('更新失败')).toBeTruthy());
  });

  it('useProjectRemove 确认后调用 remove 接口', async () => {
    function Harness() {
      const remove = useProjectRemove();
      return <button onClick={() => remove(project as never)}>remove</button>;
    }
    renderUi(<Harness />);
    fireEvent.click(screen.getByText('remove'));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe('注销项目'),
    );
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button'),
    ).at(-1);
    fireEvent.click(confirm!);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/projects/legacy%3Ap1/remove',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.getByText('项目已注销')).toBeTruthy());
  });

  it('RelationModal：选择目标项目并保存', async () => {
    const onClose = vi.fn();
    renderUi(
      <RelationModal
        open
        onClose={onClose}
        projectId='legacy:p1'
        projects={[project, otherProject] as never}
      />,
    );
    const combobox = screen.getByRole('combobox', { name: '目标项目' });
    fireEvent.mouseDown(combobox);
    await waitFor(() => expect(screen.getByText('项目二')).toBeTruthy());
    fireEvent.click(screen.getByText('项目二'));
    clickOk();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/projects/legacy%3Ap1/relations',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('Spec modals', () => {
  it('创建 Spec 成功并关闭', async () => {
    const onClose = vi.fn();
    renderUi(<SpecCreateModal open onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('my-spec.md'), {
      target: { value: 'new-spec.md' },
    });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新规范' } });
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '摘要内容' } });
    clickOk();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/specs/init',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('Frontmatter 编辑成功；Lint 与冲突结果渲染', async () => {
    const onClose = vi.fn();
    renderUi(
      <SpecFrontmatterModal open onClose={onClose} specId='spec-a' specPath='/u/spec/a.md' />,
    );
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '标题' } });
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '摘要' } });
    fireEvent.change(screen.getByLabelText('标签（逗号分隔）'), {
      target: { value: 'a, b' },
    });
    clickOk();
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    cleanup();
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes('/api/specs/lint')) {
        return jsonResponse([
          {
            filePath: '/u/spec/a.md',
            issues: [
              { severity: 'error', message: 'err' },
              { severity: 'warning', message: 'warn' },
            ],
          },
        ]);
      }
      return jsonResponse([
        {
          fileName: 'a.md',
          levels: [
            { scope: 'global', filePath: '/g/a.md' },
            { scope: 'user', filePath: '/u/a.md' },
          ],
        },
      ]);
    });
    renderUi(<SpecLintModal open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('/u/spec/a.md')).toBeTruthy());
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('warning')).toBeTruthy();

    cleanup();
    renderUi(<SpecConflictsModal open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    expect(screen.getByText('global')).toBeTruthy();
    expect(screen.getByText('/g/a.md')).toBeTruthy();
  });
});

describe('Task / Checkpoint modals', () => {
  it('创建任务成功并关闭', async () => {
    const onClose = vi.fn();
    renderUi(
      <TaskCreateModal
        open
        onClose={onClose}
        projectId='p1'
        projects={[{ id: 'p1', name: '项目一' }]}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('任务标题'), {
      target: { value: '新任务' },
    });
    clickOk();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/tasks/create',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('添加 Checkpoint：选择类型、填写标题并保存', async () => {
    const onClose = vi.fn();
    renderUi(<CheckpointModal open onClose={onClose} taskId='t1' />);
    const typeInput = screen.getByLabelText('类型');
    fireEvent.mouseDown(typeInput);
    await waitFor(() => expect(screen.getByText('note - 事实')).toBeTruthy());
    fireEvent.click(screen.getByText('note - 事实'));
    fireEvent.change(screen.getByPlaceholderText('检查点标题'), {
      target: { value: '检查点' },
    });
    fireEvent.change(screen.getByPlaceholderText('详细内容'), {
      target: { value: '内容' },
    });
    clickOk();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(adapterMock.addCheckpoint).toHaveBeenCalledWith('t1', 'note', '检查点', '内容');
  });
});
