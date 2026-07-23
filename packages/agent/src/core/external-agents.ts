/**
 * 外部 Agent 适配器 — 统一接口桥接不同 Agent（Claude Code / Codex / 通用 PTY）
 */
import type { AgentEvent } from '../types.js';

export interface ExternalAgentConfig {
  id: string;
  displayName: string;
  /** 检测是否可用 */
  detect(): Promise<boolean>;
}

export interface ExternalAgentSession {
  id: string;
  agentId: string;
  cwd: string;
  status: 'idle' | 'running' | 'error';
}

export interface IExternalAgentAdapter {
  readonly config: ExternalAgentConfig;
  createSession(cwd: string): Promise<string>;
  send(sessionId: string, message: string): AsyncIterable<AgentEvent>;
  abort(sessionId: string): Promise<void>;
  destroySession(sessionId: string): Promise<void>;
}

// ── Claude Code SDK 适配器 ──

export class ClaudeCodeAdapter implements IExternalAgentAdapter {
  readonly config: ExternalAgentConfig = {
    id: 'claude-code',
    displayName: 'Claude Code',
    detect: async () => {
      // 检测 claude CLI 是否可用
      try {
        const { execSync } = await import('node:child_process');
        execSync('claude --version', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
  };

  private sessions = new Map<string, { cwd: string; abortController: AbortController }>();

  async createSession(cwd: string): Promise<string> {
    const id = `cc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.sessions.set(id, { cwd, abortController: new AbortController() });
    return id;
  }

  async *send(sessionId: string, message: string): AsyncIterable<AgentEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) { yield { type: 'error', message: 'Session not found' }; return; }

    // TODO: Phase 4 实际集成 @anthropic-ai/claude-code SDK
    // 当前为骨架：通过 claude --print 模式调用
    yield { type: 'thinking', content: 'Claude Code adapter (skeleton)...' };
    yield { type: 'text', content: `[Claude Code 骨架] 收到: "${message.slice(0, 50)}"` };
    yield { type: 'done' };
  }

  async abort(sessionId: string): Promise<void> {
    this.sessions.get(sessionId)?.abortController.abort();
  }

  async destroySession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

// ── 通用 PTY 适配器（兜底） ──

export class GenericPtyAdapter implements IExternalAgentAdapter {
  readonly config: ExternalAgentConfig;

  constructor(opts: { id: string; name: string; command: string }) {
    this.config = {
      id: opts.id,
      displayName: opts.name,
      detect: async () => {
        try {
          const { execSync } = await import('node:child_process');
          execSync(`which ${opts.command}`, { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  async createSession(cwd: string): Promise<string> {
    return `pty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async *send(_sessionId: string, message: string): AsyncIterable<AgentEvent> {
    // TODO: Phase 4 实际 PTY spawn + ANSI 解析
    yield { type: 'text', content: `[Generic PTY 骨架] ${message.slice(0, 50)}` };
    yield { type: 'done' };
  }

  async abort(): Promise<void> { /* TODO */ }
  async destroySession(): Promise<void> { /* TODO */ }
}

// ── Agent 注册表 ──

export class AgentRegistry {
  private adapters = new Map<string, IExternalAgentAdapter>();

  register(adapter: IExternalAgentAdapter): void {
    this.adapters.set(adapter.config.id, adapter);
  }

  get(id: string): IExternalAgentAdapter | undefined {
    return this.adapters.get(id);
  }

  async detectAvailable(): Promise<{ id: string; name: string; available: boolean }[]> {
    const results: { id: string; name: string; available: boolean }[] = [];
    for (const adapter of this.adapters.values()) {
      const available = await adapter.config.detect();
      results.push({ id: adapter.config.id, name: adapter.config.displayName, available });
    }
    return results;
  }

  list(): { id: string; name: string }[] {
    return [...this.adapters.values()].map((a) => ({ id: a.config.id, name: a.config.displayName }));
  }
}
