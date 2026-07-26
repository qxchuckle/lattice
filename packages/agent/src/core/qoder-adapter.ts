/**
 * Qoder Agent 适配器 — 通过 @qoder-ai/qoder-agent-sdk 接入 Qoder
 * 支持多轮对话、流式输出、中断
 */
import { query, qodercliAuth, accessTokenFromEnv } from '@qoder-ai/qoder-agent-sdk';
import type { AgentEvent } from '../types.js';
import type { IExternalAgentAdapter, ExternalAgentConfig } from './external-agents.js';

interface QoderSession {
  id: string;
  cwd: string;
  abortController: AbortController;
  /** 当前 query 迭代器 */
  activeQuery: ReturnType<typeof query> | null;
  status: 'idle' | 'running' | 'error';
}

export interface QoderAdapterConfig {
  /** 认证方式：env = QODER_PERSONAL_ACCESS_TOKEN 环境变量, cli = 复用本机 qodercli 登录态 */
  authMode?: 'env' | 'cli';
  /** 允许的工具列表 */
  allowedTools?: string[];
  /** 权限模式 */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  /** 工作目录 */
  cwd?: string;
}

export class QoderAdapter implements IExternalAgentAdapter {
  readonly config: ExternalAgentConfig = {
    id: 'qoder',
    displayName: 'Qoder',
    detect: async () => {
      try {
        const { execSync } = await import('node:child_process');
        execSync('qodercli --version', { stdio: 'pipe' });
        return true;
      } catch {
        // 也检查环境变量
        return !!process.env.QODER_PERSONAL_ACCESS_TOKEN;
      }
    },
  };

  private sessions = new Map<string, QoderSession>();
  private adapterConfig: QoderAdapterConfig;

  constructor(config?: QoderAdapterConfig) {
    this.adapterConfig = {
      authMode: 'cli',
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'SearchCodebase', 'LSP'],
      permissionMode: 'acceptEdits',
      ...config,
    };
  }

  async createSession(cwd: string): Promise<string> {
    const id = `qoder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.sessions.set(id, {
      id,
      cwd,
      abortController: new AbortController(),
      activeQuery: null,
      status: 'idle',
    });
    return id;
  }

  async *send(sessionId: string, message: string): AsyncIterable<AgentEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      yield {
        type: 'error',
        message: 'Session not found',
        code: 'session_not_found' as const,
        retryable: false,
        source: { id: 'qoder', name: 'Qoder' },
      };
      return;
    }

    session.status = 'running';
    session.abortController = new AbortController();

    const auth = this.adapterConfig.authMode === 'env' ? accessTokenFromEnv() : qodercliAuth();

    const q = query({
      prompt: message,
      options: {
        auth,
        cwd: session.cwd,
        allowedTools: this.adapterConfig.allowedTools,
        permissionMode: this.adapterConfig.permissionMode as never,
        includePartialMessages: true,
        abortController: session.abortController,
      },
    });

    session.activeQuery = q;

    try {
      for await (const msg of q) {
        const events = this.mapMessage(msg);
        for (const event of events) {
          yield event;
        }
      }
      yield { type: 'done', summary: 'Qoder response complete' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (!session.abortController.signal.aborted) {
        yield {
          type: 'error',
          message: errorMsg,
          code: 'unknown' as const,
          retryable: false,
          source: { id: 'qoder', name: 'Qoder' },
        };
      }
    } finally {
      session.activeQuery = null;
      session.status = 'idle';
    }
  }

  /** 映射 Qoder SDK 消息 → Lattice AgentEvent */
  private mapMessage(msg: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = [];
    const type = msg.type as string;

    if (type === 'assistant') {
      const message = msg.message as {
        content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
      };
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            events.push({ type: 'text', content: block.text });
          } else if (block.type === 'tool_use') {
            events.push({
              type: 'tool_call',
              id: crypto.randomUUID(),
              name: block.name ?? 'unknown',
              args: (block.input as Record<string, unknown>) ?? {},
            });
          }
        }
      }
    } else if (type === 'stream_event') {
      const event = msg.event as {
        delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
      };
      const delta = event?.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        events.push({ type: 'text', content: delta.text });
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        events.push({ type: 'thinking', content: delta.thinking });
      }
    } else if (type === 'result') {
      const subtype = msg.subtype as string;
      if (subtype === 'success') {
        events.push({ type: 'done', summary: 'success' });
      } else if (subtype === 'error') {
        events.push({
          type: 'error',
          message: (msg.error as string) ?? 'Unknown error',
          code: 'unknown' as const,
          retryable: false,
          source: { id: 'qoder', name: 'Qoder' },
        });
      }
    }

    return events;
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      if (session.activeQuery) {
        try {
          await session.activeQuery.interrupt();
        } catch {
          /* ignore */
        }
      }
      session.status = 'idle';
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      if (session.activeQuery) {
        try {
          await session.activeQuery.close();
        } catch {
          /* ignore */
        }
      }
      this.sessions.delete(sessionId);
    }
  }
}
