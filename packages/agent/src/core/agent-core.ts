/**
 * Agent Core — 封装 pi-agent-core 的 Agent 运行时
 * 实际集成 Pi agentLoop，提供统一的 prompt/abort/事件流接口
 */
import { createModels, type Models, type Model, type Api } from '@earendil-works/pi-ai';
import {
  agentLoop,
  type AgentContext,
  type AgentLoopConfig,
  type AgentMessage,
  type AgentEvent as PiAgentEvent,
} from '@earendil-works/pi-agent-core';
import type { AgentEvent, AgentSessionOpts } from '../types.js';
import type { EventBus } from '../events/event-bus.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { PermissionGuard } from '../permission/permission-guard.js';

export interface AgentCoreConfig {
  /** 默认模型（provider/model 格式） */
  defaultModel?: string;
  /** 默认 thinking level */
  defaultThinkingLevel?: 'low' | 'medium' | 'high';
  /** 最大 tool loop 迭代次数 */
  maxIterations?: number;
  /** 自定义 API key（可选，默认从环境变量读取） */
  apiKey?: string;
}

export interface ActiveSession {
  id: string;
  opts: AgentSessionOpts;
  status: 'idle' | 'running' | 'error';
  abortController: AbortController;
  /** Pi 对话历史 */
  messages: AgentMessage[];
  systemPrompt: string;
}

export class AgentCore {
  private sessions = new Map<string, ActiveSession>();
  private events: EventBus;
  private tools: ToolRegistry;
  private permission: PermissionGuard;
  private config: AgentCoreConfig;
  private models: Models;

  constructor(
    events: EventBus,
    tools: ToolRegistry,
    permission: PermissionGuard,
    config?: AgentCoreConfig,
  ) {
    this.events = events;
    this.tools = tools;
    this.permission = permission;
    this.config = {
      defaultModel: 'anthropic/claude-sonnet-4-20250514',
      defaultThinkingLevel: 'medium',
      maxIterations: 50,
      ...config,
    };
    this.models = createModels();
  }

  /** 解析模型实例 */
  private resolveModel(): Model<Api> | undefined {
    const [providerId, modelId] = (this.config.defaultModel ?? '').split('/');
    if (!providerId || !modelId) return undefined;
    return this.models.getModel(providerId, modelId);
  }

  /** 构建 Pi AgentContext */
  private buildContext(session: ActiveSession): AgentContext {
    const toolDefs = this.tools.getTools();
    const piTools = toolDefs.map((t) => ({
      name: t.name,
      label: t.name,
      description: t.description,
      parameters: { type: 'object', properties: {} } as unknown,
      execute: async (args: unknown) => {
        // 权限检查
        const allowed = await this.permission.check(t.name, {
          tool: t.name,
          args: args as Record<string, unknown>,
        });
        if (!allowed) {
          return {
            content: [{ type: 'text' as const, text: `Permission denied for tool: ${t.name}` }],
            isError: true,
          };
        }
        const result = await this.tools.execute(t.name, args as Record<string, unknown>);
        const text = result.success
          ? typeof result.data === 'string'
            ? result.data
            : JSON.stringify(result.data)
          : (result.error ?? 'Tool execution failed');
        return {
          content: [{ type: 'text' as const, text }],
          isError: !result.success,
        };
      },
    }));

    return {
      systemPrompt: session.systemPrompt,
      messages: session.messages,
      tools: piTools as unknown as AgentContext['tools'],
    };
  }

