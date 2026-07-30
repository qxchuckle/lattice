/**
 * 运行时边界：type guards + EventStream 语义
 *
 * guards 是「绕过 UI 直请接口」的第一道门（WS 入站先过 isClientMessage）；
 * EventStream 是全流式系统的基石，其边界语义（push-after-done / fail / 竞态）
 * 必须在**源码**层被测到——经 dist 间接测到不算，改 src 时才有红灯。
 */
import { describe, it, expect } from 'vitest';
import type { SourceEvent, GetTreeResponse, GetTreeNotFoundResponse } from '../src/index.js';
import {
  isClientMessage,
  isServerMessage,
  isSourceEvent,
  EventStream,
  SourceEventStream,
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
} from '../src/index.js';

describe('type guards（入站边界）', () => {
  it('非对象 / null / 缺 type / 未知 type 一律拒绝', () => {
    for (const bad of [null, undefined, 42, 'send', [], {}, { type: 42 }, { type: 'nope' }]) {
      expect(isClientMessage(bad)).toBe(false);
      expect(isServerMessage(bad)).toBe(false);
      expect(isSourceEvent(bad)).toBe(false);
    }
  });

  it('清单内 type 通过（逐条覆盖，防清单与常量漂移）', () => {
    for (const type of CLIENT_MESSAGE_TYPES) expect(isClientMessage({ type })).toBe(true);
    for (const type of SERVER_MESSAGE_TYPES) expect(isServerMessage({ type })).toBe(true);
  });

  it('SourceEvent 全变体通过；服务端消息类型不会被误判为源事件', () => {
    const types: SourceEvent['type'][] = [
      'text',
      'thinking',
      'tool_call',
      'tool_result',
      'file_edit',
      'terminal',
      'compaction',
      'notice',
      'done',
      'error',
    ];
    for (const type of types) expect(isSourceEvent({ type })).toBe(true);
    expect(isSourceEvent({ type: 'session.created' })).toBe(false);
  });
});

describe('EventStream 边界语义', () => {
  const streamOf = () =>
    new EventStream<number, number>(
      (e) => e === 0,
      (e) => e,
    );

  it('for-await 顺序产出，遇终止事件结束迭代', async () => {
    const s = streamOf();
    s.push(1);
    s.push(2);
    s.push(0);
    const seen: number[] = [];
    for await (const e of s) seen.push(e);
    expect(seen).toEqual([1, 2, 0]);
  });

  it('result() 由终止事件敲定，可多次取同一结果', async () => {
    const s = streamOf();
    s.push(7);
    s.push(0);
    await expect(s.result()).resolves.toBe(0);
    await expect(s.result()).resolves.toBe(0);
  });

  it('push-after-done 被忽略（终止后不再产出）', async () => {
    const s = streamOf();
    s.push(1);
    s.push(0);
    s.push(99);
    const seen: number[] = [];
    for await (const e of s) seen.push(e);
    expect(seen).toEqual([1, 0]);
  });

  it('fail() → result() reject 且迭代结束；后续 fail/push 无效', async () => {
    const s = streamOf();
    const err = new Error('boom');
    s.push(1);
    s.fail(err);
    s.fail(new Error('second'));
    s.push(2);
    const seen: number[] = [];
    for await (const e of s) seen.push(e);
    expect(seen).toEqual([1]); // fail 前已入队的事件仍可被消费
    await expect(s.result()).rejects.toBe(err);
  });

  it('等待-推入竞态：消费者先 await，生产者后 push', async () => {
    const s = streamOf();
    const collected: number[] = [];
    const consuming = (async () => {
      for await (const e of s) collected.push(e);
    })();
    await Promise.resolve();
    s.push(5);
    s.push(0);
    await consuming;
    expect(collected).toEqual([5, 0]);
  });

  it('result() 未被消费时 fail 不产生 unhandled rejection', async () => {
    const s = streamOf();
    s.fail(new Error('nobody awaits me'));
    await new Promise((r) => setTimeout(r, 1)); // 若无内部 catch，此处会炸测试进程
    expect(true).toBe(true);
  });

  it('SourceEventStream：done 敲定 PromptResult（sessionId/usage/锚点透出）', async () => {
    const s = new SourceEventStream();
    s.push({ type: 'text', content: 'a' });
    s.push({
      type: 'done',
      sessionId: 'sess-1',
      usage: { input: 1, output: 2 },
      sourceMessageId: 'msg-9',
      summary: '摘要',
    });
    await expect(s.result()).resolves.toEqual({
      sessionId: 'sess-1',
      usage: { input: 1, output: 2 },
      sourceMessageId: 'msg-9',
      summary: '摘要',
    });
  });

  it('SourceEventStream：error 事件是普通事件，不终止流（终止裁决在生产方）', async () => {
    const s = new SourceEventStream();
    s.push({
      type: 'error',
      message: 'x',
      code: 'unknown',
      retryable: false,
      source: { id: 'fake', name: 'Fake' },
    });
    s.push({ type: 'text', content: 'after-error' });
    s.push({ type: 'done', sessionId: 'sess-1' });
    const seen: SourceEvent['type'][] = [];
    for await (const e of s) seen.push(e.type);
    expect(seen).toEqual(['error', 'text', 'done']);
  });
});

describe('REST 契约形状（server 与 client 共用的单一真相）', () => {
  it('GetTreeResponse 必含 interruptedStreams 与 turnCapabilities：少给字段在编译期即失败', () => {
    // 类型层断言：本对象若缺任一必填字段则本文件编译不过
    const ok: GetTreeResponse = {
      tree: {
        id: 't1',
        headNodeId: null,
        defaultBranchId: 'main',
        branches: [],
        createdAt: 0,
        updatedAt: 0,
      },
      nodes: [],
      interruptedStreams: [
        { requestId: 'r1', parentId: 'u1', role: 'assistant', startedAt: 0, content: [] },
      ],
      // 能力投影与 WS 快照同形：reload 路径也必须带（否则 client 只能本地重算）
      turnCapabilities: {
        u1: {
          canBranch: true,
          canUndo: true,
          canDelete: true,
          canRetry: false,
          canContinue: false,
          canFollowup: true,
          canAbort: false,
        },
      },
    };
    expect(ok.interruptedStreams).toHaveLength(1);
    expect(ok.turnCapabilities.u1.canBranch).toBe(true);
    expect(ok.error).toBeUndefined();
  });

  it('not_found 分支与成功分支可判别（error 字段收窄）', () => {
    const notFound: GetTreeNotFoundResponse = { error: 'not_found' };
    const responses: Array<GetTreeResponse | GetTreeNotFoundResponse> = [notFound];
    for (const r of responses) {
      if (r.error) expect(r.error).toBe('not_found');
      else expect(Array.isArray(r.nodes)).toBe(true);
    }
  });
});
