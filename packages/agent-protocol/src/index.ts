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
  SourceErrorCategory,
  SourceErrorContext,
} from './source/events.js';
export { errorCategory } from './source/events.js';

export type { ModelInfo, ModelParamSpec, ModelTuning, ModelCapabilities } from './source/models.js';

export type { AuthRequirement, AuthStatus } from './source/auth.js';

export type { ToolDefinition, ToolResult, SourceToolSemantic } from './source/tools.js';

export type { ContentBlock, StandardMessage } from './source/messages.js';

export type {
  SystemPromptConfig,
  SessionToolsConfig,
  PromptOpts,
  ISource,
  LatticeSourceMap,
  KnownSourceId,
} from './source/interface.js';

// 能力声明（八组结构化）
export type {
  SourceCapabilities,
  ExecutionCapability,
  SessionCapability,
  ForkCapability,
  PromptCapability,
  SystemPromptCapability,
  SlashCommandsCapability,
  PermissionModesCapability,
  ToolsCapability,
  BuiltinToolDecl,
  ToolInjectionCapability,
  ContextCapability,
  CompactionCapability,
  ModelsCapability,
  ResourcesCapability,
  SkillsCapability,
} from './source/capabilities.js';

// 声明与握手
export type {
  SourceInfo,
  SourceManifest,
  ResolvedManifest,
  CapabilityDowngrade,
  JsonValue,
} from './source/manifest.js';

// 反向权限通道
export type {
  SourcePermissionRequest,
  PermissionDecision,
  PermissionRequestHandler,
} from './source/permission.js';

// 事件流（共享纯工具）
export { EventStream, SourceEventStream } from './source/event-stream.js';
export type { PromptResult } from './source/event-stream.js';

// middleware 契约（runner 在 @qcqx/lattice-agent-pipeline）
export { MIDDLEWARE_PHASES } from './source/middleware.js';
export type {
  SourceMiddleware,
  MiddlewarePhase,
  PromptPayload,
  MiddlewareContext,
} from './source/middleware.js';

export type {
  SourceResourceKind,
  SourceResourceInfo,
  SourceResourceQuery,
  SourceResourcesMap,
} from './source/resources.js';

export type { PromptSegment } from './source/prompt-input.js';
export { segmentsToDisplayText } from './source/prompt-input.js';

export type { ISourceRegistry, AgentSourceConfig } from './source/registry.js';

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
  StreamingState,
  PermissionLevel,
  PermissionRequest,
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
  TreeSubscribeMessage,
  TreeUnsubscribeMessage,
  PresenceUpdateMessage,
  TreeSnapshotMessage,
  TreeEventMessage,
  TreeRejectMessage,
  StreamEventMessage,
  StreamAbortedMessage,
  PresenceStateMessage,
  TreeOp,
  PresenceState,
} from './transport/ws.js';

export type { SseProgress, SseDone } from './transport/sse.js';

export type {
  GetTreeResponse,
  GetTreeNotFoundResponse,
  SourceListItem,
  GetSourcesResponse,
  ModelListItem,
  GetModelsResponse,
  AuthStatusItem,
  GetAuthStatusResponse,
  ResourceListItem,
  GetResourcesResponse,
} from './transport/rest.js';

// ── 常量 ──
export {
  PROTOCOL_VERSION,
  CONTRACT_VERSION,
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
  advanceViewStatus,
  isTerminalViewStatus,
  projectNodeCapabilities,
  projectViewStatus,
  deriveTurnViewStatus,
  projectTurnCapabilities,
} from './source/node-state.js';
export type {
  ViewStatus,
  ViewSignal,
  NodeOperation,
  NodeCapabilities,
  NodeCapabilityContext,
} from './source/node-state.js';
