/**
 * 拆分后纯模块单测：qoder models 映射口径/SWR 缓存 + handshake dot-path/降准
 *
 * 这些是「实测口径」的机器化固化——tuning 判据曾误判 3 个模型（auto/efficient/lite），
 * 根因是用派生候选值个数推断可调性；本测试锁定 context_config 门。
 */
import { describe, it, expect, vi } from 'vitest';
import type { ModelInfo, SourceManifest } from '@qcqx/lattice-agent-protocol';
import { CONTRACT_VERSION } from '@qcqx/lattice-agent-protocol';
import {
  mapSdkModel,
  sortEfforts,
  factorLabel,
  ModelCatalog,
  FALLBACK_MODELS,
  MODEL_CACHE_TTL_MS,
  type SdkModelLike,
} from '../src/sources/qoder/models.js';
import {
  getPath,
  setPath,
  applyProbeOverrides,
  buildResolvedManifest,
  buildFailedManifest,
} from '../src/handshake.js';
import { QODER_CAPABILITIES, QODER_INFO } from '../src/sources/qoder/capabilities.js';

// ── qoder models：纯函数 ──

describe('qoder models 纯函数', () => {
  it('sortEfforts：按强度排序，未知等级排末尾', () => {
    expect(sortEfforts(['xhigh', 'low', 'max', 'medium', 'high'])).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(sortEfforts(['weird', 'low'])).toEqual(['low', 'weird']);
  });

  it('factorLabel：整数补 .0，小数保留两位有效', () => {
    expect(factorLabel(1)).toBe('1.0x');
    expect(factorLabel(0.49998)).toBe('0.5x');
    expect(factorLabel(2.56)).toBe('2.56x');
    expect(factorLabel(undefined)).toBeUndefined();
  });
});

describe('mapSdkModel：tuning 判据（context_config 门，勿改回候选值个数）', () => {
  const base: SdkModelLike = { value: 'm', displayName: 'M' };

  it('有 context_config + 多档 → 开放 contextWindow 调节', () => {
    const m = mapSdkModel({
      ...base,
      context_config: { '200K': { token_count: 200000, is_default: true } },
      availableContextWindows: [200000, 400000, 1000000],
      defaultContextWindow: 200000,
    });
    expect(m.tuning?.contextWindow).toEqual({
      options: [200000, 400000, 1000000],
      default: 200000,
    });
  });

  it('【回归】无 context_config 但有多个候选值 → 不开放（auto/efficient/lite 的误判场景）', () => {
    const m = mapSdkModel({ ...base, availableContextWindows: [128000, 180000] });
    expect(m.tuning?.contextWindow).toBeUndefined();
  });

  it('有 context_config 但仅单档 → 不开放（无可选项无需渲染）', () => {
    const m = mapSdkModel({
      ...base,
      context_config: { '256K': { token_count: 256000 } },
      availableContextWindows: [256000],
    });
    expect(m.tuning?.contextWindow).toBeUndefined();
  });

  it('efforts 非空 → 开放 thinking（排序 + toggleable 随 supportsDisabled）', () => {
    const m = mapSdkModel({
      ...base,
      efforts: ['high', 'low', 'max'],
      defaultEffort: 'max',
      supportsDisabled: true,
    });
    expect(m.tuning?.thinking).toEqual({
      options: ['low', 'high', 'max'],
      default: 'max',
      toggleable: true,
    });
  });

  it('两项 tuning 均无 → 整个 tuning 字段缺席（web 零判断不渲染入口）', () => {
    expect(mapSdkModel(base).tuning).toBeUndefined();
  });

  it('字段降级：isNew 标注、vision/reasoning 布尔化、contextWindow 三级兜底', () => {
    const m = mapSdkModel({ ...base, isNew: true, isVl: true, maxInputTokens: 111 });
    expect(m.displayName).toBe('M（新）');
    expect(m.capabilities).toEqual({
      streaming: true,
      toolCalling: true,
      vision: true,
      reasoning: false,
    });
    expect(m.contextWindow).toBe(111);
    expect(mapSdkModel(base).contextWindow).toBe(200000);
  });
});

