import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { DocumentEditorModal } from '../src/components/editor/DocumentEditorModal';
import { setAdapter } from '../src/adapters';
import { themeStore } from '../src/store';
import { installDomStubs, renderUi } from './helpers/component';

vi.mock('@uiw/react-codemirror', async () => {
  const React = await import('react');
  return {
    default: function CodeMirrorMock({
      value,
      onChange,
      onCreateEditor,
    }: {
      value: string;
      onChange?: (value: string) => void;
      onCreateEditor?: (view: { scrollDOM: HTMLElement | null }) => void;
    }) {
      const ref = React.useRef<HTMLTextAreaElement>(null);
      const called = React.useRef(false);
      React.useEffect(() => {
        if (called.current) return;
        called.current = true;
        onCreateEditor?.({ scrollDOM: ref.current });
      }, []);
      return React.createElement('textarea', {
        ref,
        'data-testid': 'cm-editor',
        value,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
      });
    },
  };
});
vi.mock('@codemirror/lang-markdown', () => ({ markdown: () => ({}), markdownLanguage: {} }));
vi.mock('@codemirror/lang-yaml', () => ({ yaml: () => ({}) }));
vi.mock('@codemirror/view', () => ({ EditorView: { lineWrapping: {} } }));

const adapter = {
  getContent: vi.fn(async () => '---\ntitle: t\n---\n\n# 正文标题\n\n内容'),
  saveContent: vi.fn(async () => true),
};

beforeEach(() => {
  installDomStubs();
  cleanup();
  adapter.getContent.mockReset();
  adapter.getContent.mockResolvedValue('---\ntitle: t\n---\n\n# 正文标题\n\n内容');
  adapter.saveContent.mockReset();
  adapter.saveContent.mockResolvedValue(true);
  setAdapter(adapter as never);
  themeStore.mode = 'light';
  window.innerWidth = 1280;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  themeStore.mode = 'light';
});

describe('DocumentEditorModal', () => {
  it('加载内容、编辑/预览/分屏切换、同步滚动与保存成功', async () => {
    const onClose = vi.fn();
    const { container } = renderUi(
      <DocumentEditorModal
        open
        onClose={onClose}
        contentType='spec'
        entityId='/u/a.md'
        title='A 文档'
      />,
    );
    await waitFor(() => expect(screen.getByText('正文标题')).toBeTruthy());
    expect(adapter.getContent).toHaveBeenCalledWith('spec', '/u/a.md');
    const editor = screen.getByTestId('cm-editor') as HTMLTextAreaElement;
    expect(editor.value).toContain('# 正文标题');
    expect(screen.getByText('编辑 - A 文档')).toBeTruthy();

    // 模式切换：编辑 → 预览 → 分屏
    fireEvent.click(screen.getByText('编辑'));
    await waitFor(() => expect(screen.queryByTestId('cm-editor')).toBeTruthy());
    fireEvent.click(screen.getByText('预览'));
    await waitFor(() => expect(screen.queryByTestId('cm-editor')).toBeNull());
    fireEvent.click(screen.getByText('分屏'));
    await waitFor(() => expect(screen.queryByTestId('cm-editor')).toBeTruthy());

    // 同步滚动开关 + 滚动事件
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);
    fireEvent.click(switches[0]);
    const scroller = screen.getByTestId('cm-editor');
    fireEvent.scroll(scroller);
    const preview = document.querySelector('.markdown-body') as HTMLElement;
    fireEvent.scroll(preview);

    fireEvent.change(screen.getByTestId('cm-editor'), { target: { value: '# 修改后' } });
    await waitFor(() => expect(screen.getByText('修改后')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(adapter.saveContent).toHaveBeenCalledWith('spec', '/u/a.md', '# 修改后');

    // 取消
    cleanup();
    renderUi(
      <DocumentEditorModal
        open
        onClose={onClose}
        contentType='spec'
        entityId='/u/a.md'
        title='A 文档'
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('只读模式隐藏编辑/保存、显示只读提示与关闭按钮', async () => {
    const onClose = vi.fn();
    const { container } = renderUi(
      <DocumentEditorModal
        open
        onClose={onClose}
        contentType='spec'
        entityId='domain:abc'
        title='域文档'
        readOnly
      />,
    );
    await waitFor(() => expect(screen.getByText('查看 - 域文档')).toBeTruthy());
    expect(screen.getByText(/域数据只读/)).toBeTruthy();
    expect(screen.queryByTestId('cm-editor')).toBeNull();
    expect(screen.queryByRole('button', { name: /保\s*存/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /关\s*闭/ }));
    expect(onClose).toHaveBeenCalled();
    expect(document.querySelector('.markdown-body')).toBeTruthy();

    fireEvent.click(screen.getByText('原始'));
    await waitFor(() => expect(screen.getByTestId('cm-editor')).toBeTruthy());
  });

  it('YAML 预览、移动端分屏、加载态与保存失败', async () => {
    window.innerWidth = 500;
    renderUi(
      <DocumentEditorModal
        open
        onClose={vi.fn()}
        contentType='progress'
        entityId='t1'
        title='进度'
        isYaml
      />,
    );
    await waitFor(() => expect(document.querySelector('.markdown-body pre')).toBeTruthy());
    const pre = document.querySelector('.markdown-body pre')!;
    expect(pre.textContent).toContain('title: t');

    fireEvent.click(screen.getByText('编辑'));
    await waitFor(() => expect(screen.getByTestId('cm-editor')).toBeTruthy());
    fireEvent.change(screen.getByTestId('cm-editor'), { target: { value: 'a: 1' } });
    adapter.saveContent.mockRejectedValueOnce(new Error('磁盘只读'));
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(screen.getByText(/保存失败: 磁盘只读/)).toBeTruthy());

    cleanup();
    let resolveContent: (value: string) => void = () => {};
    adapter.getContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveContent = resolve;
        }),
    );
    renderUi(
      <DocumentEditorModal
        open
        onClose={vi.fn()}
        contentType='spec'
        entityId='/u/b.md'
        title='B'
      />,
    );
    await waitFor(() => expect(document.body.textContent).toContain('加载中'));
    resolveContent('# B');
    await waitFor(() => expect(screen.getByText('B')).toBeTruthy());
  });
});
