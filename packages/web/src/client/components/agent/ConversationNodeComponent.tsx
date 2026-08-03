/**
 * ConversationNodeComponent — 一轮对话节点（用户问题 + AI 回复合体）
 * 上部：用户问题  中部：AI 块流  底部：输入框（追问 = 创建子节点）
 */
import { useState, useCallback, useRef, useLayoutEffect, useEffect, memo } from 'react';
import { Handle, Position, NodeResizer, useStoreApi, type NodeProps } from '@xyflow/react';
import { proxy, useSnapshot } from 'valtio';
import { Popover } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import type { ModelListItem, PromptSegment } from '@qcqx/lattice-agent-protocol';
import { projectNodeCapabilities } from '@qcqx/lattice-agent-protocol';
import { fmtTokens } from './ModelTuningModal';
import { ChatInputBox, ModelMenuChip } from './ChatInputBar';
import { QueuedMessagesPanel } from './QueuedMessagesPanel';
import { MISSING_TURN } from './store';
import {
  agentStore,
  submitFromNode,
  abortStream,
  retryTurn,
  continueTurn,
  undoTurn,
  deleteTurn,
  getChildIds,
  getSiblings,
  fetchModelsCached,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  type TurnNode,
  type NodeUiState,
} from './agentStore';
import { useNodeResize } from './useNodeResize';
import { turnStyleFlags } from './turnState';
import { ContentRenderer, UsageFooter, FileChangeSummary } from './blocks';

interface NodeData {
  turnId: string;
  [key: string]: unknown;
}

/** 稳定空 ui 兑底（useSnapshot 不可条件调用） */
const EMPTY_UI = proxy<NodeUiState>({ width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });

/**
 * 兄弟分支计数指示器（◀ n/m ▶）。独立成组件以隔离重渲染：
 * valtio 不追踪 Map 变更，本组件订阅 turnStructureVersion（turn 增/删时 bump），
 * 仅指示器自身随兄弟增删重渲染，不牵连整个节点重渲染（性能考量，见用户要求）。
 */
function SiblingIndicator({ turnId }: { turnId: string }) {
  const { turnStructureVersion } = useSnapshot(agentStore);
  void turnStructureVersion; // 建立订阅：结构变化时重渲染本指示器
  const siblings = getSiblings(turnId);
  if (siblings.length <= 1) return null;
  const siblingIndex = siblings.indexOf(turnId);
  return (
    <span style={{ fontSize: 9, color: 'var(--text-secondary)', marginLeft: 4 }}>
      ◀ {siblingIndex + 1}/{siblings.length} ▶
    </span>
  );
}

/** 子节点计数（⑂ k）。同 SiblingIndicator，独立订阅结构版本，不牵连节点重渲染。 */
function ChildCount({ turnId }: { turnId: string }) {
  const { turnStructureVersion } = useSnapshot(agentStore);
  void turnStructureVersion;
  const childIds = getChildIds(turnId);
  if (childIds.length === 0) return null;
  return <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>⑂ {childIds.length}</span>;
}

