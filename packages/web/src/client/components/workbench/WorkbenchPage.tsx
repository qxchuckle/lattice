/**
 * WorkbenchPage — 工作台主页面
 * 三种布局模式：Tree Focus / Split / Code Focus
 */
import { useEffect, useCallback, useState } from 'react';
import { useSnapshot } from 'valtio';
import { ReactFlowProvider } from '@xyflow/react';
import type { PromptSegment } from '@qcqx/lattice-agent-protocol';
import { ConversationTreeCanvas } from './ConversationTreeCanvas';
import { AgentInputPanel } from './AgentInputPanel';
import { MonacoEditorPanel } from './MonacoEditorPanel';
import { FileTreePanel } from './FileTreePanel';
import { MergeDialog } from './MergeDialog';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { useAgentSocket } from './useAgentSocket';
import { workbenchStore, selectNode, openForkDialog } from './store';

type LayoutMode = 'tree' | 'split' | 'code';

export function WorkbenchPage() {
  const snap = useSnapshot(workbenchStore);
  const { createSession, sendMessage, fork, switchHead } = useAgentSocket();
  const [layout, setLayout] = useState<LayoutMode>('tree');
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  // 首次加载自动创建会话
  useEffect(() => {
    if (!snap.sessionId && snap.wsConnected) {
      createSession({});
    }
  }, [snap.sessionId, snap.wsConnected, createSession]);

  const handleSend = useCallback(
    (message: string, segments?: PromptSegment[]) => {
      sendMessage(message, segments);
    },
    [sendMessage],
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      switchHead(nodeId);
    },
    [switchHead],
  );

  const handleFork = useCallback(() => {
    const targetId = workbenchStore.selectedNodeId ?? workbenchStore.headNodeId;
    if (targetId) {
      fork(targetId, `exploration-${Date.now().toString(36)}`);
    }
  }, [fork]);

  const handleNodeContextMenu = useCallback((nodeId: string) => {
    selectNode(nodeId);
    openForkDialog(nodeId);
  }, []);

  const handleMerge = useCallback(
    (branchId: string, targetNodeId: string, mode: string, summary: string) => {
      // 通过 WS 发送 merge 请求
      sendMessage(`__merge__:${branchId}:${targetNodeId}:${mode}:${summary}`);
    },
    [sendMessage],
  );

  const handleDeleteExecute = useCallback(
    (ids: string[]) => {
      // 通过 WS 发送删除请求
      for (const id of ids) {
        sendMessage(`__delete__:${id}`);
      }
      setDeleteIds([]);
    },
    [sendMessage],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
        background: '#12121e',
      }}>
      {/* 顶栏 */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid #333',
          gap: 12,
          fontSize: 13,
          color: '#ccc',
          flexShrink: 0,
        }}>
        <strong style={{ color: '#fff' }}>Lattice Workbench</strong>
        <span style={{ color: '#555' }}>|</span>
        <span style={{ color: '#888' }}>
          {snap.tree ? (snap.tree.title ?? snap.tree.id.slice(0, 8)) : '未连接'}
        </span>

        {/* 布局切换 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {(['tree', 'split', 'code'] as LayoutMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setLayout(m)}
              style={{
                padding: '3px 10px',
                fontSize: 11,
                border: '1px solid #444',
                background: layout === m ? '#1677ff' : 'transparent',
                color: layout === m ? '#fff' : '#888',
                borderRadius: 3,
                cursor: 'pointer',
              }}>
              {m === 'tree' ? '🌳 Tree' : m === 'split' ? '◫ Split' : '📝 Code'}
            </button>
          ))}
        </div>

        <span style={{ fontSize: 11, color: snap.wsConnected ? '#52c41a' : '#ff4d4f' }}>
          {snap.wsConnected ? '● 已连接' : '○ 断开'}
        </span>
      </div>

      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Tree Focus 模式 */}
        {layout === 'tree' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              {snap.nodes.length > 0 ? (
                <ReactFlowProvider>
                  <ConversationTreeCanvas
                    onNodeClick={handleNodeClick}
                    onNodeContextMenu={handleNodeContextMenu}
                  />
                </ReactFlowProvider>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: '#555',
                    fontSize: 14,
                  }}>
                  {snap.wsConnected ? '发送消息开始对话...' : '正在连接 Agent...'}
                </div>
              )}
            </div>
            <AgentInputPanel onSend={handleSend} onFork={handleFork} />
          </div>
        )}

        {/* Split 模式：左树右编辑器 */}
        {layout === 'split' && (
          <>
            <div
              style={{
                width: '45%',
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid #333',
              }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <ReactFlowProvider>
                  <ConversationTreeCanvas
                    onNodeClick={handleNodeClick}
                    onNodeContextMenu={handleNodeContextMenu}
                  />
                </ReactFlowProvider>
              </div>
              <AgentInputPanel onSend={handleSend} onFork={handleFork} />
            </div>
            <div style={{ flex: 1, display: 'flex' }}>
              <FileTreePanel />
              <div style={{ flex: 1 }}>
                <MonacoEditorPanel />
              </div>
            </div>
          </>
        )}

        {/* Code Focus 模式：编辑器为主 + 右侧竖向树缩略 */}
        {layout === 'code' && (
          <>
            <FileTreePanel />
            <div style={{ flex: 1 }}>
              <MonacoEditorPanel />
            </div>
            <div
              style={{
                width: 280,
                borderLeft: '1px solid #333',
                display: 'flex',
                flexDirection: 'column',
              }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <ReactFlowProvider>
                  <ConversationTreeCanvas
                    onNodeClick={handleNodeClick}
                    onNodeContextMenu={handleNodeContextMenu}
                  />
                </ReactFlowProvider>
              </div>
              <AgentInputPanel onSend={handleSend} onFork={handleFork} />
            </div>
          </>
        )}
      </div>

      {/* 对话框 */}
      {snap.mergeDialogOpen && <MergeDialog onMerge={handleMerge} />}
      {deleteIds.length > 0 && (
        <DeleteConfirmDialog
          nodeIds={deleteIds}
          onConfirm={handleDeleteExecute}
          onCancel={() => setDeleteIds([])}
        />
      )}
    </div>
  );
}
