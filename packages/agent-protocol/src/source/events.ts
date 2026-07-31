/**
 * 标准化事件（源 → 上层的唯一输出格式）
 * 全 Agent 体系统一使用此类型，不再有其他事件定义
 */

import type { SourceToolSemantic } from './tools.js';

export type SourceErrorCode =
  // 认证
  | 'auth_missing'
  | 'auth_invalid'
  | 'auth_insufficient'
  // 模型
  | 'model_not_found'
  | 'model_unavailable'
  | 'context_overflow'
  // 网络/运行时
  | 'network'
  | 'rate_limited'
  | 'timeout'
  | 'aborted'
  // 源
  | 'source_not_initialized'
  | 'session_not_found'
  | 'session_expired'
  // 能力契约（三层机制的错误兜底层，见 capabilities.ts）
  | 'unsupported_operation' // 能力缺口（该源版本永久性），suggestion 指向对应 capability 字段
  | 'unsupported_option' // 操作支持但选项不支持（如 fork 无 atMessage）
  | 'invalid_state' // 时序前置条件不满足（如 fork 需首 turn 落盘）——状态非能力，声明层表达不了
  // 源不可用（按调用边界分类：probe/loadSdk/connect 等源设施路径失败，不感知 SDK/实现细节）
  | 'source_unavailable'
  // 其他
  | 'unknown';

/** 错误大类（消费层按类别决定重试/降级/引导） */
export type SourceErrorCategory = 'auth' | 'capability' | 'state' | 'transient' | 'input';

const ERROR_CATEGORY: Record<SourceErrorCode, SourceErrorCategory> = {
  auth_missing: 'auth',
  auth_invalid: 'auth',
  auth_insufficient: 'auth',
  model_not_found: 'input',
  model_unavailable: 'transient',
  context_overflow: 'input',
  network: 'transient',
  rate_limited: 'transient',
  timeout: 'transient',
  aborted: 'transient',
  source_not_initialized: 'state',
  session_not_found: 'state',
  session_expired: 'state',
  unsupported_operation: 'capability',
  unsupported_option: 'capability',
  invalid_state: 'state',
  source_unavailable: 'state',
  unknown: 'transient',
};

/** code → 大类（Record 穷尽：新增 code 编译期强制归类） */
export function errorCategory(code: SourceErrorCode): SourceErrorCategory {
  return ERROR_CATEGORY[code];
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  total?: number;
  costUsd?: number;
}

export type SourceEventVariant =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: Record<string, unknown>;
      /** 工具语义（源层声明，编排层填充；壳层按此渲染，不认识工具名） */
      semantic?: SourceToolSemantic;
    }
  | { type: 'tool_result'; id: string; name: string; result: unknown; isError?: boolean }
  | {
      type: 'file_edit';
      path: string;
      /** diff 正文（源不一定返回，缺失时仅凭 path 汇总改动） */
      diff?: string;
      /** 操作类型（源层从写入类工具调用映射） */
      kind?: 'create' | 'edit' | 'delete';
    }
  | { type: 'terminal'; command: string; output?: string }
  | {
      /** 源内部上下文压缩（Qoder compact_boundary / Pi compaction_end）：透传观察，不改变 fork/resume 语义 */
      type: 'compaction';
      /** manual=用户显式触发；auto=源内部阈值/溢出触发 */
      trigger: 'auto' | 'manual';
      /** 压缩前上下文 tokens（源提供时透传） */
      preTokens?: number;
      /** 压缩后估算 tokens */
      postTokens?: number;
      /** 源生成的摘要（Pi 提供；Qoder 不返回正文） */
      summary?: string;
    }
  | {
      /** 非致命提示（如 resume 失败降级新建）：不改变节点状态，仅呈现 */
      type: 'notice';
      level: 'info' | 'warning';
      message: string;
    }
  | {
      type: 'done';
      sessionId?: string;
      summary?: string;
      usage?: TokenUsage;
      sourceMessageId?: string;
    }
  | {
      type: 'error';
      message: string;
      code: SourceErrorCode;
      retryable: boolean;
      source: { id: string; name: string };
      suggestion?: string;
    };

/**
 * 标准化事件（源 → 上层的唯一输出格式）
 * ts 由编排层（ConversationController.streamSource）统一注入——源层不打点，
 * 保证 live/reload/多端看到同一套时间（内容块的时间字段由此吸收）
 */
export type SourceEvent = SourceEventVariant & { ts?: number };

/** 错误上下文（附在 SourceError 类上，源实现层使用） */
export interface SourceErrorContext {
  sourceId: string;
  sourceName: string;
  operation:
    | 'init'
    | 'handshake'
    | 'prompt'
    | 'destroySession'
    | 'forkSession'
    | 'renameSession'
    | 'listModels'
    | 'checkAuth'
    | 'listResources';
  config?: {
    model?: string;
    cwd?: string;
    thinkingLevel?: string;
  };
  cause?: Error;
  suggestion?: string;
}
