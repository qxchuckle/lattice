/**
 * 画布重渲染隔离契约测试（探针法）
 *
 * 契约：agent 流完成（handleSourceEvent done → agentStore.version++）不得触发
 * 订阅 canvasStore 的画布组件（CytoscapeGraph）重渲染。
 *
 * 探针组件与 CytoscapeGraph 完全相同的订阅形状（解构 useSnapshot(canvasStore) 的 13 个字段），
 * 用渲染计数钉住隔离性；正反 sanity 验证探针本身灵敏（订阅字段变化→重渲染，
 * 未订阅字段变化→不重渲染，valtio 按属性访问追踪）。
 *
 * 根因结论：agentStore 与 canvasStore 是两个独立 valtio proxy，version++ 天然不
 * 触发 canvasStore 订阅者；本测试作为契约防回归（如未来有人把 version 挪进共享 store）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useSnapshot } from 'valtio';
import { canvasStore } from '../../store';
import { agentStore, putTurn, type TurnNode } from './agentStore';
import { setStreamingTarget, handleSourceEvent } from './connection';

let probeRenders = 0;

/** 与 CytoscapeGraph 相同订阅形状的探针（见 CytoscapeGraph.tsx L32-46 的解构） */
function CanvasSubscriptionProbe() {
  probeRenders++;
  const {
    anchorId,
    locateNodeId,
    visibleTypes,
    visibleEdgeTypes,
    focusDepth,
    selectedNodeId,
    layoutMode,
    canvasReady,
    taskStatusFilter,
    specScopeFilter,
    projectFilter,
    canvasKeyword,
    userFilter,
  } = useSnapshot(canvasStore);
  return (
    <div data-testid='probe'>
      {String(anchorId)}-{String(locateNodeId)}-{Object.keys(visibleTypes).length}-
      {Object.keys(visibleEdgeTypes).length}-{focusDepth}-{String(selectedNodeId)}-{layoutMode}-
      {String(canvasReady)}-{taskStatusFilter.length}-{specScopeFilter.length}-
      {projectFilter.length}-{canvasKeyword}-{userFilter.length}
    </div>
  );
}

/** 冲刷 valtio 异步批处理通知（微任务 + timer） */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function streamingTurn(id: string): TurnNode {
  return {
    id,
    parentTurnId: null,
    userMessage: 'q',
    blocks: [],
    status: 'streaming',
    timestamp: Date.now(),
    sourceId: 'qoder',
    modelId: 'auto',
  };
}

describe('CytoscapeGraph 订阅隔离：agent 流完成不触发画布重渲染', () => {
  beforeEach(() => {
    cleanup();
    probeRenders = 0;
    agentStore.turns.clear();
    canvasStore.selectedNodeId = null;
    canvasStore.layoutRunning = false;
  });

  it('agent 流完成全链路（text delta → done → version++）→ 画布探针零重渲染', async () => {
    render(<CanvasSubscriptionProbe />);
    await flush();
    const baseline = probeRenders;
    const v0 = agentStore.version;

    // 复现 connection.ts 的真实链路：putTurn 流式 turn → 路由 → delta → done
    putTurn(streamingTurn('turn-iso-1'));
    setStreamingTarget('turn-iso-1', 'turn-iso-1');
    handleSourceEvent({ type: 'text', content: '第一段' }, 'turn-iso-1');
    handleSourceEvent({ type: 'done' }, 'turn-iso-1');
    await flush();

    // version 确实 bump（终态生效）
    expect(agentStore.version).toBe(v0 + 1);
    expect(agentStore.turns.get('turn-iso-1')!.status).toBe('done');
    // 契约：canvasStore 订阅者不因 agentStore 变更重渲染
    expect(probeRenders).toBe(baseline);
  });

  it('sanity 正例：订阅字段（selectedNodeId）变化 → 探针重渲染', async () => {
    render(<CanvasSubscriptionProbe />);
    await flush();
    const baseline = probeRenders;

    canvasStore.selectedNodeId = 'node-x';
    await flush();
    expect(probeRenders).toBeGreaterThan(baseline);
  });

  it('sanity 反例：未订阅字段（layoutRunning）变化 → 探针不重渲染（按属性访问追踪）', async () => {
    render(<CanvasSubscriptionProbe />);
    await flush();
    const baseline = probeRenders;

    canvasStore.layoutRunning = true;
    await flush();
    expect(probeRenders).toBe(baseline);
  });
});