  /** 创建会话 */
  createSession(opts: AgentSessionOpts): string {
    const id = `${opts.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: ActiveSession = {
      id,
      opts,
      status: 'idle',
      abortController: new AbortController(),
      messages: [],
      systemPrompt:
        'You are Lattice Agent, a helpful coding assistant integrated with the Lattice workflow system.',
    };
    this.sessions.set(id, session);
    this.events.emit('agent:session_created', { sessionId: id, agentId: opts.agentId });
    return id;
  }

  /** 发送消息并获取流式响应 */
  async *prompt(
    sessionId: string,
    message: string,
    systemPrompt?: string,
  ): AsyncIterable<AgentEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.status = 'running';
    session.abortController = new AbortController();
    if (systemPrompt) session.systemPrompt = systemPrompt;
    this.events.emit('agent:response_start', { sessionId });

    // 添加用户消息到历史
    const userMsg: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: message }],
      timestamp: Date.now(),
    } as AgentMessage;
    session.messages.push(userMsg);

    const model = this.resolveModel();
    if (!model) {
      // 模型不可用时的降级响应
      yield {
        type: 'text',
        content: `[Agent] 模型 ${this.config.defaultModel} 不可用，请检查 API key 配置。`,
      };
      yield { type: 'done', summary: 'Model not available' };
      session.status = 'idle';
      return;
    }

    try {
      const context = this.buildContext(session);
      const loopConfig: AgentLoopConfig = {
        model,
        convertToLlm: (messages: AgentMessage[]) => messages as never[],
        beforeToolCall: async ({ toolCall, args }) => {
          const allowed = await this.permission.check(toolCall.name, {
            tool: toolCall.name,
            args: args as Record<string, unknown>,
          });
          if (!allowed) {
            return { block: true, reason: `Permission denied: ${toolCall.name}` };
          }
          return {};
        },
      } as AgentLoopConfig;

      const stream = agentLoop(
        [userMsg],
        context,
        loopConfig,
        session.abortController.signal,
        this.models.streamSimple.bind(this.models),
      );

      for await (const event of stream as AsyncIterable<PiAgentEvent>) {
        const mapped = this.mapPiEvent(event);
        if (mapped) {
          // 保存 assistant 消息到历史
          if (event.type === 'turn_end' && 'message' in event) {
            session.messages.push(event.message as AgentMessage);
          }
          yield mapped;
        }
      }

      yield { type: 'done', summary: 'Agent response complete' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      session.status = 'error';
      this.events.emit('agent:error', { sessionId, error: errorMsg });
      yield {
        type: 'error',
        message: errorMsg,
        code: 'unknown' as const,
        retryable: false,
        source: { id: 'pi', name: 'Pi Agent' },
      };
      return;
    }

    session.status = 'idle';
    this.events.emit('agent:response_end', { sessionId });
  }

  /** 映射 Pi AgentEvent → Lattice AgentEvent */
  private mapPiEvent(event: PiAgentEvent): AgentEvent | null {
    switch (event.type) {
      case 'agent_start':
        return { type: 'thinking', content: 'Agent started...' };
      case 'message_start':
        return { type: 'thinking', content: 'Generating response...' };
      case 'message_update': {
        const e = event as { type: string; delta?: { text?: string } };
        return e.delta?.text ? { type: 'text', content: e.delta.text } : null;
      }
      case 'tool_execution_start': {
        const e = event as { type: string; toolCall?: { id?: string; name?: string } };
        return {
          type: 'tool_call',
          id: e.toolCall?.id ?? crypto.randomUUID(),
          name: e.toolCall?.name ?? 'unknown',
          args: {},
        };
      }
      case 'tool_execution_end': {
        const e = event as {
          type: string;
          toolCall?: { id?: string; name?: string };
          result?: unknown;
        };
        return {
          type: 'tool_result',
          id: e.toolCall?.id ?? crypto.randomUUID(),
          name: e.toolCall?.name ?? 'unknown',
          result: e.result,
        };
      }
      case 'turn_end':
        return { type: 'thinking', content: 'Turn complete' };
      case 'agent_end':
        return null; // 由外层 yield done
      default:
        return null;
    }
  }

  /** 中断当前执行 */
  abort(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      session.status = 'idle';
      this.events.emit('agent:aborted', { sessionId });
    }
  }

  /** 销毁会话 */
  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      this.sessions.delete(sessionId);
      this.events.emit('agent:session_destroyed', { sessionId });
    }
  }

  /** 获取会话状态 */
  getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** 所有活跃会话 */
  getActiveSessions(): ActiveSession[] {
    return [...this.sessions.values()];
  }

  /** 刷新模型列表 */
  async refreshModels(): Promise<void> {
    await this.models.refresh({ allowNetwork: true });
  }
}
