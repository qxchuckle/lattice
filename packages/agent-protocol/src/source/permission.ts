/**
 * 反向交互通道 — 权限问答（源问 → 宿主答 → 源继续）
 *
 * 事件流是单向纯输出，问答语义走 PromptOpts.onPermissionRequest 回调
 * （与 ToolDefinition.execute 同构的进程内问答形态）。
 * 缺省未提供回调 → driver 按 capabilities.prompt.permissionModes.default 策略执行，行为确定。
 *
 * 命名带 Source 前缀，区别于 WS 传输层的 PermissionRequest（conversation.ts）。
 */

/** 权限请求（源 → 宿主） */
export interface SourcePermissionRequest {
  /** 源会话 ID */
  sessionId: string;
  /** 请求种类：工具执行 / 文件写入 / 命令执行 / 源自定义模式升级 */
  kind: 'tool' | 'file-write' | 'terminal' | 'mode-escalation' | 'other';
  /** 涉及的工具名（kind=tool 时） */
  toolName?: string;
  /** 机器可读参数（路径/命令等，源尽力提供） */
  detail?: Record<string, unknown>;
  /** 人类可读描述（UI 直接呈现） */
  description: string;
}

/** 权限裁决（宿主 → 源） */
export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  /** 裁决作用域：once=仅本次；session=本源会话内同类请求免问 */
  scope?: 'once' | 'session';
  /** deny 时给源的原因（源可转述给模型） */
  message?: string;
}

export type PermissionRequestHandler = (
  req: SourcePermissionRequest,
) => Promise<PermissionDecision>;
