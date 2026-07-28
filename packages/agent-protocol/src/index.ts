/**
 * @qcqx/lattice-agent-protocol — 统一导出
 *
 * 契约层：源接口、事件、传输消息格式
 * 零依赖，纯类型 + 轻量 guards
 */

// ── Source 契约 ──
export type {
  SourceEvent,
  TokenUsage,
  SourceErrorCode,
  SourceErrorContext,
} from './source/events.js';

export type { ModelInfo } from './source/models.js';

export type { AuthRequirement, AuthStatus } from './source/auth.js';

export type { ToolDefinition, ToolResult, ToolInfo, InjectToolsConfig } from './source/tools.js';

export type { ContentBlock, StandardMessage } from './source/messages.js';

export type {
  SourceCapabilities,
  SystemPromptPolicy,
  SystemPromptConfig,
  PromptOpts,
  ISource,
  SourceInfo,
} from './source/interface.js';

export type {
  SourceToolsMap,
  AuthStatusMap,
  ISourceRegistry,
  AgentSourceConfig,
} from './source/registry.js';

export type {
  NodeRole,
  NodeContent,
  NodeStatus,
  ToolCallRecord,
  FileChange,
  ConversationNode,
  ConversationBranch,
  ConversationTree,
  MergeMode,
  PermissionLevel,
  PermissionRequest,
  AgentSessionOpts,
} from './source/conversation.js';

// ── Transport 契约 ──
export type {
  ClientMessage,
  ServerMessage,
  SessionCreateMessage,
  SessionSendMessage,
  SessionAbortMessage,
  SessionDestroyMessage,
  TreeForkMessage,
  TreeDeleteMessage,
  TreeMergeMessage,
  TreeSwitchHeadMessage,
  TreeSetDefaultMessage,
  PermissionRespondMessage,
  SessionCreatedMessage,
  AgentEventMessage,
  SessionErrorMessage,
  SessionClosedMessage,
  TreeUpdatedMessage,
  TreeErrorMessage,
  PermissionRequestMessage,
} from './transport/ws.js';

export type { SseProgress, SseDone } from './transport/sse.js';

export type {
  GetTreeResponse,
  GetTreeNotFoundResponse,
  GetLatestTurnsResponse,
  PostTurnRequest,
  PostTurnResponse,
  SourceListItem,
  GetSourcesResponse,
  ModelListItem,
  GetModelsResponse,
  AuthStatusItem,
  GetAuthStatusResponse,
} from './transport/rest.js';

// ── 常量 ──
export {
  PROTOCOL_VERSION,
  ClientMessageType,
  ServerMessageType,
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
} from './constants.js';
export type { ProtocolErrorCode } from './constants.js';

// ── Guards ──
export { isClientMessage, isServerMessage, isSourceEvent } from './guards.js';

// ── 事件→内容转换（唯一实现，server/client 共用） ──
export { StreamAccumulator, applyEventToContent } from './source/content-builder.js';

// ── 节点状态机（跨层共享单一真相，server/client 复用） ──
export {
  isReadOnly,
  canApplyOperation,
  shouldSkipDescendantMark,
  isBranchableChild,
  projectViewStatus,
} from './source/node-state.js';
export type { ViewStatus, NodeOperation } from './source/node-state.js';
