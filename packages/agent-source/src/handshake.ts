/**
 * 握手管线：declared 声明 + probe 实探 → ResolvedManifest
 *
 * 信任链的 declared → verified 环节。dot-path 纯函数与合并逻辑独立于工厂，可单测。
 * 冻结语义：只冻能力与政策；auth/models 仅存握手时刻快照（权威通道是动态方法）。
 */
import type {
  ResolvedManifest,
  SourceManifest,
  CapabilityDowngrade,
  SourceCapabilities,
  AuthStatus,
  ModelInfo,
  JsonValue,
} from '@qcqx/lattice-agent-protocol';
import type { DriverProbeReport } from './driver.js';
import { isRecord } from './internal/shape.js';

// ── dot-path 工具（capabilities 是 JSON 形状，路径读写安全） ──

export function getPath(obj: unknown, path: string): JsonValue {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (!isRecord(cur)) return null;
    cur = cur[key];
  }
  return (cur ?? null) as JsonValue;
}

/**
 * 不可变写入：返回深拷贝后的新对象（declared 声明不被就地篡改）。
 *
 * 入口/出口各一次局部断言是必要的：interface（如 SourceCapabilities）无索引签名，
 * 无法与 `Record<string, unknown>` 互赋，而通用 dot-path 写入必须以记录视角走查。
 * 路径中间节点的安全性由 `isRecord` 守卫保证，不再靠断言。
 */
export function setPath<T extends object>(obj: T, path: string, value: JsonValue): T {
  const keys = path.split('.');
  const root = structuredClone(obj) as Record<string, unknown>;
  let cur: Record<string, unknown> = root;
  for (const key of keys.slice(0, -1)) {
    const next = cur[key];
    if (!isRecord(next)) {
      const created: Record<string, unknown> = {};
      cur[key] = created;
      cur = created;
    } else {
      cur = next;
    }
  }
  cur[keys[keys.length - 1]] = value;
  return root as T;
}

/**
 * probe overrides → verified capabilities + downgrades 留痕。
 * declared 与 actual 不符时机器可读记录（不静默修正）。
 *
 * 留痕的 `declared` 一律取自**原始声明**：若读累积更新后的值，
 * 同一路径被多次 override 时会把上一次的结果误记为“源声明值”，审计链失真。
 */
export function applyProbeOverrides(
  declared: SourceCapabilities,
  overrides: DriverProbeReport['overrides'],
): { capabilities: SourceCapabilities; downgrades: CapabilityDowngrade[] } {
  let capabilities = declared;
  const downgrades: CapabilityDowngrade[] = [];
  for (const o of overrides ?? []) {
    downgrades.push({
      path: o.path,
      declared: getPath(declared, o.path),
      actual: o.actual,
      reason: o.reason,
    });
    capabilities = setPath(capabilities, o.path, o.actual);
  }
  return { capabilities, downgrades };
}

/** 握手成功路径的 manifest 组装（纯函数：便于单测各分支） */
export function buildResolvedManifest(args: {
  declared: SourceManifest;
  auth: AuthStatus;
  probe?: DriverProbeReport;
  modelsSnapshot?: ModelInfo[];
  resolvedAt: number;
}): ResolvedManifest {
  const { declared, auth, probe, modelsSnapshot, resolvedAt } = args;
  const { capabilities, downgrades } = applyProbeOverrides(declared.capabilities, probe?.overrides);
  const sdkVersion = probe?.sdkVersion;
  return {
    info: sdkVersion ? { ...declared.info, sdkVersion } : declared.info,
    capabilities,
    available: auth.status === 'configured',
    unavailableReason:
      auth.status === 'configured' ? undefined : { code: 'auth', message: auth.message },
    authSnapshot: auth,
    modelsSnapshot,
    downgrades,
    resolvedAt,
  };
}

/** 握手失败路径的 manifest 骨架（declared 兜底 + 失败原因） */
export function buildFailedManifest(
  declared: SourceManifest,
  message: string,
  resolvedAt: number,
): ResolvedManifest {
  return {
    info: declared.info,
    capabilities: declared.capabilities,
    available: false,
    unavailableReason: { code: 'handshake-failed', message },
    authSnapshot: { status: 'error', message },
    downgrades: [],
    resolvedAt,
  };
}
