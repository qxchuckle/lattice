/**
 * MergeDialog — 分支合并对话框（squash / cherry-pick / reference）
 */
import { useState, useCallback } from 'react';
import { useSnapshot } from 'valtio';
import { workbenchStore, closeMergeDialog } from './store';
import { post } from '../../api/request';

type MergeMode = 'squash' | 'cherry-pick' | 'reference';

interface Props {
  onMerge: (branchId: string, targetNodeId: string, mode: MergeMode, summary: string) => void;
}

export function MergeDialog({ onMerge }: Props) {
  const snap = useSnapshot(workbenchStore);
  const [mode, setMode] = useState<MergeMode>('squash');
  const [summary, setSummary] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [generating, setGenerating] = useState(false);

  const branchId = snap.mergeDialogBranchId;
  if (!branchId) return null;

  // 可选目标节点（默认路径上的节点）
  const targetOptions = snap.nodes.filter(
    (n) => n.branchId === (snap.tree?.defaultBranchId ?? 'default'),
  );

  const handleGenerateSummary = useCallback(async () => {
    setGenerating(true);
    // 调用后端 AI 生成摘要
    try {
      const data = await post<{ summary: string }>('/api/agent/merge-summary', {
        branchId,
        treeId: snap.treeId,
      });
      setSummary(data.summary ?? '');
    } catch {
      /* ignore */
    }
    setGenerating(false);
  }, [branchId, snap.treeId]);

  const handleConfirm = useCallback(() => {
    if (!branchId || !targetNodeId) return;
    onMerge(branchId, targetNodeId, mode, summary);
    closeMergeDialog();
  }, [branchId, targetNodeId, mode, summary, onMerge]);

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 15 }}>⑃ 合并分支</h3>

        <label style={labelStyle}>合并模式</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['squash', 'cherry-pick', 'reference'] as MergeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                ...modeBtnStyle,
                borderColor: mode === m ? '#1677ff' : '#444',
                color: mode === m ? '#1677ff' : '#888',
              }}>
              {m === 'squash' ? '压缩合并' : m === 'cherry-pick' ? '逐条选取' : '引用注入'}
            </button>
          ))}
        </div>

        <label style={labelStyle}>目标节点（合并到哪）</label>
        <select
          value={targetNodeId}
          onChange={(e) => setTargetNodeId(e.target.value)}
          style={selectStyle}>
          <option value=''>选择目标节点...</option>
          {targetOptions.map((n) => (
            <option key={n.id} value={n.id}>
              {n.role}:{' '}
              {n.content[0] && 'text' in n.content[0] && n.content[0].text
                ? n.content[0].text.slice(0, 40)
                : n.id.slice(0, 8)}
            </option>
          ))}
        </select>

        <label style={labelStyle}>合并摘要</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button onClick={handleGenerateSummary} disabled={generating} style={genBtnStyle}>
            {generating ? '生成中...' : '🤖 AI 生成摘要'}
          </button>
        </div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder='总结合并内容（将注入目标路径作为 merge-summary 节点）'
          style={textareaStyle}
          rows={4}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={closeMergeDialog} style={cancelBtnStyle}>
            取消
          </button>
          <button onClick={handleConfirm} disabled={!targetNodeId} style={confirmBtnStyle}>
            确认合并
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const dialogStyle: React.CSSProperties = {
  background: '#1e1e2e',
  borderRadius: 8,
  padding: 20,
  width: 420,
  border: '1px solid #444',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  display: 'block',
  marginBottom: 4,
};
const modeBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  border: '1px solid',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
};
const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: '#2a2a3e',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#ccc',
  fontSize: 12,
  marginBottom: 12,
};
const genBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  border: '1px solid #722ed1',
  background: 'transparent',
  color: '#722ed1',
  borderRadius: 3,
  cursor: 'pointer',
};
const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px',
  background: '#2a2a3e',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#ccc',
  fontSize: 12,
  resize: 'vertical',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  border: '1px solid #555',
  background: 'transparent',
  color: '#888',
  borderRadius: 4,
  cursor: 'pointer',
};
const confirmBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  border: 'none',
  background: '#1677ff',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
};
