/**
 * 源能力声明（结构化八组，声明即数据）
 *
 * 三层能力机制的「声明层」：capabilities 是能力的唯一真相，
 * 上层据声明规划行为（策略表/投影/守卫），永不 try/catch 试探。
 *
 * 形态约定（对齐 ACP v2「布尔改对象」方向）：
 * - 有参数粒度的能力用对象/判别联合（`{ ... } | false`），false = 完全不支持
 * - 禁止哨兵值（如 0 = 无限），语义必须显式（`number | 'unlimited'`）
 * - 每个分组对应消费层一张策略表，`Record<形态, Strategy>` 穷尽检查
 */
import type { SourceToolSemantic } from './tools.js';
import type { SourceResourceKind } from './resources.js';

// ── execution：执行模式与上下文所有权 ──

export interface ExecutionCapability {
  /** local: 源只跑 loop，宿主提供工具/上下文/权限（Pi）
   *  delegated: 源自己跑完整 loop（Qoder/CC/ACP） */
  mode: 'local' | 'delegated';
  /** 上下文真相归属：source=SDK 自持历史（现状全部源）；
   *  host=宿主树为唯一真相，源 session 退化为缓存（R5 引入实现，本轮仅声明轴） */
  contextOwnership: 'host' | 'source';
}

// ── session：会话生命周期能力 ──

/** fork 形态：atMessage=支持任意消息锚点截断分叉；false=不支持 fork */
export type ForkCapability = { atMessage: boolean } | false;

export interface SessionCapability {
  /** 是否支持跨进程恢复会话（持久化 + resume） */
  resume: boolean;
  fork: ForkCapability;
  /** 是否支持标题同步到源内部存储（false 时 renameSession 抛 unsupported_operation） */
  rename: boolean;
  /** 并发会话上限；'unlimited' = 无限制（禁 0 哨兵） */
  maxConcurrentSessions: number | 'unlimited';
}

// ── prompt：提示词面能力 ──

export interface SystemPromptCapability {
  /** 源内置 system prompt：none=无内置 / readable=有且可读 / opaque=有但不可读。
   *  注：readable 的读取通道尚未进入 ISource 表面（当前无源声明 readable），
   *  消费层按 opaque 同等对待——声明轴先立，通道待需求出现时再补。 */
  builtin: 'none' | 'readable' | 'opaque';
  override: boolean;
  append: boolean;
}

/** slash 命令解释能力：interpret=源原生解释 '/cmd args'；false=宿主必须自行展开。
 *  命令的「发现」不在此声明——归 resources.kinds 含 'command' */
export type SlashCommandsCapability = { interpret: boolean } | false;

/** 权限模式：源支持的模式清单 + 默认模式（onPermissionRequest 缺省时 driver 按 default 策略）；false=无权限模式轴 */
export type PermissionModesCapability = { available: string[]; default: string } | false;

export interface PromptCapability {
  /** 是否接受图片输入块 */
  images: boolean;
  systemPrompt: SystemPromptCapability;
  slashCommands: SlashCommandsCapability;
  permissionModes: PermissionModesCapability;
}

// ── tools：工具面能力 ──

export interface BuiltinToolDecl {
  name: string;
  /** 语义随声明携带（壳层按语义渲染，不认工具名）——取代运行时推导 */
  semantic: SourceToolSemantic;
  description?: string;
}

/** 宿主工具注入通道：in-process=进程内函数（pi customTools）/ mcp-bridge=经 MCP 桥（qoder）/ false=不可注入 */
export type ToolInjectionCapability = 'in-process' | 'mcp-bridge' | false;

export interface ToolsCapability {
  builtin: BuiltinToolDecl[];
  injection: ToolInjectionCapability;
}

// ── context：上下文管理能力 ──

/** 源内部压缩：trigger=触发方式；reportsSummary/reportsTokens=compaction 事件是否携带摘要/token 数；false=源不压缩（溢出即报错，宿主可 polyfill） */
export type CompactionCapability =
  | { trigger: 'auto' | 'manual' | 'both'; reportsSummary: boolean; reportsTokens: boolean }
  | false;

export interface ContextCapability {
  compaction: CompactionCapability;
}

// ── models：模型目录能力 ──

export interface ModelsCapability {
  /** catalog=只能从列表选 / open=任意字符串 / hybrid=推荐+自定义 */
  policy: 'catalog' | 'open' | 'hybrid';
  /** 模型目录是否可携带 tuning 规格（目录能力）；单个模型是否可调仍看 ModelInfo.tuning 存在性，两层不重叠 */
  tuning: boolean;
}

// ── resources / skills ──

/** 可发现资源种类；false=源无可发现资源（listResources 恒返 { resources: [] }） */
export type ResourcesCapability = { kinds: SourceResourceKind[] } | false;

export interface SkillsCapability {
  /** 源是否已自行将 skills 清单注入 system prompt（true 时宿主不再重复注入） */
  nativeInjection: boolean;
}

// ── 聚合 ──

/**
 * 源能力声明总纲。
 * 取代旧的三个平行声明面：扁平 capabilities + systemPromptPolicy + modelPolicy。
 */
export interface SourceCapabilities {
  execution: ExecutionCapability;
  session: SessionCapability;
  prompt: PromptCapability;
  tools: ToolsCapability;
  context: ContextCapability;
  models: ModelsCapability;
  resources: ResourcesCapability;
  skills: SkillsCapability;
}
