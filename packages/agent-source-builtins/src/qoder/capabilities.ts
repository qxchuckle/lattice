/**
 * Qoder 能力声明与身份（声明即数据：与实现严格对齐，由契约套件验证）
 */
import type { SourceCapabilities, SourceInfo, AuthRequirement } from '@qcqx/lattice-agent-protocol';

export const QODER_INFO: SourceInfo = { id: 'qoder', displayName: 'Qoder', version: '0.2.0' };

export const QODER_CAPABILITIES: SourceCapabilities = {
  execution: { mode: 'delegated', contextOwnership: 'source' },
  session: {
    resume: true,
    fork: { atMessage: true }, // SDK forkSession 支持 upToMessageId 锚点
    rename: true,
    maxConcurrentSessions: 'unlimited',
  },
  prompt: {
    images: true,
    // builtin:'opaque'——qodercli 预设不可读取正文（旧 getBuiltin 返回的是占位符，诚实化）
    systemPrompt: { builtin: 'opaque', override: true, append: true },
    // V1 已验证（2026-07-29）：qoder-agent-sdk 不解释 prompt 中的 slash 文本
    //（命令展开是 Qoder IDE 客户端行为，SDK dist 无 slash 处理逻辑）→ 宿主展开
    slashCommands: false,
    // 实测（ACP initialize + SDK PermissionMode 类型）：四模式，产品默认 acceptEdits
    permissionModes: {
      available: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
      default: 'acceptEdits',
    },
  },
  tools: {
    // Task/Agent→subagent 预埋：加入白名单后语义自动为 subagent，SubagentCard 自然生效
    builtin: [
      { name: 'Read', semantic: 'file-read' },
      { name: 'Write', semantic: 'file-write' },
      { name: 'Edit', semantic: 'file-write' },
      { name: 'Bash', semantic: 'terminal' },
      { name: 'Grep', semantic: 'search' },
      { name: 'Glob', semantic: 'search' },
      { name: 'SearchCodebase', semantic: 'search' },
      { name: 'LSP', semantic: 'code-intel' },
    ],
    injection: 'mcp-bridge', // 宿主工具经 SDK MCP server 桥接
  },
  context: {
    // SDK 默认 auto-compact，流内发 compact_boundary（带 pre_tokens，无摘要正文）
    compaction: { trigger: 'auto', reportsSummary: false, reportsTokens: true },
  },
  models: { policy: 'hybrid', tuning: true },
  resources: { kinds: ['command', 'agent', 'skill', 'rule'] },
  skills: { nativeInjection: false },
};

export const QODER_AUTH_REQUIREMENTS: AuthRequirement[] = [
  {
    type: 'env',
    vars: ['QODER_PERSONAL_ACCESS_TOKEN'],
    description: 'Qoder Personal Access Token',
  },
  { type: 'cli_login', command: 'qodercli login', description: 'Qoder CLI 登录态' },
];
