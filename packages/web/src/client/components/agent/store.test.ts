/**
 * store 响应式颗粒度测试
 *
 * 关键不变量：turn / ui 均以独立 proxy 入 Map，使节点组件可做 turn 级 / ui 级
 * useSnapshot（流式 delta、缩放折叠只重渲染对应节点，不广播全节点）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agentStore, putTurn, ensureUi, getChildIds, getSiblings } from './store';
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
