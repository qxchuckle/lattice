/**
 * PiDriver probe 探测测试（从 agent-source/tests/probe-behavior.test.ts 抽出）
 *
 * 测试 pi driver 的 probe 行为：Node 版本门禁 + SDK 加载 + sdkVersion 回报。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SourceError } from '@qcqx/lattice-agent-source';

// ── Pi SDK mock ──

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

// ── PiDriver probe（driver 私有 loadSdk + 裸抛） ──

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

    const { createPiDriver } = await import('../src/pi/index.js');
    const driver = createPiDriver();
    expect(driver.probe).toBeDefined();

    await expect(driver.probe!()).rejects.toThrow(/Node >= 22/);
    await expect(driver.probe!()).rejects.not.toBeInstanceOf(SourceError);
  });

  it('Node 版本 >= 22 时加载 SDK 并返回 sdkVersion', async () => {
    // 模拟 Node 22
    Object.defineProperty(process, 'version', { value: 'v22.5.0', configurable: true });

    const { createPiDriver } = await import('../src/pi/index.js');
    const driver = createPiDriver();
    expect(driver.probe).toBeDefined();

    const report = await driver.probe!();
    expect(report.sdkVersion).toBe('9.9.9-mock');
  });
});
