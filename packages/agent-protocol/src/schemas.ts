/**
 * /schemas 子出口 — protocol 形状的运行时校验（zod）
 *
 * 双出口约定（设计轴七修订 F3）：
 * - 根出口保持运行时零依赖（手写 interface 是类型真相）
 * - 本子出口承载 zod schema，`satisfies z.ZodType<T>` 同包钉住——schema 与类型漂移即编译报错
 * - 消费方：web server 入站校验 / agent 持久化加载 / agent-source driver 边界 / testing 契约套件
 * - client 禁止 import 本子出口（lint 规则，浏览器 bundle 零 zod）
 *
 * 校验语义：check-only——用 safeParse 判定形状，判定通过后**继续使用原对象**
 * （z.object 默认剥离未知键，不得用 parse 产物替换原值，保证厂商扩展字段透传）。
 */
import { z } from 'zod';
import type {
  AuthStatus,
  AuthRequirement,
  ModelParamSpec,
  ModelTuning,
  ModelCapabilities,
  ModelInfo,
  SourceCapabilities,
  ExecutionCapability,
  SessionCapability,
  PromptCapability,
  ToolsCapability,
  ContextCapability,
  ModelsCapability,
  ResourcesCapability,
  SkillsCapability,
  SourceInfo,
  SourceManifest,
  ResolvedManifest,
  CapabilityDowngrade,
  SourcePermissionRequest,
  PermissionDecision,
  PromptSegment,
  ClientMessage,
} from './index.js';
import type { JsonValue } from './source/manifest.js';

/** JSON 值域（递归 lazy，与 manifest.JsonValue 钉对） */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

// ── auth ──

export const authStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('configured'), detail: z.string().optional() }),
  z.object({ status: z.literal('missing'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]) satisfies z.ZodType<AuthStatus>;

export const authRequirementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('api_key'), envVar: z.string(), description: z.string() }),
  z.object({ type: z.literal('oauth'), description: z.string() }),
  z.object({ type: z.literal('cli_login'), command: z.string(), description: z.string() }),
  z.object({ type: z.literal('env'), vars: z.array(z.string()), description: z.string() }),
  z.object({ type: z.literal('none') }),
]) satisfies z.ZodType<AuthRequirement>;

// ── models ──

const numberParamSpecSchema = z.object({
  options: z.array(z.number()),
  default: z.number().optional(),
  freeform: z.boolean().optional(),
}) satisfies z.ZodType<ModelParamSpec<number>>;

const stringParamSpecSchema = z.object({
  options: z.array(z.string()),
  default: z.string().optional(),
  freeform: z.boolean().optional(),
}) satisfies z.ZodType<ModelParamSpec<string>>;

export const modelTuningSchema = z.object({
  contextWindow: numberParamSpecSchema.optional(),
  thinking: stringParamSpecSchema.extend({ toggleable: z.boolean().optional() }).optional(),
}) satisfies z.ZodType<ModelTuning>;

export const modelCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  toolCalling: z.boolean(),
  vision: z.boolean(),
  reasoning: z.boolean(),
}) satisfies z.ZodType<ModelCapabilities>;

export const modelInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  capabilities: modelCapabilitiesSchema,
  contextWindow: z.number(),
  maxOutputTokens: z.number(),
  costFactor: z.number().optional(),
  costLabel: z.string().optional(),
  tuning: modelTuningSchema.optional(),
}) satisfies z.ZodType<ModelInfo>;

// ── capabilities（八组） ──

export const executionCapabilitySchema = z.object({
  mode: z.enum(['local', 'delegated']),
  contextOwnership: z.enum(['host', 'source']),
}) satisfies z.ZodType<ExecutionCapability>;

export const sessionCapabilitySchema = z.object({
  resume: z.boolean(),
  fork: z.union([z.object({ atMessage: z.boolean() }), z.literal(false)]),
  rename: z.boolean(),
  maxConcurrentSessions: z.union([z.number(), z.literal('unlimited')]),
}) satisfies z.ZodType<SessionCapability>;

export const promptCapabilitySchema = z.object({
  images: z.boolean(),
  systemPrompt: z.object({
    builtin: z.enum(['none', 'readable', 'opaque']),
    override: z.boolean(),
    append: z.boolean(),
  }),
  slashCommands: z.union([z.object({ interpret: z.boolean() }), z.literal(false)]),
  permissionModes: z.union([
    z.object({ available: z.array(z.string()), default: z.string() }),
    z.literal(false),
  ]),
}) satisfies z.ZodType<PromptCapability>;

