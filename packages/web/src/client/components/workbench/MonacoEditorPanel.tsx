/**
 * MonacoEditorPanel — 多 tab 代码编辑器 + DiffEditor
 */
import { useCallback, useRef } from 'react';
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react';
import { useSnapshot } from 'valtio';
import { workbenchStore, closeTab, setActiveTab, markDirty, closeDiff } from './store';

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  less: 'less',
  scss: 'scss',
  html: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  bash: 'shell',
  sql: 'sql',
  toml: 'ini',
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG_MAP[ext] ?? 'plaintext';
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function MonacoEditorPanel() {
  const snap = useSnapshot(workbenchStore);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const activeTab = snap.activeTabIndex >= 0 ? snap.editorTabs[snap.activeTabIndex] : null;

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    // 选区跟踪：供输入框 @selection 引用（空选区时清空）
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      const text = sel ? (editor.getModel()?.getValueInRange(sel) ?? '') : '';
      const tab = workbenchStore.editorTabs[workbenchStore.activeTabIndex];
      const name = tab ? (tab.path.split('/').pop() ?? tab.path) : '';
      workbenchStore.editorSelection = text.trim()
        ? { text, display: `${name}:${sel?.startLineNumber ?? ''}` }
        : null;
    });
  }, []);

  const handleAcceptDiff = useCallback(() => {
    if (snap.diffView) {
      // 接受修改 → 写入文件
      fetch('/api/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: snap.diffView.path, content: snap.diffView.modified }),
      });
      closeDiff();
    }
  }, [snap.diffView]);

  const handleRejectDiff = useCallback(() => {
    closeDiff();
  }, []);

  // Diff 视图
  if (snap.diffView) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div
          style={{
            padding: '6px 12px',
            background: '#1a1a2e',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid #333',
          }}>
          <span style={{ color: '#faad14', fontWeight: 600 }}>⑃ Diff:</span>
          <span style={{ color: '#ccc', fontSize: 12 }}>{snap.diffView.path}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={handleAcceptDiff} style={btnStyle('#52c41a')}>
              ✓ 接受
            </button>
            <button onClick={handleRejectDiff} style={btnStyle('#ff4d4f')}>
              ✗ 拒绝
            </button>
          </div>
        </div>
        <DiffEditor
          height='100%'
          language={getLanguage(snap.diffView.path)}
          original={snap.diffView.original}
          modified={snap.diffView.modified}
          theme='vs-dark'
          options={{ readOnly: false, renderSideBySide: true, minimap: { enabled: false } }}
        />
      </div>
    );
  }

  // 普通编辑视图
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab 栏 */}
      <div
        style={{
          display: 'flex',
          background: '#1a1a2e',
          borderBottom: '1px solid #333',
          overflow: 'auto',
        }}>
        {snap.editorTabs.map((tab, i) => (
          <div
            key={tab.path}
            onClick={() => setActiveTab(i)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              cursor: 'pointer',
              color: i === snap.activeTabIndex ? '#fff' : '#888',
              background: i === snap.activeTabIndex ? '#252540' : 'transparent',
              borderRight: '1px solid #333',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
            }}>
            {tab.isDirty && <span style={{ color: '#faad14' }}>●</span>}
            {fileName(tab.path)}
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeTab(i);
              }}
              style={{ marginLeft: 4, opacity: 0.5, cursor: 'pointer' }}>
              ✕
            </span>
          </div>
        ))}
        {snap.editorTabs.length === 0 && (
          <div style={{ padding: '6px 12px', color: '#555', fontSize: 12 }}>无打开文件</div>
        )}
      </div>

      {/* 编辑器 */}
      {activeTab ? (
        <Editor
          height='100%'
          language={getLanguage(activeTab.path)}
          path={activeTab.path}
          theme='vs-dark'
          onMount={handleEditorMount}
          onChange={() => markDirty(activeTab.path, true)}
          options={{
            minimap: { enabled: true },
            fontSize: 13,
            lineNumbers: 'on',
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
          }}
          loading={<div style={{ color: '#666', padding: 20 }}>加载中...</div>}
        />
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#555',
          }}>
          从文件树选择文件打开
        </div>
      )}
    </div>
  );
}

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '2px 10px',
    fontSize: 12,
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    borderRadius: 3,
    cursor: 'pointer',
  };
}