function ConversationNodeInner({ data }: NodeProps) {
  const { turnId } = data as NodeData;
  // turn 级订阅（turns Map 不被 valtio 代理，见 store.putTurn）：
  // 流式 delta 改 blocks 只重渲染本节点，无需等 done 时的 version bump
  const turnProxy = agentStore.turns.get(turnId);
  const turnSnap = useSnapshot(turnProxy ?? MISSING_TURN) as TurnNode;
  const turn = turnProxy ? turnSnap : undefined;
  // ui 级订阅（见 store.ensureUi）：缩放/折叠只重渲染本节点，不订阅整个 store（避免 version 广播全节点重渲染）
  const uiProxy = agentStore.ui.get(turnId);
  const ui = useSnapshot(uiProxy ?? EMPTY_UI) as NodeUiState;
  const store = useStoreApi();
  const nodeElRef = useRef<HTMLDivElement>(null);
  // hovered 仅驱动 NodeResizer 手柄显隐（输入框/操作按钮已改为常驻）
  const [hovered, setHovered] = useState(false);
  // 追问模型：null = 继承本节点模型；选项按节点所在线程的源拉取（源不可换，模型可换）
  const [followupModel, setFollowupModel] = useState<string | null>(null);
  const [threadModels, setThreadModels] = useState<ModelListItem[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const { onResize, onResizeEnd } = useNodeResize(turnId);

  const width = ui?.width ?? 340;
  const height = ui?.height ?? 260;
  // 样式标志单点投影（turnState.turnStyleFlags）：仅作边框/配色/占位映射，不参与交互入口判断
  const { isStreaming, isError, isInterrupted, isUndone, isHidden } = turnStyleFlags(turn?.status);
  // 能力数据驱动：优先用 server 下发的投影（与接口守卫同源，含源能力维度）。
  // 读取顺序：turn.caps（随快照写入 turn proxy，turn 级订阅可触发重渲染）> turnCaps Map（兼容）。
  // 例外：streaming 是客户端瞬时态（未入快照），本地投影作过渡；快照未到时同理。
  // 防陈旧：终态事件与新快照之间存在时间窗，caps 可能仍为旧投影：
  //   ① canAbort:true = 陈旧 streaming 投影；② status 已 error/interrupted 但 canRetry:false = 陈旧 done 投影。
  // 命中任一则回退按当前状态本地推导（重试按钮即时出现）；对不支持 fork 的源（canRetry 合法为 false），
  // 真实 caps 随快照到达后经 turn 级订阅重渲染自动纠正（短暂误显示可接受，优于按钮迟到/缺失）。
  const serverCaps = turn?.caps ?? agentStore.turnCaps.get(turnId);
  const status = turn?.status ?? 'done';
  const capsStale =
    !serverCaps ||
    serverCaps.canAbort ||
    ((status === 'error' || status === 'interrupted') && !serverCaps.canRetry);
  const caps = isStreaming
    ? projectNodeCapabilities('streaming')
    : capsStale
      ? projectNodeCapabilities(status)
      : serverCaps;

  // 流式自动滚动
  useEffect(() => {
    if (isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [isStreaming, turn?.blocks.length, turn?.blocks[turn.blocks.length - 1]]);

  useLayoutEffect(() => {
    const el = nodeElRef.current;
    if (!el) return;
    store
      .getState()
      .updateNodeInternals(new Map([[turnId, { id: turnId, nodeElement: el, force: true }]]));
  }, [width, height, turnId, store]);

  // 按节点源拉模型列表（模块级缓存，hover 展开输入区时才需要，但提前拉取成本低）
  const sourceIdForModels = turn?.sourceId;
  useEffect(() => {
    if (!sourceIdForModels) return;
    let cancelled = false;
    fetchModelsCached(sourceIdForModels).then((ms) => {
      if (!cancelled) setThreadModels(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceIdForModels]);

  const handleFollowupSubmit = useCallback(
    (text: string, segments?: PromptSegment[]) => {
      submitFromNode(turnId, text, {
        ...(followupModel ? { model: followupModel } : {}),
        ...(segments ? { segments } : {}),
      });
    },
    [turnId, followupModel],
  );

  const handleRetry = useCallback(() => {
    if (!turn) return;
    retryTurn(turnId);
  }, [turn, turnId]);

  const toggleCollapse = useCallback(() => {
    const u = agentStore.ui.get(turnId);
    if (u) {
      u.collapsed = !u.collapsed;
      u.height = u.collapsed ? 60 : 260;
      agentStore.version++;
    }
  }, [turnId]);

  if (!turn) return null;
  // hidden 节点不渲染
  if (isHidden) return null;

  // 上下文指示（只查看）：已用 = 本轮 usage.input（≈ prompt 占用）；容量 = 本轮档位选择或模型默认
  const threadModel = threadModels.find((m) => m.id === turn.modelId);
  const ctxCapacity = turn.contextWindow || threadModel?.contextWindow || 0;
  const ctxUsed = turn.usage?.input ?? 0;
  const ctxPct =
    ctxCapacity && ctxUsed ? Math.min(100, Math.round((ctxUsed / ctxCapacity) * 100)) : null;
  const thinkingLabel =
    turn.thinkingLevel === 'none'
      ? '已关闭'
      : turn.thinkingLevel || threadModel?.tuning?.thinking?.default || '源默认';
  const contextPopover = (
    <div style={{ fontSize: 12, minWidth: 200 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
          {ctxPct !== null ? `${ctxPct}%` : '—'}
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {ctxUsed ? fmtTokens(ctxUsed) : '—'} / {ctxCapacity ? fmtTokens(ctxCapacity) : '—'}{' '}
          已用上下文
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px' }}>
        <span style={{ color: 'var(--text-secondary)' }}>源</span>
        <span>{turn.sourceId}</span>
        <span style={{ color: 'var(--text-secondary)' }}>模型</span>
        <span>{threadModel?.displayName ?? turn.modelId ?? '默认模型'}</span>
        <span style={{ color: 'var(--text-secondary)' }}>思考深度</span>
        <span>{thinkingLabel}</span>
        <span style={{ color: 'var(--text-secondary)' }}>上下文窗口</span>
        <span>{ctxCapacity ? fmtTokens(ctxCapacity) : '源默认'}</span>
      </div>
    </div>
  );

  const isCollapsed = ui?.collapsed ?? false;

  return (
    <div
      ref={nodeElRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: '100%', height: '100%' }}>
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
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />
      <div
        className='nowheel conversation-node'
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 10,
          border: isUndone
            ? '1.5px dashed #bfbfbf'
            : `1.5px solid ${isStreaming ? 'var(--brand-color)' : isError ? '#ff4d4f' : isInterrupted ? '#fa8c16' : 'var(--border)'}`,
          background: isUndone ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: isStreaming ? '0 0 12px rgba(22,119,255,0.25)' : 'var(--shadow)',
          color: isUndone ? 'var(--text-secondary)' : 'var(--text)',
          opacity: isUndone ? 0.6 : 1,
        }}>
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

        {/* ── 折叠态：只显示用户问题一行 ── */}
        {isCollapsed ? (
          <div
            style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <span style={{ fontSize: 10 }}>👤</span>
            <span
              style={{
                fontSize: 11,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
              {turn.userMessage}
            </span>
            <button
              onClick={toggleCollapse}
              style={{
                fontSize: 9,
                border: 'none',
                background: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              title='展开'>
              ▼
            </button>
          </div>
        ) : (
          <>
            {/* ── 用户问题 ── */}
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 10 }}>👤</span>
                <span style={{ fontSize: 10, color: 'var(--brand-color)', fontWeight: 600 }}>
                  User
                </span>
                {/* 兄弟分支计数（独立组件，随兄弟增删自重渲染，不牵连节点） */}
                <SiblingIndicator turnId={turnId} />
                {/* 右侧组：子计数 + 操作按钮，整体右推（主组件不再读 childIds/siblings） */}
                <span
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                  <ChildCount turnId={turnId} />
                  {/* Fork / 撤销 / 删除 按钮（常驻，可用性由能力投影决定） */}
                  {caps.canBranch && (
                    <button
                      onClick={() => submitFromNode(turn.parentTurnId, turn.userMessage)}
                      style={{
                        padding: '0 4px',
                        fontSize: 9,
                        borderRadius: 3,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                      title='分支：从同一父节点重新提问'>
                      ⑂ 分支
                    </button>
                  )}
                  {caps.canUndo && (
                    <button
                      onClick={() => undoTurn(turnId)}
                      style={{
                        padding: '0 4px',
                        fontSize: 9,
                        borderRadius: 3,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                      title='撤销：该节点及之后变为只读'>
                      ↶ 撤销
                    </button>
                  )}
                  {caps.canDelete && (
                    <button
                      onClick={() => deleteTurn(turnId)}
                      style={{
                        padding: '0 4px',
                        fontSize: 9,
                        borderRadius: 3,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: '#ff4d4f',
                        cursor: 'pointer',
                      }}
                      title='删除：撤销并隐藏该节点'>
                      ✕ 删除
                    </button>
                  )}
                  <button
                    onClick={toggleCollapse}
                    style={{
                      padding: '0 4px',
                      fontSize: 9,
                      borderRadius: 3,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                    title='折叠节点'>
                    ▲
                  </button>
                </span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.3, wordBreak: 'break-word' }}>
                {turn.userMessage}
              </div>
            </div>

            {/* ── AI 回复（块流） ── */}
            <div ref={contentRef} style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 10 }}>🤖</span>
                <span style={{ fontSize: 10, color: '#722ed1', fontWeight: 600 }}>Agent</span>
                {/* 节点源/模型标注 */}
                <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                  · {turn.sourceId} · {turn.modelId || '默认模型'}
                </span>
                {isStreaming && (
                  <span style={{ fontSize: 9, color: 'var(--brand-color)', marginLeft: 'auto' }}>
                    ● 生成中
                  </span>
                )}
                {/* 中止按钮 */}
                {caps.canAbort && (
                  <button
                    onClick={() => abortStream(turnId)}
                    style={{
                      marginLeft: 4,
                      padding: '1px 6px',
                      fontSize: 9,
                      borderRadius: 4,
                      border: '1px solid #ff4d4f',
                      background: 'transparent',
                      color: '#ff4d4f',
                      cursor: 'pointer',
                    }}
                    title='中止生成'>
                    ⏹ 停止
                  </button>
                )}
              </div>

              <ContentRenderer content={turn.blocks} streaming={isStreaming} />

              {turn.blocks.length === 0 && isStreaming && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>...</div>
              )}

              {/* 回合末改动文件汇总（非 streaming 且有改动时渲染） */}
              <FileChangeSummary blocks={turn.blocks} streaming={isStreaming} />

              <UsageFooter usage={turn.usage} model={turn.modelId || undefined} />

              {/* 错误时显示重试按钮 */}
              {isError && caps.canRetry && (
                <button
                  onClick={handleRetry}
                  style={{
                    marginTop: 6,
                    padding: '3px 10px',
                    fontSize: 10,
                    borderRadius: 4,
                    border: '1px solid var(--brand-color)',
                    background: 'transparent',
                    color: 'var(--brand-color)',
                    cursor: 'pointer',
                  }}>
                  ↻ 重试
                </button>
              )}

              {/* 中断时显示继续按钮 */}
              {caps.canContinue && (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    onClick={() => continueTurn(turnId)}
                    style={{
                      padding: '3px 12px',
                      fontSize: 10,
                      borderRadius: 4,
                      border: '1px solid #fa8c16',
                      background: '#fa8c16',
                      color: '#fff',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}>
                    ▶ 继续
                  </button>
                  <button
                    onClick={handleRetry}
                    style={{
                      padding: '3px 10px',
                      fontSize: 10,
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}>
                    ↻ 重新生成
                  </button>
                  <span style={{ fontSize: 9, color: '#fa8c16' }}>↑ 上次中断</span>
                </div>
              )}
            </div>

            {/* ── 排队面板（streaming 期间提交的消息，数据驱动镜像 server 队列） ── */}
            <QueuedMessagesPanel anchorTurnId={turnId} />

            {/* ── 底部输入区（常驻，能力投影控制）：与虚拟初始节点同布局，仅无源选择 ── */}
            {caps.canFollowup && (
              <div
                style={{
                  flexShrink: 0,
                  borderTop: '1px solid var(--border)',
                  padding: '6px 8px',
                }}>
                <ChatInputBox
                  placeholder={isStreaming ? '输入消息排队发送...' : '继续追问...'}
                  canSubmit
                  onSubmit={handleFollowupSubmit}
                  allowImages={
                    threadModels.find((m) => m.id === (followupModel ?? turn.modelId))?.capabilities
                      ?.vision === true
                  }
                  controls={
                    <ModelMenuChip
                      models={threadModels}
                      value={followupModel ?? turn.modelId}
                      onChange={setFollowupModel}
                      onEdit={(id) => {
                        // 与虚拟根同款：编辑即选中该模型，参数作用于本节点（节点作用域）
                        if ((followupModel ?? turn.modelId) !== id) setFollowupModel(id);
                        agentStore.tuningModelId = id;
                        agentStore.tuningTargetTurnId = turnId;
                      }}
                    />
                  }
                  trailing={
                    /* 上下文查看（仅展示：用量/容量 + 本线程配置） */
                    <Popover content={contextPopover} trigger='click' placement='topRight'>
                      <button
                        type='button'
                        title='上下文与配置'
                        style={{
                          height: 26,
                          padding: '0 6px',
                          borderRadius: 4,
                          border: '1px solid var(--border)',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: 9,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          flexShrink: 0,
                        }}>
                        <DatabaseOutlined style={{ fontSize: 10 }} />
                        {ctxPct !== null ? `${ctxPct}%` : ''}
                      </button>
                    </Popover>
                  }
                />
              </div>
            )}
            {/* 展开态内容结束后关闭 fragment */}
          </>
        )}
      </div>
    </div>
  );
}

export const ConversationNodeComponent = memo(ConversationNodeInner);
