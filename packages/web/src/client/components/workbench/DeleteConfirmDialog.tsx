/**
 * DeleteConfirmDialog — 节点删除二次确认（单节点/批量）
 */
import { useCallback } from 'react';
import { useSnapshot } from 'valtio';
import { workbenchStore } from './store';

interface Props {
  nodeIds: string[];
  onConfirm: (ids: string[], rollbackCode: boolean) => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({ nodeIds, onConfirm, onCancel }: Props) {
  const snap = useSnapshot(workbenchStore);

  const nodesToDelete = snap.nodes.filter((n) => nodeIds.includes(n.id));

  const handleConfirm = useCallback((rollback: boolean) => {
    onConfirm(nodeIds, rollback);
  }, [nodeIds, onConfirm]);

  if (nodeIds.length === 0) return null;

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <h3 style={{ margin: '0 0 12px', color: '#ff4d4f', fontSize: 15 }}>确认删除？</h3>

        <p style={{ fontSize: 13, color: '#ccc', margin: '0 0 8px' }}>
          将删除 {nodeIds.length} 个节点：
        </p>
        <div style={{ maxHeight: 120, overflow: 'auto', marginBottom: 12 }}>
          {nodesToDelete.map((n) => (
            <div key={n.id} style={{ fontSize: 12, color: '#888', padding: '2px 0' }}>
              · {n.role}: {n.content[0]?.text?.slice(0, 50) ?? n.id.slice(0, 12)}
            </div>
          ))}
        </div>

        <p style={{ fontSize: 12, color: '#faad14', margin: '0 0 16px' }}>
          ⚠ 此操作不可撤销
        </p>

        <label style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <input type="checkbox" id="rollback-code" />
          同时回滚关联的代码变更
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={cancelBtnStyle}>取消</button>
          <button
            onClick={() => {
              const rollback = (document.getElementById('rollback-code') as HTMLInputElement)?.checked ?? false;
              handleConfirm(rollback);
            }}
            style={deleteBtnStyle}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const dialogStyle: React.CSSProperties = {
  background: '#1e1e2e', borderRadius: 8, padding: 20, width: 380,
  border: '1px solid #444', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, border: '1px solid #555',
  background: 'transparent', color: '#888', borderRadius: 4, cursor: 'pointer',
};
const deleteBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, border: 'none',
  background: '#ff4d4f', color: '#fff', borderRadius: 4, cursor: 'pointer',
};
