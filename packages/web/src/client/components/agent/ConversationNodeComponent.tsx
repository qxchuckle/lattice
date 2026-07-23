/**
 * ConversationNodeComponent — React Flow 自定义节点
 * 上：用户问题  中：AI 流式回答  下：配置条 + 输入框
 * 配色使用 CSS 变量，自动适配浅色/深色主题
 * 尺寸：NodeResizer 提供四角 + 四边共 8 个拖拽手柄，调整后触发碰撞重布局
 */
import { useState, useCallback, useRef, useLayoutEffect, memo } from 'react';
import {
  Handle,
  Position,
  NodeResizer,
  useStoreApi,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react';
import { useSnapshot } from 'valtio';
import {
  agentStore,
  submitFromNode,
  setNodeConfig,
  setNodeSize,
  liveResizeNode,
  formatTokens,
  AVAILABLE_MODELS,
  CONTEXT_SIZES,
  TOOL_PRESETS,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  type TreeNode,
} from './agentStore';
import { layoutTree } from './agentLayout';

interface NodeData {
  nodeId: string;
  [key: string]: unknown;
}

/** 紧凑下拉选择器 */
function MiniSelect({
  value,
  options,
  onChange,
  title,
}: {
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (v: string) => void;
  title: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        e.stopPropagation();
        onChange(e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      className='nowheel'
      style={{
        fontSize: 9,
        padding: '1px 3px',
        borderRadius: 3,
        border: '1px solid var(--border)',
        background: 'var(--bg-tertiary)',
        color: 'var(--text)',
        cursor: 'pointer',
        outline: 'none',
        maxWidth: 90,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ConversationNodeInner({ data }: NodeProps) {
  const { nodeId } = data as NodeData;
  const snap = useSnapshot(agentStore);
  const node = snap.nodes.get(nodeId) as TreeNode | undefined;
  const store = useStoreApi();
  const nodeElRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  // ── 配置条显示控制 ──
  const [hovered, setHovered] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [configFocused, setConfigFocused] = useState(false);

  /**
   * 尺寸变化后，在 DOM 更新完、浏览器绘制前（useLayoutEffect）同步重测 handleBounds。
   *
   * 连线端点取自 handleBounds，默认靠 ResizeObserver 异步重测：节点 DOM 先变大、
   * 手柄位置下一帧才更新，快速缩放时连线会明显滞后于节点。
   * 此处在 useLayoutEffect（DOM 已是新尺寸、尚未 paint）里直接调用 React Flow 官方
   * updateNodeInternals 同步重测，连线端点与节点尺寸在同一帧生效，全程贴合。
   * （不在 store 里手动推算 handleBounds——会与 ResizeObserver 的测量值互相覆盖、累积误差。）
   */
  useLayoutEffect(() => {
    const el = nodeElRef.current;
    if (!el) return;
    store
      .getState()
      .updateNodeInternals(new Map([[nodeId, { id: nodeId, nodeElement: el, force: true }]]));
  }, [node?.width, node?.height, nodeId, store]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    submitFromNode(nodeId, text);
    setInput('');
  }, [input, nodeId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation(); // 防止 React Flow 捕获事件
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  /**
   * 实时缩放 + 实时挤开，且连线始终贴合节点。
   *
   * 核心是「delta 平移法」解决坐标错位：
   * - NodeResizer 把被拖节点钉在光标位置 P1（params.x/y）；
   * - dagre 全局布局会把它算在另一位置 P2，若其他节点直接按 dagre 绝对位置摆放，
   *   就会对齐到"幻影 P2"而非真实的 P1，导致连线脱离节点（看似连线比节点快）。
   * - 解法：dagre 算出布局后取 delta = P1 - P2，把其他节点统一平移 delta。
   *   这样既保留 dagre 的相对结构（节点间相对位置不变 → 连线不脱离），
   *   又让被拖节点保持在光标处，实现"钉住单节点"的增量重布局。
   * - 所有位移通过与 React Flow 拖拽相同的 triggerNodeChanges 管线派发，
   *   与被拖节点自身的尺寸更新在同一事件帧生效，保证同步。
   */
  const handleResize = useCallback(
    (_e: unknown, params: { x: number; y: number; width: number; height: number }) => {
      liveResizeNode(nodeId, params.width, params.height);
      const allNodes = [...agentStore.nodes.values()] as TreeNode[];
      const { positions } = layoutTree(allNodes);
      const dagrePos = positions.get(nodeId);
      if (!dagrePos) return;

      // delta = 光标位置(P1) - dagre 位置(P2)，平移到其他节点上
      const dx = params.x - dagrePos.x;
      const dy = params.y - dagrePos.y;

      const { nodeLookup, triggerNodeChanges } = store.getState();

      const changes: NodeChange[] = [];
      for (const tn of allNodes) {
        if (tn.id === nodeId) continue; // 被拖节点由 NodeResizer 钉在光标处
        const dp = positions.get(tn.id);
        if (!dp) continue;
        const target = { x: dp.x + dx, y: dp.y + dy };
        const cur = nodeLookup.get(tn.id);
        // 仅位置真正变化才派发（0.5px 阈值避免浮点抖动）
        if (
          !cur ||
          Math.abs(cur.position.x - target.x) > 0.5 ||
          Math.abs(cur.position.y - target.y) > 0.5
        ) {
          changes.push({ id: tn.id, type: 'position', position: target });
        }
      }
      if (changes.length > 0) triggerNodeChanges(changes);
    },
    [nodeId, store],
  );

  if (!node) return null;

  const isStreaming = node.status === 'streaming';
  const isEmpty = node.status === 'empty';
  const isError = node.status === 'error';
  const hasChildren = node.childIds.length > 0;
  // 底部区域（状态栏 + 工具栏 + 输入框）仅在：hover / 输入框聚焦 / 有输入值 / 配置下拉聚焦 时显示
  const showBottom = hovered || inputFocused || configFocused || input.trim().length > 0;

  return (
    <div
      ref={nodeElRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: '100%', height: '100%' }}>
      {/* 8 向缩放手柄（四角 + 四边），悬浮时显示；结束拖拽 → 保存尺寸并触发碰撞重布局 */}
      <NodeResizer
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        isVisible={hovered}
        color='var(--brand-color)'
        handleStyle={{
          background: 'var(--brand-color)',
          width: 10,
          height: 10,
          borderRadius: 2,
          border: '1.5px solid var(--bg-secondary)',
        }}
        lineStyle={{ borderColor: 'var(--brand-color)', borderRadius: 10 }}
        onResize={handleResize}
        onResizeEnd={(_e, params) => setNodeSize(nodeId, params.width, params.height)}
      />
      <div
        className='nowheel conversation-node'
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 10,
          border: `1.5px solid ${isStreaming ? 'var(--brand-color)' : isError ? '#ff4d4f' : 'var(--border)'}`,
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: isStreaming ? '0 0 12px rgba(22,119,255,0.25)' : 'var(--shadow)',
          color: 'var(--text)',
        }}>
        {/* 连接点 */}
        <Handle
          type='target'
          position={Position.Top}
          style={{ background: 'var(--brand-color)', width: 6, height: 6 }}
        />
        <Handle
          type='source'
          position={Position.Bottom}
          style={{ background: 'var(--brand-color)', width: 6, height: 6 }}
        />

        {/* ── 上部：用户问题 ── */}
        {!isEmpty && (
          <div
            style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 10 }}>👤</span>
              <span style={{ fontSize: 10, color: 'var(--brand-color)', fontWeight: 600 }}>
                User
              </span>
              {hasChildren && (
                <span style={{ fontSize: 9, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                  ⑂ {node.childIds.length} 分支
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text)',
                lineHeight: 1.3,
                wordBreak: 'break-word',
              }}>
              {node.userMessage}
            </div>
          </div>
        )}

        {/* ── 中部：AI 回答（流式） ── */}
        {!isEmpty && (
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 10 }}>🤖</span>
              <span style={{ fontSize: 10, color: '#722ed1', fontWeight: 600 }}>Agent</span>
              {node.config.model && node.config.model !== 'qoder-default' && (
                <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                  · {node.config.model}
                </span>
              )}
              {isStreaming && (
                <span style={{ fontSize: 9, color: 'var(--brand-color)', marginLeft: 'auto' }}>
                  ● 生成中
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
              {node.assistantText || (isStreaming ? '...' : '')}
              {isStreaming && <span style={{ opacity: 0.6 }}>▊</span>}
            </div>
          </div>
        )}

        {/* 空节点提示 */}
        {isEmpty && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              fontSize: 12,
            }}>
            输入问题开始对话
          </div>
        )}

        {/* ── 底部区域：状态栏 + 工具栏 + 输入框（整体条件显示） ── */}
        {showBottom && (
          <div
            onFocusCapture={() => setConfigFocused(true)}
            onBlurCapture={() => setConfigFocused(false)}
            style={{ flexShrink: 0, borderTop: '1px solid var(--border)' }}>
            {/* Token 统计条（状态栏） */}
            {!isEmpty && (node.outputTokens > 0 || isStreaming) && (
              <div
                style={{
                  padding: '3px 10px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 9,
                  color: 'var(--text-secondary)',
                }}>
                <span title='输入 token'>↑ {formatTokens(node.inputTokens)}</span>
                <span title='输出 token'>↓ {formatTokens(node.outputTokens)}</span>
                {(isStreaming || node.tokensPerSecond > 0) && (
                  <span
                    title='输出速度'
                    style={{ color: isStreaming ? 'var(--brand-color)' : 'var(--text-secondary)' }}>
                    ⚡ {node.tokensPerSecond} tok/s
                  </span>
                )}
              </div>
            )}

            <div style={{ padding: '4px 8px 6px' }}>
              {/* 节点级配置：模型 / 上下文 / 工具（工具栏） */}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                <MiniSelect
                  value={node.config.model}
                  options={AVAILABLE_MODELS}
                  onChange={(v) => setNodeConfig(nodeId, { model: v })}
                  title='模型'
                />
                <MiniSelect
                  value={node.config.contextSize}
                  options={CONTEXT_SIZES}
                  onChange={(v) => setNodeConfig(nodeId, { contextSize: v })}
                  title='上下文大小'
                />
                <MiniSelect
                  value={node.config.tools}
                  options={TOOL_PRESETS}
                  onChange={(v) => setNodeConfig(nodeId, { tools: v })}
                  title='工具集'
                />
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  placeholder={isEmpty ? '输入问题...' : '继续追问...'}
                  rows={1}
                  className='nowheel'
                  style={{
                    flex: 1,
                    resize: 'none',
                    padding: '5px 8px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 5,
                    color: 'var(--text)',
                    fontSize: 11,
                    lineHeight: 1.3,
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || isStreaming}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: 'none',
                    fontSize: 11,
                    background:
                      input.trim() && !isStreaming ? 'var(--brand-color)' : 'var(--bg-tertiary)',
                    color: input.trim() && !isStreaming ? '#fff' : 'var(--text-secondary)',
                    cursor: input.trim() && !isStreaming ? 'pointer' : 'default',
                  }}>
                  ↵
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const ConversationNodeComponent = memo(ConversationNodeInner);
