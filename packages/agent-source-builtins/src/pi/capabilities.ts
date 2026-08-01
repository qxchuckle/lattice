/**
 * Pi 能力声明与身份（声明即数据：与实现严格对齐，由契约套件验证）
 *
 * 两处诚实化（相对旧 PiSource）：
 * - systemPrompt.append: true —— 实现走 ResourceLoader appendSystemPrompt（修正旧 canAppend:false 漂移）
 * - session.rename: false —— pi 无持久化标题，旧实现是静默 no-op（违反「永不静默降级」），
 *   现声明 false，工厂守卫抛 unsupported_operation
 */
import type { SourceCapabilities, SourceInfo, AuthRequirement } from '@qcqx/lattice-agent-protocol';

export const PI_INFO: SourceInfo = { id: 'pi', displayName: 'Pi Agent', version: '0.2.0' };

export const PI_CAPABILITIES: SourceCapabilities = {
  execution: { mode: 'local', contextOwnership: 'source' },
  session: {
    resume: true,
    fork: { atMessage: true }, // createBranchedSession 支持任意 entry 锚点
    rename: false, // 无持久化标题（旧 no-op 诚实化）
    maxConcurrentSessions: 'unlimited',
  },
  prompt: {
    images: true,
    systemPrompt: { builtin: 'none', override: true, append: true },
    slashCommands: { interpret: true }, // session.prompt 原生解释 /命令 与 /skill:name
    permissionModes: false,
  },
  tools: {
    builtin: [
      { name: 'read', semantic: 'file-read' },
      { name: 'write', semantic: 'file-write' },
      { name: 'edit', semantic: 'file-write' },
      { name: 'bash', semantic: 'terminal' },
      { name: 'glob', semantic: 'search' },
      { name: 'grep', semantic: 'search' },
    ],
    injection: 'in-process', // customTools 进程内注入
  },
  context: {
    // pi settings 默认 enabled；/compact 手动、threshold/overflow 自动，事件带摘要与 token 数
    compaction: { trigger: 'both', reportsSummary: true, reportsTokens: true },
  },
  models: { policy: 'open', tuning: true },
  resources: { kinds: ['command', 'skill', 'rule'] },
  skills: { nativeInjection: true }, // buildSystemPrompt 已注入 <available_skills>
};

export const PI_AUTH_REQUIREMENTS: AuthRequirement[] = [
  { type: 'api_key', envVar: 'ANTHROPIC_API_KEY', description: 'Anthropic API Key' },
  { type: 'api_key', envVar: 'OPENAI_API_KEY', description: 'OpenAI API Key' },
  { type: 'api_key', envVar: 'DEEPSEEK_API_KEY', description: 'DeepSeek API Key' },
  { type: 'api_key', envVar: 'GEMINI_API_KEY', description: 'Google Gemini API Key' },
  {
    type: 'cli_login',
    command: 'pi /login',
    description: 'Pi OAuth 登录（ChatGPT/Claude/Copilot）',
  },
];
