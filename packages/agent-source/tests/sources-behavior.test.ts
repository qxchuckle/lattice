/**
 * 源实现行为测试（mock SDK 模块）
 *
 * 覆盖本次 compaction 透传实现中的两个关键行为：
 *   1. PiSource 事件循环以 agent_settled 终止 —— pi 的 threshold 压缩发生在
 *      agent_end 之后、settled 之前，旧实现（agent_end 终止）会漏掉 compaction 事件
 *   2. QoderSource resume 失败（错误码 42）降级新建时先发 notice warning，
 *      不再静默丢上下文
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import type { SourceEvent } from '../src/types.js';

// ── PiSource：mock pi SDK + homedir（避免污染真实 ~/.lattice） ──

const piMocks = vi.hoisted(() => ({
  homedirOverride: '' as string,
  listeners: [] as ((e: unknown) => void)[],
  /** prompt() 被调用时向 listener 依序回放的事件脚本 */
  script: [] as unknown[],
  promptImpl: null as (() => Promise<void>) | null,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => piMocks.homedirOverride || actual.homedir(),
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  // 资源发现/ systemPrompt 定制用（本文件用例不触发构造，仅需导出存在）
  DefaultResourceLoader: class {
    async reload(): Promise<void> {}
    getPrompts() {
      return { prompts: [], diagnostics: [] };
    }
    getSkills() {
      return { skills: [], diagnostics: [] };
    }
    getAgentsFiles() {
      return { agentsFiles: [] };
    }
  },
  getAgentDir: () => '/tmp/pi-agent-dir',
  SessionManager: {
    continueRecent: () => ({
      getLeafId: () => 'leaf-after-compaction',
      createBranchedSession: () => undefined,
      getSessionFile: () => undefined,
    }),
    forkFrom: () => undefined,
  },
  createAgentSession: async () => ({
    session: {
      sessionId: 'pi-sess',
      subscribe: (l: (e: unknown) => void) => {
        piMocks.listeners.push(l);
        return () => {};
      },
      prompt: async () => {
        if (piMocks.promptImpl) return piMocks.promptImpl();
        for (const e of piMocks.script) {
          for (const l of piMocks.listeners) l(e);
        }
      },
      abort: async () => {},
      dispose: () => {},
    },
  }),
}));

// ── QoderSource：mock qoder SDK ──

const qoderMocks = vi.hoisted(() => ({
  /** query() 每次调用的行为脚本（按调用序） */
  queryCalls: [] as { resume?: string; promptType: string }[],
  failFirstResumeWith: '' as string,
}));

vi.mock('@qoder-ai/qoder-agent-sdk', () => ({
  qodercliAuth: () => ({}),
  accessTokenFromEnv: () => ({}),
  forkSession: async () => ({ sessionId: 'forked' }),
  renameSession: async () => {},
  getSessionMessages: async () => [{ type: 'assistant', uuid: 'last-asst-uuid' }],
  query: (opts: { prompt: unknown; options: Record<string, unknown> }) => {
    qoderMocks.queryCalls.push({
      resume: opts.options.resume as string | undefined,
      promptType: typeof opts.prompt,
    });
    // 模型目录预热走 streaming-input（非字符串 prompt）：直接抛错（源内部 catch 兜底）
    if (typeof opts.prompt !== 'string') throw new Error('no control channel in test');
    const isResume = !!opts.options.resume;
    const shouldFail = isResume && qoderMocks.failFirstResumeWith !== '';
    const failMsg = qoderMocks.failFirstResumeWith;
    return (async function* () {
      if (shouldFail) throw new Error(failMsg);
      yield { type: 'system', subtype: 'init', session_id: 'new-sess' };
      yield {
        type: 'stream_event',
        session_id: 'new-sess',
        event: { delta: { type: 'text_delta', text: '回复' } },
      };
      yield { type: 'result', subtype: 'success', session_id: 'new-sess' };
    })();
  },
}));

