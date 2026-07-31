/**
 * store 响应式颗粒度测试
 *
 * 关键不变量：turn / ui 均以独立 proxy 入 Map，使节点组件可做 turn 级 / ui 级
 * useSnapshot（流式 delta、缩放折叠只重渲染对应节点，不广播全节点）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  agentStore,
  putTurn,
  ensureUi,
  getChildIds,
  getSiblings,
  sourceUnavailableHint,
  pickActiveSourceId,
} from './store';
import type { TurnNode } from './types';

function turn(
  id: string,
  parentTurnId: string | null,
  status: TurnNode['status'] = 'done',
): TurnNode {
  return {
    id,
    parentTurnId,
    userMessage: id,
    blocks: [],
    status,
    timestamp: Number(id.replace(/\D/g, '')) || 0,
    sourceId: 'qoder',
    modelId: '',
  };
}

describe('store.putTurn / ensureUi 颗粒化', () => {
  beforeEach(() => {
    agentStore.turns.clear();
    agentStore.ui.clear();
  });

  it('putTurn 存入的是 proxy（可被 useSnapshot 追踪）', () => {
    const p = putTurn(turn('u1', null));
    expect(agentStore.turns.get('u1')).toBe(p);
    // proxy 对象可原地 mutation（流式 delta 路径）
    p.blocks.push({ type: 'text', text: 'x' });
    expect(agentStore.turns.get('u1')!.blocks.length).toBe(1);
  });

  it('ensureUi 幂等且返回同一 proxy（缩放/折叠原地改可被订阅）', () => {
    const a = ensureUi('u1');
    const b = ensureUi('u1');
    expect(a).toBe(b);
    a.width = 500;
    expect(agentStore.ui.get('u1')!.width).toBe(500);
  });
});

describe('store 可见性查询（排除 hidden）', () => {
  beforeEach(() => {
    agentStore.turns.clear();
    agentStore.ui.clear();
    putTurn(turn('u1', null));
    putTurn(turn('u2', 'u1'));
    putTurn(turn('u3', 'u1', 'hidden'));
  });

  it('getChildIds 排除 hidden 子节点', () => {
    expect(getChildIds('u1')).toEqual(['u2']);
  });

  it('getSiblings 排除 hidden 兄弟', () => {
    expect(getSiblings('u2')).toEqual(['u2']);
  });
});

describe('源可用性纯函数', () => {
  it('sourceUnavailableHint：可用源返 undefined（不禁用）', () => {
    expect(sourceUnavailableHint({ available: true })).toBeUndefined();
    // available:true 时即使残留 reason 也不提示（以 available 为准）
    expect(
      sourceUnavailableHint({
        available: true,
        unavailableReason: { code: 'probe-failed', message: 'x' },
      }),
    ).toBeUndefined();
  });

  it('sourceUnavailableHint：不可用源返 unavailableReason.message', () => {
    expect(
      sourceUnavailableHint({
        available: false,
        unavailableReason: { code: 'probe-failed', message: '需要 Node ≥ 22' },
      }),
    ).toBe('需要 Node ≥ 22');
  });

  it('sourceUnavailableHint：不可用且无 reason 时有兜底文案（不返空串）', () => {
    expect(sourceUnavailableHint({ available: false })).toBeTruthy();
  });

  const sources = [
    { id: 'pi', available: false },
    { id: 'qoder', available: true },
    { id: 'acp', available: true },
  ];

  it('pickActiveSourceId：首选可用 → 用首选', () => {
    expect(pickActiveSourceId(sources, 'acp', 'qoder')).toBe('acp');
  });

  it('pickActiveSourceId：首选不可用/不存在 → 退当前选中', () => {
    expect(pickActiveSourceId(sources, 'pi', 'qoder')).toBe('qoder');
    expect(pickActiveSourceId(sources, 'ghost', 'qoder')).toBe('qoder');
    expect(pickActiveSourceId(sources, undefined, 'qoder')).toBe('qoder');
  });

  it('pickActiveSourceId：首选与当前均不可用 → 首个可用源', () => {
    expect(pickActiveSourceId(sources, 'pi', 'pi')).toBe('qoder');
  });

  it('pickActiveSourceId：全部不可用 → 保持 current（不静默换源，UI 禁用态呈现）', () => {
    const allDown = [
      { id: 'pi', available: false },
      { id: 'qoder', available: false },
    ];
    expect(pickActiveSourceId(allDown, 'pi', 'qoder')).toBe('qoder');
  });
});
