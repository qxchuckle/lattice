/**
 * SDK 边界受检适配：SDK 形状不符时必须**在边界处**立即报可读错误
 *
 * 为什么要有：pi driver 用「最小结构类型」描述 SDK 对象。若用 `as unknown as` 硬转，
 * SDK 改方法名只会在运行到一半时抛 `x is not a function`（栈里看不出是 SDK 不兼容）。
 * 受检适配把它变成边界期的明确失败——本测试锁定这条防线。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** 缺方法的畸形 SDK：session 少了 dispose，SessionManager 少了 createBranchedSession */
vi.mock('@earendil-works/pi-coding-agent', () => ({
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
      getLeafId: () => 'leaf',
      getSessionFile: () => undefined,
      // createBranchedSession 缺失 → 模拟 SDK 大版本改名
    }),
    forkFrom: () => undefined,
  },
  createAgentSession: async () => ({
    session: {
      sessionId: 'pi-sess',
      subscribe: () => () => {},
      prompt: async () => {},
      abort: async () => {},
      // dispose 缺失 → 模拟 SDK 移除方法
    },
  }),
}));

let createPiSource: typeof import('../src/pi/index.js').createPiSource;

// Pi SDK 硬依赖 Node >= 22（driver 内版本门禁先于 SDK import）：低版本下 connect
// 路径被门禁拦截，形状受检逻辑根本不会执行——明示 skip，不静默空跑
const PI_NODE_SUPPORTED = parseInt(process.version.slice(1).split('.')[0], 10) >= 22;

beforeEach(async () => {
  ({ createPiSource } = await import('../src/pi/index.js'));
});

describe.skipIf(!PI_NODE_SUPPORTED)('pi driver：SDK 形状受检', () => {
  it('SessionManager 缺方法 → 首次 connect 即抛「SDK 版本不兼容」而非运行时崩溃', async () => {
    const source = createPiSource({ sessionsRoot: '/tmp/pi-shape-test' });
    await source.init();
    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const error = await stream.result().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    // 错误信息须指名道姓：缺哪些方法 + SDK 版本不兼容（排障不用翻栈）
    expect((error as Error).message).toMatch(/缺少必要方法/);
    expect((error as Error).message).toMatch(/SDK 版本不兼容/);
  });

  it('错误经工厂统一收尾：流内先产出 error 事件再 reject（呈现层不吞信息）', async () => {
    const source = createPiSource({ sessionsRoot: '/tmp/pi-shape-test' });
    await source.init();
    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const events: string[] = [];
    for await (const e of stream) events.push(e.type);
    await expect(stream.result()).rejects.toBeInstanceOf(Error);
    expect(events).toContain('error');
  });
});

// 占位用例：低版本 Node 下上方套件整体 skip，此处显式证明「跳过是版本门禁所致」
describe.skipIf(PI_NODE_SUPPORTED)('pi driver：SDK 形状受检（Node < 22 占位）', () => {
  it('版本门禁生效：connect 前即被拦截，形状受检用例无法在当前 Node 运行', () => {
    expect(PI_NODE_SUPPORTED).toBe(false);
  });
});
