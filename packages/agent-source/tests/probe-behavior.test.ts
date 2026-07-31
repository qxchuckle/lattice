/**
 * probe 探测机制测试（v2 语义）
 *
 * v2 规则：
 * - probe 是 driver 可选自检；无 probe = declared 即 verified（工厂不提供默认 probe，
 *   loadSdk 不再是协议接口，SDK 加载回归 driver 私有实现细节）；
 * - probe 失败 → manifest.available:false + unavailableReason.code 'probe-failed'
 *   + console.warn（与 auth 失败区分；铁律：永不静默降级）；
 * - driver probe 内裸抛原生 Error（错误语义由工厂按边界统一赋予）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineSource } from '../src/define-source.js';
import { createScriptedDriver } from '../src/testing/index.js';
import { SourceError } from '../src/types/error.js';
import type { DriverProbeReport } from '../src/driver.js';

// ── Pi SDK mock（与 sources-behavior.test.ts 同模式） ──

vi.mock('@earendil-works/pi-coding-agent', () => {
  return {
    version: '9.9.9-mock',
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
        getLeafId: () => null,
        createBranchedSession: () => undefined,
        getSessionFile: () => undefined,
      }),
      forkFrom: () => undefined,
    },
    createAgentSession: async () => ({
      session: {
        subscribe: () => () => {},
        prompt: async () => {},
        abort: async () => {},
        dispose: () => {},
      },
    }),
  };
});

// ── 1. 无 probe = declared 即 verified（不存在工厂默认 probe） ──

describe('无 probe 时的握手行为', () => {
  it('driver 不实现 probe() → 握手成功且不探测（declared 即 verified）', async () => {
    const base = createScriptedDriver({ id: 'no-probe' });
    expect(base.probe).toBeUndefined();

    const source = defineSource(base);
    await source.init();
    const manifest = await source.handshake();

    // 无 probe：不因缺 probe 降级，也没有任何默认探测填充 sdkVersion
    expect(manifest.available).toBe(true);
    expect(manifest.info.sdkVersion).toBeUndefined();
  });
});

// ── 2. PiDriver probe（driver 私有 loadSdk + 裸抛） ──

describe('PiDriver probe', () => {
  let originalVersion: string;

  beforeEach(() => {
    originalVersion = process.version;
  });

  afterEach(() => {
    // 恢复 process.version
    Object.defineProperty(process, 'version', { value: originalVersion, configurable: true });
  });

  it('Node 版本 < 22 时裸抛原生 Error（非 SourceError，语义由工厂赋予）', async () => {
    // 模拟 Node 20
    Object.defineProperty(process, 'version', { value: 'v20.18.0', configurable: true });

    const { createPiDriver } = await import('../src/sources/pi/index.js');
    const driver = createPiDriver();
    expect(driver.probe).toBeDefined();

    await expect(driver.probe!()).rejects.toThrow(/Node >= 22/);
    await expect(driver.probe!()).rejects.not.toBeInstanceOf(SourceError);
  });

  it('Node 版本 >= 22 时加载 SDK 并返回 sdkVersion', async () => {
    // 模拟 Node 22
    Object.defineProperty(process, 'version', { value: 'v22.5.0', configurable: true });

    const { createPiDriver } = await import('../src/sources/pi/index.js');
    const driver = createPiDriver();
    expect(driver.probe).toBeDefined();

    const report = await driver.probe!();
    expect(report.sdkVersion).toBe('9.9.9-mock');
  });
});

// ── 3. probe 失败容错（工厂侧：不崩溃、可观测、与 auth 失败区分） ──

describe('probe 失败容错', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('probe 裸抛原生 Error 被工厂捕获，handshake 不崩溃且 console.warn', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('probe exploded'));
    const base = createScriptedDriver({ id: 'probe-crash' });
    const source = defineSource({ ...base, probe });

    await source.init();
    const manifest = await source.handshake();

    expect(manifest.available).toBe(false);
    expect(manifest.unavailableReason).toMatchObject({
      code: 'probe-failed',
      message: expect.stringContaining('probe exploded'),
    });
    // 铁律：永不静默降级——必须可观测
    expect(warnSpy).toHaveBeenCalled();
  });

  it('probe 失败不影响 auth 判定：authSnapshot 仍来自 checkAuth', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('SDK not found'));
    const base = createScriptedDriver({ id: 'probe-auth-split' });
    const source = defineSource({ ...base, probe });

    await source.init();
    const manifest = await source.handshake();

    // probe 失败与 auth 失败区分：available:false 由 probe-failed 标记，
    // 而 auth 快照独立保留（scripted driver 缺省 configured）
    expect(manifest.available).toBe(false);
    expect(manifest.unavailableReason?.code).toBe('probe-failed');
    expect(manifest.authSnapshot?.status).toBe('configured');
  });
});

// ── 4. probe 成败在 manifest 上的投影 ──

describe('handshake 中 probe 结果标记', () => {
  it('probe 失败 → manifest 标记 available: false + reason', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const probe = vi.fn().mockRejectedValue(new Error('SDK not found'));
    const base = createScriptedDriver({ id: 'probe-fail-manifest' });
    const source = defineSource({ ...base, probe });

    await source.init();
    const manifest = await source.handshake();

    expect(manifest.available).toBe(false);
    expect(manifest.unavailableReason).toBeDefined();
    expect(manifest.unavailableReason?.message).toContain('SDK not found');
    warnSpy.mockRestore();
  });

  it('probe 成功 → manifest 包含 sdkVersion', async () => {
    const probe = vi.fn().mockResolvedValue({ sdkVersion: '1.2.3' } satisfies DriverProbeReport);
    const base = createScriptedDriver({ id: 'probe-ok' });
    const source = defineSource({ ...base, probe });

    await source.init();
    const manifest = await source.handshake();

    expect(manifest.available).toBe(true);
    expect(manifest.info.sdkVersion).toBe('1.2.3');
  });
});
