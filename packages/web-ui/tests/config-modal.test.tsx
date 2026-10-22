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

const ragStatus = {
  modelId: 'Xenova/bge-small-zh-v1.5',
  lastModelId: 'Xenova/bge-small-zh-v1.5',
  modelInstalled: true,
  modelChanged: false,
};

const adapter = {
  getConfig: vi.fn(async (scope: string) => (scope === 'global' ? globalConfig : localConfig)),
  setConfig: vi.fn(async () => true),
  getRagStatus: vi.fn(async () => ragStatus),
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
  adapter.getRagStatus.mockClear();
  adapter.getRagStatus.mockResolvedValue(ragStatus);
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

  it('有未保存修改时关闭需确认', async () => {
    const onClose = vi.fn();
    renderUi(<ConfigModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('模板仓库')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('https://example.com/specs'), {
      target: { value: 'https://example.com/new' },
    });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe(
        '放弃未保存的修改？',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button'),
    ).at(-1);
    fireEvent.click(confirm!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('只保存实际修改的字段，不把生效默认值固化进配置', async () => {
    const onClose = vi.fn();
    renderUi(<ConfigModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('模板仓库')).toBeTruthy());

    const templateTextarea = screen.getByDisplayValue('https://example.com/specs');
    fireEvent.change(templateTextarea, { target: { value: 'https://example.com/new' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(adapter.setConfig.mock.calls.map(([key]) => key)).toEqual(['registryTemplates']);
  });

  it('切换模型后手动改回旧维度仍以表单值为准', async () => {
    const onClose = vi.fn();
    renderUi(<ConfigModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByDisplayValue('Xenova/bge-small-zh-v1.5')).toBeTruthy());

    const modelInput = screen.getByDisplayValue('Xenova/bge-small-zh-v1.5') as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: 'Xenova/all-MiniLM-L6-v2' } });
    await waitFor(() => expect(screen.getByDisplayValue('384')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('384'), { target: { value: '512' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe(
        '关键配置修改确认',
      ),
    );
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button'),
    ).at(-1);
    fireEvent.click(confirm!);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(adapter.setConfig).toHaveBeenCalledWith(
      'rag.embedding.modelId',
      'Xenova/all-MiniLM-L6-v2',
      'global',
    );
    expect(adapter.setConfig).toHaveBeenCalledWith('rag.embedding.dimension', 512, 'global');
  });

  it('自定义模型：失焦后引导填写维度与前缀并保存', async () => {
    const onClose = vi.fn();
    renderUi(<ConfigModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByDisplayValue('Xenova/bge-small-zh-v1.5')).toBeTruthy());

    const modelInput = screen.getByDisplayValue('Xenova/bge-small-zh-v1.5') as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: 'custom/model' } });
    fireEvent.blur(modelInput);

    await waitFor(() => expect(screen.getByText('配置自定义模型')).toBeTruthy());
    const dimensionInput = screen.getByPlaceholderText('例如 384 / 512 / 768') as HTMLInputElement;
    expect(dimensionInput.value).toBe('512');
    fireEvent.change(dimensionInput, { target: { value: '640' } });
    const queryPrefixInput = document.querySelector<HTMLInputElement>(
      'input[placeholder*="query"]',
    )!;
    fireEvent.change(queryPrefixInput, { target: { value: 'query: ' } });
    const documentPrefixInput = document.querySelector<HTMLInputElement>(
      'input[placeholder*="passage"]',
    )!;
    fireEvent.change(documentPrefixInput, { target: { value: 'passage: ' } });
    fireEvent.click(screen.getByRole('button', { name: '应用参数' }));

    await waitFor(() => expect(screen.getAllByDisplayValue('640').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText(/模型将切换为 custom\/model/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe(
        '关键配置修改确认',
      ),
    );
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button'),
    ).at(-1);
    fireEvent.click(confirm!);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/模型已切换为 custom\/model；模型已安装/)).toBeTruthy(),
    );
    expect(adapter.setConfig).toHaveBeenCalledWith(
      'rag.embedding.modelId',
      'custom/model',
      'global',
    );
    expect(adapter.setConfig).toHaveBeenCalledWith('rag.embedding.dimension', 640, 'global');
    expect(adapter.setConfig).toHaveBeenCalledWith(
      'rag.embedding.queryPrefix',
      'query: ',
      'global',
    );
    expect(adapter.setConfig).toHaveBeenCalledWith(
      'rag.embedding.documentPrefix',
      'passage: ',
      'global',
    );
  });

  it('关键项修改弹确认；保存失败提示且不关闭', async () => {
    const onClose = vi.fn();
    renderUi(<ConfigModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByDisplayValue('512')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('512'), { target: { value: '768' } });
    await waitFor(() => expect(screen.getByText(/预设维度为 512，当前为 768/)).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText(/保存失败: 保存 向量维度 失败/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('本机配置字段与 Web 密码区：校验、设置、清除', async () => {
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

  it('展示当前模型未安装与索引模型不一致提示', async () => {
    adapter.getRagStatus.mockResolvedValueOnce({
      modelId: 'Xenova/bge-small-zh-v1.5',
      lastModelId: 'Xenova/all-MiniLM-L6-v2',
      modelInstalled: false,
      modelChanged: true,
    });
    renderUi(<ConfigModal open onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByText(
          /当前模型 Xenova\/bge-small-zh-v1\.5 与上次索引模型 Xenova\/all-MiniLM-L6-v2 不一致/,
        ),
      ).toBeTruthy(),
    );

    cleanup();
    adapter.getRagStatus.mockResolvedValueOnce({
      modelId: 'Xenova/bge-small-zh-v1.5',
      lastModelId: 'Xenova/bge-small-zh-v1.5',
      modelInstalled: false,
      modelChanged: false,
    });
    renderUi(<ConfigModal open onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/当前模型 Xenova\/bge-small-zh-v1\.5 尚未安装/)).toBeTruthy(),
    );
  });

  it('有未保存修改时切换范围或差异模式会先确认', async () => {
    renderUi(<ConfigModal open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('模板仓库')).toBeTruthy());
    const textarea = screen.getByDisplayValue('https://example.com/specs');
    fireEvent.change(textarea, { target: { value: 'https://example.com/new' } });
    const diffSwitch = document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-switch');
    fireEvent.click(diffSwitch!);
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe('切换显示模式'),
    );

    cleanup();
    renderUi(<ConfigModal open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('模板仓库')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('https://example.com/specs'), {
      target: { value: 'https://example.com/new2' },
    });
    fireEvent.click(screen.getByText('本机配置'));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe('切换配置范围'),
    );
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