export const toolsCapabilitySchema = z.object({
  builtin: z.array(
    z.object({
      name: z.string(),
      semantic: z.enum([
        'terminal',
        'file-read',
        'file-write',
        'search',
        'code-intel',
        'subagent',
        'other',
      ]),
      description: z.string().optional(),
    }),
  ),
  injection: z.union([z.enum(['in-process', 'mcp-bridge']), z.literal(false)]),
}) satisfies z.ZodType<ToolsCapability>;

export const contextCapabilitySchema = z.object({
  compaction: z.union([
    z.object({
      trigger: z.enum(['auto', 'manual', 'both']),
      reportsSummary: z.boolean(),
      reportsTokens: z.boolean(),
    }),
    z.literal(false),
  ]),
}) satisfies z.ZodType<ContextCapability>;

export const modelsCapabilitySchema = z.object({
  policy: z.enum(['catalog', 'open', 'hybrid']),
  tuning: z.boolean(),
}) satisfies z.ZodType<ModelsCapability>;

export const resourcesCapabilitySchema = z.union([
  z.object({ kinds: z.array(z.enum(['command', 'agent', 'skill', 'rule'])) }),
  z.literal(false),
]) satisfies z.ZodType<ResourcesCapability>;

export const skillsCapabilitySchema = z.object({
  nativeInjection: z.boolean(),
}) satisfies z.ZodType<SkillsCapability>;

export const sourceCapabilitiesSchema = z.object({
  execution: executionCapabilitySchema,
  session: sessionCapabilitySchema,
  prompt: promptCapabilitySchema,
  tools: toolsCapabilitySchema,
  context: contextCapabilitySchema,
  models: modelsCapabilitySchema,
  resources: resourcesCapabilitySchema,
  skills: skillsCapabilitySchema,
}) satisfies z.ZodType<SourceCapabilities>;

// ── manifest ──

export const sourceInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  version: z.string(),
  sdkVersion: z.string().optional(),
}) satisfies z.ZodType<SourceInfo>;

export const sourceManifestSchema = z.object({
  info: sourceInfoSchema,
  capabilities: sourceCapabilitiesSchema,
  authRequirements: z.array(authRequirementSchema),
  contractVersion: z.number().int(),
}) satisfies z.ZodType<SourceManifest>;

export const capabilityDowngradeSchema = z.object({
  path: z.string(),
  declared: jsonValueSchema,
  actual: jsonValueSchema,
  reason: z.string(),
}) satisfies z.ZodType<CapabilityDowngrade>;

export const resolvedManifestSchema = z.object({
  info: sourceInfoSchema,
  capabilities: sourceCapabilitiesSchema,
  available: z.boolean(),
  unavailableReason: z
    .object({
      code: z.enum(['auth', 'sdk-missing', 'handshake-failed', 'probe-failed']),
      message: z.string(),
    })
    .optional(),
  authSnapshot: authStatusSchema,
  modelsSnapshot: z.array(modelInfoSchema).optional(),
  downgrades: z.array(capabilityDowngradeSchema),
  resolvedAt: z.number(),
}) satisfies z.ZodType<ResolvedManifest>;

// ── permission ──

export const sourcePermissionRequestSchema = z.object({
  sessionId: z.string(),
  kind: z.enum(['tool', 'file-write', 'terminal', 'mode-escalation', 'other']),
  toolName: z.string().optional(),
  detail: z.record(z.unknown()).optional(),
  description: z.string(),
}) satisfies z.ZodType<SourcePermissionRequest>;

export const permissionDecisionSchema = z.object({
  behavior: z.enum(['allow', 'deny']),
  scope: z.enum(['once', 'session']).optional(),
  message: z.string().optional(),
}) satisfies z.ZodType<PermissionDecision>;

// ── WS 入站（ClientMessage，parse don't validate） ──

/**
 * 入站资源上限（迁自 web/ws-commands 手写守卫，防超长/超大 payload 耗尽服务端资源）。
 * 单一来源：server 入口守卫与契约测试均引用本常量。
 */
export const WS_INBOUND_LIMITS = {
  /** treeId/sessionId/nodeId/branchId/branchName 等标识符 */
  ID_MAX_LEN: 256,
  /** tree.delete 批量节点数 / segments 段数 */
  ARRAY_MAX_COUNT: 1000,
  /** 自由文本（message / inline-ref content 等），~200KB */
  TEXT_MAX_CHARS: 200_000,
} as const;

/** 标识符字段：string 且 ≤256 */
const boundedId = z
  .string()
  .max(WS_INBOUND_LIMITS.ID_MAX_LEN, `exceeds maximum length (${WS_INBOUND_LIMITS.ID_MAX_LEN})`);

