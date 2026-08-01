/**
 * ConversationNodeComponent 组件测试
 *
 * 覆盖各 turn 状态下的 UI 呈现与操作按钮（状态机在 UI 层的落地）：
 *   interrupted → 继续/重新生成；error → 重试；streaming → 停止；
 *   done → 无操作按钮；undone → 只读；hidden → 不渲染。
 * 并验证点击按钮调用对应 action。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';

// mock 掉 actions（避免真实 WS 发送），保留真实 agentStore（供注入 turn）
vi.mock('./agentStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agentStore')>();
  return {
    ...actual,
    submitFromNode: vi.fn(),
    retryTurn: vi.fn(),
    continueTurn: vi.fn(),
    undoTurn: vi.fn(),
    deleteTurn: vi.fn(),
    abortStream: vi.fn(),
  };
});

import { agentStore, putTurn, continueTurn, retryTurn, abortStream } from './agentStore';
import { applyStreamEvent } from './turnGraph';
import { projectNodeCapabilities } from '@qcqx/lattice-agent-protocol';
import { ConversationNodeComponent } from './ConversationNodeComponent';
import type { TurnNode } from './types';

function makeTurn(status: TurnNode['status'], blocks: TurnNode['blocks'] = []): TurnNode {
  return {
    id: 't1',
    parentTurnId: null,
    userMessage: '你好',
    blocks,
    status,
    timestamp: Date.now(),
    sourceId: 'qoder',
    modelId: 'auto',
  };
}

function renderNode(turn: TurnNode) {
  agentStore.turns.clear();
  // 与真实链路一致：turn 经 putTurn 包 proxy 入 Map（组件内 useSnapshot 要求 proxy）
  putTurn(turn);
  const props = {
    id: turn.id,
    data: { turnId: turn.id },
    type: 'conversation',
    position: { x: 0, y: 0 },
    selected: false,
    isConnectable: false,
    zIndex: 0,
  } as unknown as NodeProps;
  return render(
    <ReactFlowProvider>
      <ConversationNodeComponent {...props} />
    </ReactFlowProvider>,
  );
}

const btn = (name: RegExp) => screen.getByRole('button', { name });
const noBtn = (name: RegExp) => expect(screen.queryByRole('button', { name })).toBeNull();

describe('ConversationNodeComponent 状态呈现', () => {
  beforeEach(() => {
    cleanup();
    agentStore.turns.clear();
    vi.clearAllMocks();
  });

  it('interrupted：显示 继续 + 重新生成', () => {
    renderNode(makeTurn('interrupted', [{ type: 'text', text: '部分回复' }]));
    expect(btn(/继续/)).toBeInTheDocument();
    expect(btn(/重新生成/)).toBeInTheDocument();
    noBtn(/停止/);
  });

  it('error：显示 重试', () => {
    renderNode(makeTurn('error', [{ type: 'error', message: '出错了' }]));
    expect(btn(/重试/)).toBeInTheDocument();
    noBtn(/继续/);
  });

  it('streaming：显示 停止（生成中）', () => {
    renderNode(makeTurn('streaming', []));
    expect(btn(/停止/)).toBeInTheDocument();
    expect(screen.getByText(/生成中/)).toBeInTheDocument();
  });

  it('done：无 继续/重试/停止', () => {
    renderNode(makeTurn('done', [{ type: 'text', text: '完整回复' }]));
    noBtn(/继续/);
    noBtn(/重试/);
    noBtn(/停止/);
    expect(screen.getByText('完整回复')).toBeInTheDocument();
  });

  it('undone：只读（无操作按钮、无输入框）', () => {
    renderNode(makeTurn('undone', [{ type: 'text', text: '已撤销' }]));
    noBtn(/继续/);
    noBtn(/重试/);
    noBtn(/停止/);
    expect(screen.queryByPlaceholderText('继续追问...')).toBeNull();
  });

  it('hidden：不渲染任何内容', () => {
    renderNode(makeTurn('hidden', [{ type: 'text', text: '已删除' }]));
    expect(screen.queryByText('已删除')).toBeNull();
    expect(screen.queryByText('你好')).toBeNull();
  });

  it('compaction/notice 块：渲染压缩标记与警告，不影响 done 状态呈现', () => {
    renderNode(
      makeTurn('done', [
        { type: 'compaction', trigger: 'auto', preTokens: 37418 },
        { type: 'notice', level: 'warning', text: '会话恢复失败，已新建会话继续' },
        { type: 'text', text: '压缩后回答' },
      ]),
    );
    expect(screen.getByText(/上下文已压缩/)).toBeInTheDocument();
    expect(screen.getByText(/压缩前 37k tokens/)).toBeInTheDocument();
    expect(screen.getByText(/会话恢复失败/)).toBeInTheDocument();
    expect(screen.getByText('压缩后回答')).toBeInTheDocument();
    // 非 error 块 → 不出现重试按钮
    noBtn(/重试/);
  });
});

describe('ConversationNodeComponent 操作调用', () => {
  beforeEach(() => {
    cleanup();
    agentStore.turns.clear();
    vi.clearAllMocks();
  });

  it('点击 继续 → continueTurn(turnId)', () => {
    renderNode(makeTurn('interrupted', [{ type: 'text', text: 'x' }]));
    fireEvent.click(btn(/继续/));
    expect(vi.mocked(continueTurn)).toHaveBeenCalledWith('t1');
  });

  it('点击 重新生成 → retryTurn(turnId)', () => {
    renderNode(makeTurn('interrupted', [{ type: 'text', text: 'x' }]));
    fireEvent.click(btn(/重新生成/));
    expect(vi.mocked(retryTurn)).toHaveBeenCalledWith('t1');
  });

  it('点击 停止 → abortStream(turnId)', () => {
    renderNode(makeTurn('streaming', []));
    fireEvent.click(btn(/停止/));
    expect(vi.mocked(abortStream)).toHaveBeenCalledWith('t1');
  });

  it('点击 重试（error）→ retryTurn(turnId)', () => {
    renderNode(makeTurn('error', [{ type: 'error', message: 'e' }]));
    fireEvent.click(btn(/重试/));
    expect(vi.mocked(retryTurn)).toHaveBeenCalledWith('t1');
  });
});

describe('ConversationNodeComponent 流式渲染', () => {
  beforeEach(() => {
    cleanup();
    agentStore.turns.clear();
    vi.clearAllMocks();
  });

  it('流式 delta 无需 version bump 即逐步渲染（turn 级 proxy 响应式）', async () => {
    renderNode(makeTurn('streaming', []));
    const turnProxy = agentStore.turns.get('t1')!;

    // 模拟 handleSourceEvent 的中间 delta：只改 blocks，不碰 agentStore.version
    applyStreamEvent(turnProxy, { type: 'text', content: '第一段' });
    expect(await screen.findByText(/第一段/)).toBeInTheDocument();

    applyStreamEvent(turnProxy, { type: 'text', content: '，第二段' });
    expect(await screen.findByText(/第一段，第二段/)).toBeInTheDocument();
  });
});

describe('ConversationNodeComponent turnCaps 防陈旧（重试按钮竞态回归）', () => {
  beforeEach(() => {
    cleanup();
    agentStore.turns.clear();
    agentStore.turnCaps.clear();
    vi.clearAllMocks();
  });

  it('turnCaps 陈旧（streaming 投影 canAbort:true）时 error 事件后重试按钮立即出现', async () => {
    // 1. server 快照先下发 streaming 能力（canAbort:true, canRetry:false）
    agentStore.turnCaps.set('t1', projectNodeCapabilities('streaming'));
    renderNode(makeTurn('streaming', []));
    const turnProxy = agentStore.turns.get('t1')!;

    // 2. 源报错：error 事件改 turn 状态触发重渲染；此时 turnCaps 仍为陈旧 streaming 投影，
    //    组件应检测到 canAbort:true 与当前 error 态不一致 → 回退本地推导 → 重试按钮立即出现
    applyStreamEvent(turnProxy, {
      type: 'error',
      message: '额度不足',
      code: 'unknown',
      retryable: false,
      source: { id: 'qoder', name: 'Qoder' },
    });
    expect(await screen.findByText(/额度不足/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /重试/ })).toBeInTheDocument();
  });

  it('turnCaps 为新快照（error 投影 canAbort:false）时优先用 server caps', async () => {
    agentStore.turnCaps.set('t1', projectNodeCapabilities('error'));
    renderNode(makeTurn('error', [{ type: 'error', message: '出错了' }]));
    expect(btn(/重试/)).toBeInTheDocument();
  });
});
