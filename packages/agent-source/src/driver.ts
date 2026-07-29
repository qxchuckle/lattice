/**
 * SourceDriver — 源接入的唯一扩展点（B2：Driver + defineSource 工厂）
 *
 * driver 只写 SDK 特定的原子操作（连接/发送/事件映射/认证/模型/原生 fork）；
 * 事件泵、握手管线、ts 注入、能力守卫、错误包装、句柄表全部由 defineSource 工厂统一提供。
 * 新 SDK 接入 = 实现本接口（预估 150~250 行）+ 一行注册。
 *
 * 行为铁律（契约套件验证）：
 * - 永不静默降级：要么精确执行、要么抛 SourceError；近似执行必须 emit notice 事件
 * - driver 不 emit done（工厂合成）；致命失败 throw（工厂发 error 事件并 fail，result() reject）；
 *   非致命错误（SDK 流内 error，轮次仍正常结束）可 emit error 内容事件后正常返回 outcome
 * - abort 语义：工厂在 signal 触发时调 handle.abort()；SDK 因中止产生的异常由
 *   driver 吞掉并正常返回 outcome（中断是正常结局，不是错误）
 */
import type {
  SourceCapabilities,
  SourceInfo,
  AuthRequirement,
  AuthStatus,
  ModelInfo,
  ContentBlock,
  PromptOpts,
  SourceEvent,
  TokenUsage,
  SourceResourceInfo,
  SourceResourceQuery,
  JsonValue,
} from '@qcqx/lattice-agent-protocol';

/** 会话句柄：driver 私有状态的最小暴露面（工厂只认这三个成员） */
export interface DriverSessionHandle {
  /** 源侧会话 ID（工厂用于 done 注入 / 句柄表 key / fork 锚定）。
   *  非 readonly：当 driver 经 outcome.sessionId 回填真实 ID 时，工厂会重写本字段
   *  并重锚句柄表，保证后续轮次 driver 看到的 id 与宝主使用的一致 */
  id: string;
  /** 中止在途生成（signal 触发时工厂调用；幂等） */
  abort(): void | Promise<void>;
  /** 释放句柄资源（destroySession / dispose 时工厂调用） */
  close?(): void | Promise<void>;
}

/** 一轮 prompt 的结局（工厂据此合成 done 事件） */
export interface DriverPromptOutcome {
  /** 真实源会话 ID 回填：无状态 per-prompt 源（如 Qoder）新会话 ID 在流中才产生，
   *  与句柄占位 ID 不同时工厂以此为准合成 done 并重锚句柄表 */
  sessionId?: string;
  usage?: TokenUsage;
  /** 最后一条消息在源 session 中的 ID（fork 锚点） */
  sourceMessageId?: string;
  summary?: string;
}

/** 握手实探报告（probe 产物，工厂据此合并出 ResolvedManifest） */
export interface DriverProbeReport {
  /** 底层 SDK/CLI 版本（实探所得） */
  sdkVersion?: string;
  /** 能力降准：dot-path 定位声明字段，工厂读取 declared 原值并记录 downgrade */
  overrides?: Array<{ path: string; actual: JsonValue; reason: string }>;
}

/** driver 可发射的事件子型（done 由工厂合成，类型上排除） */
export type DriverEvent = Exclude<SourceEvent, { type: 'done' }>;

/** 内容事件发射器（工厂包装：注入 ts、透传给 SourceEventStream） */
export type DriverEmit = (event: DriverEvent) => void;

export interface SourceDriver<H extends DriverSessionHandle = DriverSessionHandle> {
  /** driver 编译所依赖的契约版本（传 protocol 的 CONTRACT_VERSION 常量；
   *  defineSource 校验与宿主 protocol 一致，防五包版本偏斜） */
  readonly contractVersion: number;

  // ── 静态声明（describe 数据源） ──
  readonly info: SourceInfo;
  readonly capabilities: SourceCapabilities;
  readonly authRequirements: AuthRequirement[];

  // ── 生命周期 ──
  init?(config?: Record<string, unknown>): Promise<void>;
  dispose?(): Promise<void>;

  // ── 握手实探（可选；无 probe = declared 即 verified） ──
  probe?(): Promise<DriverProbeReport>;

  // ── 动态通道 ──
  checkAuth(): Promise<AuthStatus>;
  listModels(): Promise<ModelInfo[]>;

  /** 资源枚举（capabilities.resources=false 时工厂不调用，恒返 []）；
   *  实现失败应 throw，由工厂吞掉转 []（发现类 API 不致命） */
  scanResources?(query?: SourceResourceQuery): Promise<SourceResourceInfo[]>;

  // ── 会话原子操作 ──

  /** 建立/恢复会话：sessionId=null 新建（driver 生成 ID），非 null 恢复。
   *  opts.tools（会话工具装配）在此消费——工具属于会话，不是源级状态 */
  connect(sessionId: string | null, opts: PromptOpts): Promise<H>;

  /** 执行一轮 prompt：内容事件推 emit，正常结局返回 outcome，异常 throw SourceError。
   *  中止（signal→handle.abort()）视为正常结局：吞 SDK 中止异常并返回 outcome */
  prompt(
    session: H,
    message: ContentBlock[],
    opts: PromptOpts,
    emit: DriverEmit,
  ): Promise<DriverPromptOutcome>;

  /** 原生 fork（capabilities.session.fork ≠ false 时必须提供；
   *  atMessage 仅在 fork.atMessage=true 时会被传入——工厂已按能力守卫） */
  forkNative?(sessionId: string, atMessage?: string): Promise<string>;

  /** 原生重命名（capabilities.session.rename=true 时必须提供） */
  renameNative?(sessionId: string, title: string): Promise<void>;

  /** 会话销毁的源侧收尾（句柄 close 之外的持久化清理，可选） */
  destroyNative?(sessionId: string): Promise<void>;
}