/** 自由文本字段：string 且 ≤200_000 */
const boundedText = z
  .string()
  .max(
    WS_INBOUND_LIMITS.TEXT_MAX_CHARS,
    `exceeds maximum length (${WS_INBOUND_LIMITS.TEXT_MAX_CHARS} chars)`,
  );

const boundedArray = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .max(
      WS_INBOUND_LIMITS.ARRAY_MAX_COUNT,
      `exceeds maximum count (${WS_INBOUND_LIMITS.ARRAY_MAX_COUNT})`,
    );

/** 结构化 prompt 输入段（嵌套递归校验：未知段 type/字段类型不符/超长均拒） */
export const promptSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: boundedText }),
  z.object({ type: z.literal('command'), name: boundedId, args: boundedText.optional() }),
  z.object({
    type: z.literal('image'),
    data: z.string(),
    mimeType: boundedId,
    name: boundedId.optional(),
  }),
  z.object({
    type: z.literal('ref'),
    refType: z.enum(['file', 'spec', 'task']),
    id: boundedText,
    display: boundedText,
  }),
  z.object({
    type: z.literal('inline-ref'),
    refType: z.enum(['selection', 'node']),
    display: boundedText,
    content: boundedText,
  }),
]) satisfies z.ZodType<PromptSegment>;

/**
 * ClientMessage 递归校验（WS 入站命令的唯一入口守卫）。
 * check-only：safeParse 判定形状，通过后继续使用原对象（未知键透传）。
 */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.create'),
    agentId: boundedId.optional(),
    cwd: boundedText.optional(),
    taskId: boundedId.optional(),
    treeId: boundedId.optional(),
  }),
  z.object({
    type: z.literal('session.send'),
    sessionId: boundedId,
    message: boundedText,
    segments: boundedArray(promptSegmentSchema).optional(),
    parentNodeId: boundedId.nullable().optional(),
    branchId: boundedId.optional(),
    requestId: boundedId.optional(),
    model: boundedId.optional(),
    thinkingLevel: boundedId.optional(),
    contextWindow: z.number().optional(),
    sourceId: boundedId.optional(),
  }),
  z.object({
    type: z.literal('session.continue'),
    sessionId: boundedId,
    nodeId: boundedId,
    requestId: boundedId.optional(),
  }),
  z.object({
    type: z.literal('session.retry'),
    sessionId: boundedId,
    nodeId: boundedId,
    requestId: boundedId.optional(),
  }),
  z.object({ type: z.literal('session.undo'), sessionId: boundedId, nodeId: boundedId }),
  z.object({ type: z.literal('session.delete'), sessionId: boundedId, nodeId: boundedId }),
  z.object({
    type: z.literal('session.abort'),
    sessionId: boundedId,
    requestId: boundedId.optional(),
  }),
  z.object({ type: z.literal('session.destroy'), sessionId: boundedId }),
  z.object({
    type: z.literal('tree.fork'),
    treeId: boundedId,
    nodeId: boundedId,
    branchName: boundedId.optional(),
  }),
  z.object({ type: z.literal('tree.delete'), treeId: boundedId, nodeIds: boundedArray(boundedId) }),
  z.object({
    type: z.literal('tree.merge'),
    treeId: boundedId,
    branchId: boundedId,
    targetNodeId: boundedId,
    mode: z.enum(['squash', 'cherry-pick', 'reference']).optional(),
  }),
  z.object({ type: z.literal('tree.switchHead'), treeId: boundedId, nodeId: boundedId }),
  z.object({ type: z.literal('tree.setDefault'), treeId: boundedId, branchId: boundedId }),
  z.object({ type: z.literal('permission.respond'), requestId: boundedId, allowed: z.boolean() }),
  z.object({
    type: z.literal('tree.subscribe'),
    treeId: boundedId,
    sinceRev: z.number().optional(),
    clientKind: boundedId.optional(),
  }),
  z.object({ type: z.literal('tree.unsubscribe'), treeId: boundedId }),
  z.object({
    type: z.literal('presence.update'),
    treeId: boundedId,
    focusNodeId: boundedId.nullable().optional(),
    typing: z.boolean().optional(),
  }),
  z.object({ type: z.literal('ping') }),
]) satisfies z.ZodType<ClientMessage>;

// 双向编译期钉死（与 guards.ts 同模式）：satisfies 只防多不防漏——
// ClientMessage 新增变体而 schema 未补 → 此处编译报错
type _MissingClientMessageTypes = Exclude<
  ClientMessage['type'],
  z.infer<typeof clientMessageSchema>['type']
>;
const _assertNoMissingClientMessageTypes: _MissingClientMessageTypes extends never ? true : never =
  true;
void _assertNoMissingClientMessageTypes;