import { PiSource } from '../src/sources/pi/index.js';
import { QoderSource } from '../src/sources/qoder/index.js';

async function collect(iter: AsyncIterable<SourceEvent>): Promise<SourceEvent[]> {
  const out: SourceEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('PiSource 事件循环终止时序（agent_settled）', () => {
  beforeEach(async () => {
    piMocks.homedirOverride = await mkdtemp(join(tmpdir(), 'pi-source-home-'));
    piMocks.listeners.length = 0;
    piMocks.script.length = 0;
    piMocks.promptImpl = null;
    // homedir 已被 mock：PiSource 的 sessionsRoot 落在临时目录，不污染真实 ~/.lattice
    expect(homedir()).toBe(piMocks.homedirOverride);
  });

  it('agent_end 之后、agent_settled 之前的 compaction_end 事件不丢失', async () => {
    piMocks.script.push(
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '回答' } },
      { type: 'agent_end', messages: [] },
      // threshold 压缩在 post-run 阶段发生（旧实现到 agent_end 就退出 → 该事件被漏掉）
      {
        type: 'compaction_end',
        reason: 'threshold',
        aborted: false,
        result: { summary: '压缩摘要', tokensBefore: 180000 },
      },
      { type: 'agent_settled' },
    );
    const source = new PiSource();
    await source.init();
    const events = await collect(source.prompt(null, [{ type: 'text', text: '你好' }]));

    expect(events.map((e) => e.type)).toEqual(['text', 'compaction', 'done']);
    const compaction = events.find((e) => e.type === 'compaction')!;
    expect(compaction).toMatchObject({ trigger: 'auto', preTokens: 180000, summary: '压缩摘要' });
    const done = events.find((e) => e.type === 'done')!;
    expect((done as { sourceMessageId?: string }).sourceMessageId).toBe('leaf-after-compaction');
  });

  it('prompt 抛出（agent 未运行、无终止事件）→ error 事件兜底退出，不挂死', async () => {
    piMocks.promptImpl = async () => {
      throw new Error('no model selected');
    };
    const source = new PiSource();
    await source.init();
    const events = await collect(source.prompt(null, [{ type: 'text', text: '你好' }]));
    expect(events.some((e) => e.type === 'error' && e.message.includes('no model selected'))).toBe(
      true,
    );
  });
});

describe('QoderSource resume 42 降级', () => {
  beforeEach(() => {
    qoderMocks.queryCalls.length = 0;
    qoderMocks.failFirstResumeWith = '';
  });

  it('resume 失败（错误码 42）→ 先发 notice warning，再降级新建完成对话', async () => {
    qoderMocks.failFirstResumeWith = 'CLI exited with code 42';
    const source = new QoderSource();
    await source.init();
    const events = await collect(source.prompt('stale-sess', [{ type: 'text', text: '继续' }]));

    const noticeIdx = events.findIndex((e) => e.type === 'notice');
    expect(noticeIdx, '发出 notice').toBeGreaterThanOrEqual(0);
    expect(events[noticeIdx]).toMatchObject({ level: 'warning' });
    expect(
      events.findIndex((e) => e.type === 'text'),
      'warning 先于降级新建的回复内容',
    ).toBeGreaterThan(noticeIdx);
    const done = events.find((e) => e.type === 'done')!;
    expect((done as { sessionId?: string }).sessionId, '降级后捕获新 session').toBe('new-sess');
    // 第一次带 resume，重试不带
    const stringCalls = qoderMocks.queryCalls.filter((c) => c.promptType === 'string');
    expect(stringCalls[0].resume).toBe('stale-sess');
    expect(stringCalls[1].resume).toBeUndefined();
  });

  it('resume 正常 → 无 notice', async () => {
    const source = new QoderSource();
    await source.init();
    const events = await collect(source.prompt('live-sess', [{ type: 'text', text: '继续' }]));
    expect(events.some((e) => e.type === 'notice')).toBe(false);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});
