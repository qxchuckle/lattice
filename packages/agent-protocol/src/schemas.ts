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