describe('ModelCatalog SWR 缓存', () => {
  const models: ModelInfo[] = [
    {
      id: 'x',
      displayName: 'X',
      capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
      contextWindow: 1,
      maxOutputTokens: 1,
    },
  ];

  it('首次调用返回静态兜底，并触发后台刷新；刷新后命中缓存', async () => {
    const fetcher = vi.fn().mockResolvedValue(models);
    const catalog = new ModelCatalog('cli', fetcher);
    expect(catalog.list()).toBe(FALLBACK_MODELS);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(catalog.list()).toEqual(models));
  });

  it('单飞：缓存未就绪时多次调用只发一次请求', () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
    const catalog = new ModelCatalog('cli', fetcher);
    catalog.list();
    catalog.list();
    catalog.list();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('TTL 内命中缓存不刷新；过期后再触发刷新', async () => {
    let now = 1000;
    const fetcher = vi.fn().mockResolvedValue(models);
    const catalog = new ModelCatalog('cli', fetcher, () => now);
    catalog.list();
    await vi.waitFor(() => expect(catalog.list()).toEqual(models));
    expect(fetcher).toHaveBeenCalledTimes(1);
    catalog.list(); // TTL 内
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += MODEL_CACHE_TTL_MS + 1;
    catalog.list(); // 过期
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fetch 失败 → 保持兜底，不抛错', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('未登录'));
    const catalog = new ModelCatalog('cli', fetcher);
    expect(catalog.list()).toBe(FALLBACK_MODELS);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(catalog.list()).toBe(FALLBACK_MODELS);
  });

  it('兜底表与 mapSdkModel 口径一致：auto/efficient/lite 无 tuning', () => {
    const noTuning = FALLBACK_MODELS.filter((m) => !m.tuning).map((m) => m.id);
    expect(noTuning).toEqual(['auto', 'efficient', 'lite']);
  });
});

// ── handshake：dot-path + 降准 ──

describe('handshake dot-path', () => {
  it('getPath 读取嵌套值；缺失路径返 null', () => {
    expect(getPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
    expect(getPath({ a: {} }, 'a.b.c')).toBeNull();
    expect(getPath(null, 'a')).toBeNull();
  });

  it('setPath 不可变写入：原对象不被篡改', () => {
    const src = { session: { fork: { atMessage: true } } };
    const out = setPath(src, 'session.fork', false);
    expect(out.session.fork).toBe(false);
    expect(src.session.fork).toEqual({ atMessage: true });
  });

  it('setPath 补齐缺失中间层', () => {
    expect(setPath({} as Record<string, unknown>, 'a.b', 1)).toEqual({ a: { b: 1 } });
  });
});

describe('applyProbeOverrides：降准留痕（Qoder list{} 谎言场景）', () => {
  it('override 记录 declared/actual/reason 并写入 verified 能力', () => {
    const { capabilities, downgrades } = applyProbeOverrides(QODER_CAPABILITIES, [
      { path: 'session.fork', actual: false, reason: 'probe: session/fork 返回 unsupported' },
    ]);
    expect(capabilities.session.fork).toBe(false);
    expect(downgrades).toEqual([
      {
        path: 'session.fork',
        declared: { atMessage: true },
        actual: false,
        reason: 'probe: session/fork 返回 unsupported',
      },
    ]);
    // declared 声明不被就地篡改
    expect(QODER_CAPABILITIES.session.fork).toEqual({ atMessage: true });
  });

  it('无 override → 原样返回，零降准', () => {
    const { capabilities, downgrades } = applyProbeOverrides(QODER_CAPABILITIES, undefined);
    expect(capabilities).toBe(QODER_CAPABILITIES);
    expect(downgrades).toEqual([]);
  });
});

describe('manifest 组装', () => {
  const declared: SourceManifest = {
    info: QODER_INFO,
    capabilities: QODER_CAPABILITIES,
    authRequirements: [],
    contractVersion: CONTRACT_VERSION,
  };

  it('auth configured → available:true，probe sdkVersion 并入 info', () => {
    const m = buildResolvedManifest({
      declared,
      auth: { status: 'configured', detail: 'ok' },
      probe: { sdkVersion: '1.1.1' },
      resolvedAt: 42,
    });
    expect(m.available).toBe(true);
    expect(m.info.sdkVersion).toBe('1.1.1');
    expect(m.unavailableReason).toBeUndefined();
    expect(m.resolvedAt).toBe(42);
  });

  it('auth missing → available:false + unavailableReason.auth 带原文', () => {
    const m = buildResolvedManifest({
      declared,
      auth: { status: 'missing', message: '请登录' },
      resolvedAt: 1,
    });
    expect(m.available).toBe(false);
    expect(m.unavailableReason).toEqual({ code: 'auth', message: '请登录' });
  });

  it('失败骨架：declared 兜底 + handshake-failed', () => {
    const m = buildFailedManifest(declared, 'CLI 崩溃', 7);
    expect(m).toMatchObject({
      available: false,
      unavailableReason: { code: 'handshake-failed', message: 'CLI 崩溃' },
      authSnapshot: { status: 'error', message: 'CLI 崩溃' },
      downgrades: [],
      resolvedAt: 7,
    });
    expect(m.capabilities).toBe(declared.capabilities);
  });
});
