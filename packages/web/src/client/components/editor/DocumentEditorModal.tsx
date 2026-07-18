import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Modal, Button, Segmented, App, Spin, Switch } from 'antd';
import { EditOutlined, SaveOutlined } from '@ant-design/icons';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';
import { useTheme, useIsMobile } from '../../hooks';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface DocumentEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** 内容类型：prd / design / progress / spec */
  contentType: string;
  /** 实体 ID（任务 ID 或 spec 文件路径） */
  entityId: string;
  /** 文档标题 */
  title: string;
  /** 是否 YAML 文件（progress.yaml） */
  isYaml?: boolean;
}

export const DocumentEditorModal = memo(function DocumentEditorModal({
  open,
  onClose,
  contentType,
  entityId,
  title,
  isYaml,
}: DocumentEditorModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { mode: themeMode } = useTheme();
  const isMobile = useIsMobile();
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('split');
  const [saving, setSaving] = useState(false);
  const [syncScroll, setSyncScroll] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const editorViewRef = useRef<EditorView | null>(null);
  const [editorReadyKey, setEditorReadyKey] = useState(0);

  // 分屏同步滚动：编辑器与预览区按 scrollTop 比例同步
  // 依赖 editorReadyKey（onCreateEditor 触发）确保 CodeMirror 已渲染，用 view.scrollDOM 获取滚动元素
  useEffect(() => {
    if (mode !== 'split' || !syncScroll) return;
    const editorScroller = editorViewRef.current?.scrollDOM ?? null;
    const preview = previewRef.current;
    if (!editorScroller || !preview) return;

    const syncToPreview = () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      const max = editorScroller.scrollHeight - editorScroller.clientHeight;
      const ratio = max > 0 ? editorScroller.scrollTop / max : 0;
      const previewMax = preview.scrollHeight - preview.clientHeight;
      preview.scrollTop = ratio * previewMax;
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    };
    const syncToEditor = () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      const max = preview.scrollHeight - preview.clientHeight;
      const ratio = max > 0 ? preview.scrollTop / max : 0;
      const editorMax = editorScroller.scrollHeight - editorScroller.clientHeight;
      editorScroller.scrollTop = ratio * editorMax;
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    };

    editorScroller.addEventListener('scroll', syncToPreview);
    preview.addEventListener('scroll', syncToEditor);
    return () => {
      editorScroller.removeEventListener('scroll', syncToPreview);
      preview.removeEventListener('scroll', syncToEditor);
    };
  }, [mode, syncScroll, editorReadyKey]);

  // 每次打开时重置状态
  useEffect(() => {
    if (open) {
      setContent('');
      setLoadKey((k) => k + 1);
    }
  }, [open, entityId, contentType]);

  // 加载文档内容 — 用 loadKey 强制每次打开都重新请求
  const [loadKey, setLoadKey] = useState(0);
  const { isLoading } = useQuery({
    queryKey: ['content', contentType, entityId, loadKey],
    queryFn: async () => {
      const adapter = getAdapter();
      const data = await adapter.getContent(contentType, entityId);
      setContent(data ?? '');
      return data;
    },
    enabled: open,
    staleTime: 0,
  });

  const extensions = useMemo(
    () =>
      isYaml
        ? [yaml(), ...(wordWrap ? [EditorView.lineWrapping] : [])]
        : [markdown({ base: markdownLanguage }), ...(wordWrap ? [EditorView.lineWrapping] : [])],
    [isYaml, wordWrap],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const adapter = getAdapter();
      await adapter.saveContent(contentType, entityId, content);
      message.success('已保存，RAG 索引已自动更新');
      queryClient.invalidateQueries({ queryKey: ['content', contentType, entityId] });
      queryClient.invalidateQueries({ queryKey: ['rag-status'] });
      onClose();
    } catch (err) {
      message.error(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [content, contentType, entityId, message, onClose, queryClient]);

  return (
    <Modal
      title={`编辑 - ${title}`}
      open={open}
      onCancel={onClose}
      width='90%'
      style={{ top: 20 }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Segmented
              size='small'
              value={mode}
              onChange={(v) => setMode(v as 'edit' | 'preview' | 'split')}
              options={[
                { label: '编辑', value: 'edit' },
                { label: '预览', value: 'preview' },
                { label: '分屏', value: 'split' },
              ]}
            />
            {mode === 'split' && (
              <Switch
                size='small'
                checked={syncScroll}
                onChange={setSyncScroll}
                checkedChildren='同步滚动'
                unCheckedChildren='独立滚动'
              />
            )}
            <Switch
              size='small'
              checked={wordWrap}
              onChange={setWordWrap}
              checkedChildren='换行'
              unCheckedChildren='滚动'
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onClose}>取消</Button>
            <Button type='primary' icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      }>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin tip='加载中...' />
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: 8,
            height: isMobile ? 'calc(100vh - 250px)' : 'calc(100vh - 200px)',
          }}>
          {(mode === 'edit' || mode === 'split') && (
            <div
              ref={editorWrapRef}
              style={{
                flex: mode === 'split' ? (isMobile ? '1 1 50%' : '1 1 50%') : '1 1 100%',
                overflow: 'auto',
                border: '1px solid var(--border-color, #d9d9d9)',
                borderRadius: 6,
                minHeight: isMobile && mode === 'split' ? '120px' : undefined,
              }}>
              <CodeMirror
                value={content}
                onChange={(val) => setContent(val)}
                extensions={extensions}
                theme={themeMode === 'dark' ? 'dark' : 'light'}
                height='100%'
                style={{ height: '100%', fontSize: 13 }}
                onCreateEditor={(view) => {
                  editorViewRef.current = view;
                  setEditorReadyKey((k) => k + 1);
                }}
              />
            </div>
          )}
          {mode === 'preview' && (
            <div
              style={{
                flex: '1 1 100%',
                overflow: 'auto',
                padding: 16,
                border: '1px solid var(--border-color, #d9d9d9)',
                borderRadius: 6,
              }}
              className='markdown-body'>
              <MarkdownPreview content={content} isYaml={isYaml} />
            </div>
          )}
          {mode === 'split' && (
            <div
              ref={previewRef}
              style={{
                flex: '1 1 50%',
                overflow: 'auto',
                padding: isMobile ? 8 : 16,
                border: '1px solid var(--border-color, #d9d9d9)',
                borderRadius: 6,
                minHeight: isMobile ? '120px' : undefined,
              }}
              className='markdown-body'>
              <MarkdownPreview content={content} isYaml={isYaml} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
});

/** 剥离 YAML frontmatter */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n+/, '');
}

/** 简易 Markdown/YAML 预览 */
function MarkdownPreview({ content, isYaml }: { content: string; isYaml?: boolean }) {
  if (isYaml) {
    return <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{content}</pre>;
  }
  const body = stripFrontmatter(content);
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>;
}

/** 文档编辑按钮 */
export function EditButton({
  contentType,
  entityId,
  title,
  isYaml,
  size = 'small',
}: {
  contentType: string;
  entityId: string;
  title: string;
  isYaml?: boolean;
  size?: 'small' | 'middle';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} type='text' icon={<EditOutlined />} onClick={() => setOpen(true)}>
        编辑
      </Button>
      <DocumentEditorModal
        open={open}
        onClose={() => setOpen(false)}
        contentType={contentType}
        entityId={entityId}
        title={title}
        isYaml={isYaml}
      />
    </>
  );
}
