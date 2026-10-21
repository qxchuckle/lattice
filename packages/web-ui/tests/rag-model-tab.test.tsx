import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { RagModelTab } from '../src/components/admin/RagModelTab';
import { setAdapter } from '../src/adapters';
import { installDomStubs, renderUi } from './helpers/component';

const ragStatus = {
  modelId: 'Xenova/test',
  lastModelId: 'Xenova/test',
  modelInstalled: true,
  modelChanged: false,
  vectorDimension: 512,
  dtype: 'q8',
  pooling: 'mean',
  indexedDocuments: 2,
  totalEmbeddings: 3,
  ftsIndexVersion: 1,
  expectedFtsVersion: 2,
  distanceThreshold: 0.4,
  lastUpdated: null,
};

const modelStatus = {
  installed: true,
  loaded: false,
  loadError: '加载失败原因',
  isNetworkError: true,
  networkHint: '检查代理',
};

const adapter = {
  getRagStatus: vi.fn(async () => ragStatus),
  getModelStatus: vi.fn(async () => modelStatus),
  removeModel: vi.fn(async () => true),
};

function streamResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  installDomStubs();
  adapter.getRagStatus.mockClear();
  adapter.getModelStatus.mockClear();
  adapter.getRagStatus.mockResolvedValue(ragStatus);
  adapter.getModelStatus.mockResolvedValue(modelStatus);
  adapter.removeModel.mockClear();
  adapter.removeModel.mockResolvedValue(true);
  setAdapter(adapter as never);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/update')) {
        return streamResponse([
          'data: {"current":1,"total":2,"chunksProcessed":5,"currentFile":"/a/b.md"}\n',
          'data: {"done":true}\n',
        ]);
      }
      if (url.includes('/rebuild')) {
        return streamResponse(['data: {"done":true,"error":"重建失败"}\n']);
      }
      if (url.includes('/download')) {
        return streamResponse(['data: {"done":true}\n']);
      }
      return streamResponse(['data: {"done":true}\n']);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RagModelTab', () => {
  it('展示 RAG/模型状态、进度条与增量更新', async () => {
    renderUi(<RagModelTab />);
    await waitFor(() => expect(screen.getByText('RAG 索引')).toBeTruthy());
    expect(screen.getByText('Xenova/test')).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('模型管理')).toBeTruthy();
    expect(screen.getByText('加载失败原因')).toBeTruthy();
    expect(screen.getByText('检查代理')).toBeTruthy();
    expect(screen.getByText('重装')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /增量更新/ }));
    await waitFor(() => expect(screen.getByText('增量更新完成')).toBeTruthy());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/rag/update',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(adapter.getRagStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('全量重建失败、下载成功与删除确认', async () => {
    renderUi(<RagModelTab />);
    await waitFor(() => expect(screen.getByText('RAG 索引')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /全量重建/ }));
    await waitFor(() => expect(screen.getByText('操作失败: 重建失败')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /重装/ }));
    await waitFor(() => expect(screen.getByText('模型下载完成')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')?.textContent).toBe(
        '删除已安装的模型',
      ),
    );
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button'),
    ).at(-1);
    fireEvent.click(confirm!);
    await waitFor(() => expect(adapter.removeModel).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('模型已删除')).toBeTruthy());
  });

  it('模型未安装或索引模型不一致时展示 rebuild 联动提示', async () => {
    adapter.getRagStatus.mockResolvedValueOnce({
      ...ragStatus,
      modelInstalled: false,
      modelChanged: true,
      lastModelId: 'Xenova/old',
    });
    renderUi(<RagModelTab />);
    await waitFor(() =>
      expect(
        screen.getByText(/当前配置模型 Xenova\/test 与索引模型 Xenova\/old 不一致.*新模型尚未安装/),
      ).toBeTruthy(),
    );

    cleanup();
    adapter.getRagStatus.mockResolvedValueOnce({
      ...ragStatus,
      modelInstalled: false,
      modelChanged: false,
    });
    renderUi(<RagModelTab />);
    await waitFor(() =>
      expect(screen.getByText(/当前模型 Xenova\/test 尚未安装.*全量重建/)).toBeTruthy(),
    );
  });

  it('未安装模型显示下载、已加载禁用删除；下载失败分支', async () => {
    adapter.getModelStatus.mockResolvedValue({
      installed: false,
      loaded: false,
      isNetworkError: false,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      streamResponse(['data: {"done":true,"error":"网络错误"}\n']),
    );
    renderUi(<RagModelTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: /下\s*载/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /下\s*载/ }));
    await waitFor(() => expect(screen.getByText('下载失败: 网络错误')).toBeTruthy());

    cleanup();
    adapter.getModelStatus.mockResolvedValue({ installed: true, loaded: true });
    renderUi(<RagModelTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: /删\s*除/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /删\s*除/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/模型已加载中/)).toBeTruthy();
  });
});
