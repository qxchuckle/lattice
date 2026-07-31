/**
 * SourceManifest / ResolvedManifest — 声明与握手产物
 *
 * 信任链：declared（describe 静态自述）→ verified（handshake 实探 + quirk 降准）
 *        → resolved（消费层定策略）→ projected（UI 投影）。
 *
 * 冻结语义：manifest 冻结「能力与政策」（会话期不变，LSP initialize 模式）；
 * 模型目录与认证是动态事实——manifest 只存握手时刻快照（*Snapshot，非权威），
 * 权威通道始终是 listModels() / checkAuth()；登录态变更 → registry.rehandshake(id)。
 */
import type { SourceCapabilities } from './capabilities.js';
import type { AuthRequirement, AuthStatus } from './auth.js';
import type { ModelInfo } from './models.js';

/** 源身份信息 */
export interface SourceInfo {
  id: string;
  displayName: string;
  /** 源实现（driver/包装层）版本 */
  version: string;
  /** 底层 SDK/CLI 版本（握手实探；describe 阶段未知则缺省） */
  sdkVersion?: string;
}

/**
 * 静态自述（describe() 产物，无 I/O）。
 * capabilities 此时为 declared——未经验证的源自报。
 */
export interface SourceManifest {
  info: SourceInfo;
  capabilities: SourceCapabilities;
  authRequirements: AuthRequirement[];
  /** 本 manifest 遵循的契约版本（defineSource/握手时与 CONTRACT_VERSION 校验，防五包版本偏斜） */
  contractVersion: number;
}

/** JSON 值域（downgrade 留痕需落盘/传输，用 JSON 值域而非 unknown） */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** 降准记录：声明与实探不符时机器可读留痕（不静默修正） */
export interface CapabilityDowngrade {
  /** 能力路径，如 "session.fork" / "resources.kinds" */
  path: string;
  declared: JsonValue;
  actual: JsonValue;
  /** 降准依据：probe 实探结果 / quirk 已知谎言表 */
  reason: string;
}

/**
 * 握手产物（handshake() 后 Registry 缓存的权威快照）。
 * capabilities 此时为 verified——declared 合并 probe 实探与 quirk 表降准后的真值。
 */
export interface ResolvedManifest {
  info: SourceInfo;
  capabilities: SourceCapabilities;
  /** 源整体可用性：握手失败不炸 Registry，落为 false + reason */
  available: boolean;
  /** available=false 时的机器可读原因 */
  unavailableReason?: {
    code: 'auth' | 'sdk-missing' | 'handshake-failed' | 'probe-failed';
    message: string;
  };
  /** 握手时刻认证快照（展示用途；权威通道 = checkAuth()） */
  authSnapshot: AuthStatus;
  /** 握手时刻模型目录快照（展示用途；权威通道 = listModels()） */
  modelsSnapshot?: ModelInfo[];
  downgrades: CapabilityDowngrade[];
  /** 握手完成时间（Unix 毫秒） */
  resolvedAt: number;
}
