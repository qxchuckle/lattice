/**
 * FileTreePanel — 文件树侧栏（workspace 项目文件浏览）
 */
import { useState, useCallback, useEffect } from 'react';
import { useSnapshot } from 'valtio';
import { workbenchStore, openFile, setFileTree } from './store';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
}

const FILE_ICONS: Record<string, string> = {
  ts: '📘',
  tsx: '⚛️',
  js: '📒',
  jsx: '⚛️',
  json: '📋',
  md: '📝',
  css: '🎨',
  less: '🎨',
  html: '🌐',
  yaml: '⚙️',
  yml: '⚙️',
  py: '🐍',
  go: '🔵',
  rs: '🦀',
  sh: '💻',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICONS[ext] ?? '📄';
}

function TreeNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (entry.type === 'directory') {
    return (
      <div>
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: '2px 4px',
            paddingLeft: depth * 14 + 4,
            cursor: 'pointer',
            fontSize: 12,
            color: '#ccc',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
          <span style={{ fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
          <span>📁</span>
          <span>{entry.name}</span>
        </div>
        {expanded &&
          entry.children?.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
      </div>
    );
  }

  return (
    <div
      onClick={() => openFile(entry.path)}
      style={{
        padding: '2px 4px',
        paddingLeft: depth * 14 + 18,
        cursor: 'pointer',
        fontSize: 12,
        color: '#aaa',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
      <span>{getFileIcon(entry.name)}</span>
      <span>{entry.name}</span>
    </div>
  );
}

export function FileTreePanel() {
  const snap = useSnapshot(workbenchStore);

  const loadTree = useCallback(async () => {
    if (snap.workspaceRoots.length === 0) return;
    try {
      const res = await fetch(
        `/api/fs/tree?root=${encodeURIComponent(snap.workspaceRoots[0])}&depth=3`,
      );
      if (res.ok) {
        const data = await res.json();
        setFileTree(data.entries ?? []);
      }
    } catch {
      /* ignore */
    }
  }, [snap.workspaceRoots]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  return (
    <div
      style={{
        width: 220,
        borderRight: '1px solid #333',
        overflow: 'auto',
        background: '#1a1a2e',
        height: '100%',
      }}>
      <div
        style={{
          padding: '8px 10px',
          fontSize: 11,
          color: '#888',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}>
        资源管理器
      </div>
      {snap.workspaceRoots.length > 0 && (
        <div style={{ padding: '2px 10px', fontSize: 11, color: '#1677ff' }}>
          {snap.workspaceRoots.map((r) => r.split('/').pop()).join(', ')}
        </div>
      )}
      {(snap.fileTree as FileEntry[]).map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} />
      ))}
      {snap.fileTree.length === 0 && (
        <div style={{ padding: 12, fontSize: 12, color: '#555' }}>
          {snap.workspaceRoots.length === 0 ? '切换任务以加载项目文件' : '加载中...'}
        </div>
      )}
    </div>
  );
}
