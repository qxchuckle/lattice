import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfigModal } from '../src/components/admin/ConfigModal';
import { setAdapter } from '../src/adapters';
import { authStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

const globalConfig = {
  registryTemplates: ['https://example.com/specs'],
  rag: {
    embedding: {
      modelId: 'Xenova/bge-small-zh-v1.5',
      dimension: 512,
      dtype: 'q8',
      pooling: 'mean',
      remoteHost: '',
      proxy: '',
      distanceThreshold: 0.5,
      queryPrefix: 'search: ',
      batchSize: 16,
      minChunkSize: 100,
    },
  },
};

const localConfig = {
  username: 'alice',
  scanDirs: ['/a', '/b'],
  gitEnabled: true,
  gitRemote: '',
  registryTemplates: [],
};

const adapter = {
  getConfig: vi.fn(async (scope: string) => (scope === 'global' ? globalConfig : localConfig)),
  setConfig: vi.fn(async () => true),
  getAuthStatus: vi.fn(async () => ({ enabled: true })),
  changePassword: vi.fn(async () => true),
};

beforeEach(() => {
  installDomStubs();
  adapter.getConfig.mockClear();
  adapter.getConfig.mockImplementation(async (scope: string) =>
    scope === 'global' ? globalConfig : localConfig,
  );
  adapter.setConfig.mockReset();
  adapter.setConfig.mockResolvedValue(true);
  adapter.changePassword.mockClear();
  adapter.getAuthStatus.mockClear();
  authStore.authEnabled = false;
  setAdapter(adapter as never);
});

afterEach(() => {
  cleanup();
  authStore.authEnabled = false;
});

describe('ConfigModal', () => {
  it('全局配置：加载/编辑/仅差异/保存成功与关闭', async () => {
    const onClose = vi.fn();
    renderUi(<ConfigModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('模板仓库')).toBeTruthy());
    expect(adapter.getConfig).toHaveBeenCalledWith('global', false);
    const queryInput = screen
      .getByText('查询前缀')
      .parentElement?.parentElement?.querySelector('input') as HTMLInputElement;
    expect(queryInput.value).toBe('search: ');

    // 仅显示差异：重新查询并显示「已修改」
    const diffSwitch = document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-switch');
    fireEvent.click(diffSwitch!);
    await waitFor(() => expect(adapter.getConfig).toHaveBeenCalledWith('global', true));
    fireEvent.change(queryInput, { target: { value: 'query: ' } });
    await waitFor(() => expect(queryInput.value).toBe('query: '));
  });

  it('关键项修改弹确认；保存失败提示且不关闭', async () => {
    const onClose = vi.fn();
    renderUi(<ConfigModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByDisplayValue('512')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('512'), { target: { value: '768' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe(
        '关键配置修改确认',
      ),
    );
    expect(screen.getAllByText(/维度与模型不匹配/).length).toBeGreaterThan(0);
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button'),
    ).at(-1);
    adapter.setConfig.mockResolvedValueOnce(false);
    fireEvent.click(confirm!);
    await waitFor(() => expect(screen.getByText(/保存失败: 保存 模板仓库 失败/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('本机配置字段与 Web 密码区：校验、设置、清除', { timeout: 15000 }, async () => {
    const onClose = vi.fn();
    renderUi(<ConfigModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('全局配置')).toBeTruthy());
    fireEvent.click(screen.getByText('本机配置'));
    await waitFor(() => expect(screen.getByDisplayValue('alice')).toBeTruthy());
    expect(adapter.getConfig).toHaveBeenCalledWith('local', false);

    // 文本/数组/布尔字段
    fireEvent.change(screen.getByDisplayValue('alice'), { target: { value: 'bob' } });
    const scanTextarea = Array.from(document.querySelectorAll('textarea')).find((t) =>
      t.value.includes('/a'),
    )!;
    fireEvent.change(scanTextarea, { target: { value: '/a\n/c' } });
    const gitSwitch = screen
      .getByText('Git 管理')
      .parentElement?.parentElement?.querySelector('.ant-switch');
    fireEvent.click(gitSwitch!);
    const remoteInput = screen
      .getByText('Git 远程仓库')
      .parentElement?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(remoteInput, { target: { value: 'origin' } });
    expect(screen.getByRole('button', { name: /保\s*存/ }).hasAttribute('disabled')).toBe(false);

    // 密码区：空/过短/不一致/成功
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }));
    await waitFor(() => expect(screen.getByText('请输入新密码')).toBeTruthy());
    const passwordInputs = screen.getAllByPlaceholderText(/密码/);
    fireEvent.change(passwordInputs[0], { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }));
    await waitFor(() => expect(screen.getByText('密码至少 4 位')).toBeTruthy());
    fireEvent.change(passwordInputs[0], { target: { value: 'abcd' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'abce' } });
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }));
    await waitFor(() => expect(screen.getByText('两次密码不一致')).toBeTruthy());
    fireEvent.change(passwordInputs[1], { target: { value: 'abcd' } });
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }));
    await waitFor(() => expect(adapter.changePassword).toHaveBeenCalledWith('abcd'));
    await waitFor(() => expect(authStore.authEnabled).toBe(true));
    expect(screen.getByRole('button', { name: '修改密码' })).toBeTruthy();

    // 清除密码
    fireEvent.click(screen.getByRole('button', { name: '清除密码' }));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe('确认清除密码'),
    );
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button'),
    ).at(-1);
    fireEvent.click(confirm!);
    await waitFor(() => expect(adapter.changePassword).toHaveBeenCalledWith(null));
    await waitFor(() => expect(screen.getByText('密码已清除')).toBeTruthy());

    // 保存本机配置成功
    const save = screen.getByRole('button', { name: /保\s*存/ });
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
    fireEvent.click(save);
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe(
        '关键配置修改确认',
      ),
    );
    const saveConfirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button'),
    ).at(-1);
    fireEvent.click(saveConfirm!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(adapter.setConfig).toHaveBeenCalledWith('username', 'bob', 'local');
  });

  it('加载态显示 Spin', async () => {
    let resolveConfig: (value: unknown) => void = () => {};
    adapter.getConfig.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfig = resolve;
        }),
    );
    renderUi(<ConfigModal open onClose={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('.ant-spin')).toBeTruthy());
    resolveConfig(globalConfig);
    await waitFor(() => expect(screen.getByText('模板仓库')).toBeTruthy());
    const diffSwitch = document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-switch');
    fireEvent.click(diffSwitch!);
    await waitFor(() => expect(adapter.getConfig).toHaveBeenCalledWith('global', true));
  });
});
