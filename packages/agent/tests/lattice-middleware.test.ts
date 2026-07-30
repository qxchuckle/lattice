/**
 * lattice 专属接线测试：任务上下文注入 middleware + 反向权限通道适配
 *
 * 行为等价基线：无任务关联 / 无 ContextSource 时**不得**注入（重构前也不注入）。
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  MiddlewareContext,
  PromptPayload,
  SourceCapabilities,
} from '@qcqx/lattice-agent-protocol';
import { EventBus } from '../src/events/event-bus.js';
import { ContextEngine } from '../src/context/context-engine.js';
import { createTaskContextMiddleware } from '../src/context/task-context-middleware.js';
import { PermissionGuard } from '../src/permission/permission-guard.js';
import { createSourcePermissionHandler } from '../src/permission/source-permission.js';

const APPENDABLE: SourceCapabilities['prompt']['systemPrompt'] = {
  builtin: 'opaque',
  override: true,
  append: true,
};
const LOCKED: SourceCapabilities['prompt']['systemPrompt'] = {
  builtin: 'opaque',
  override: false,
  append: false,
};

function capsWith(systemPrompt: SourceCapabilities['prompt']['systemPrompt']): SourceCapabilities {
  return {
    execution: { mode: 'delegated', contextOwnership: 'source' },
    session: { resume: true, fork: { atMessage: true }, rename: true, maxConcurrentSessions: 1 },
    prompt: { images: true, systemPrompt, slashCommands: false, permissionModes: false },
    tools: { builtin: [], injection: false },
    context: { compaction: false },
    models: { policy: 'open', tuning: false },
    resources: false,
    skills: { nativeInjection: false },
  };
}

function payloadOf(opts: PromptPayload['opts'] = {}): PromptPayload {
  return { sessionId: null, message: [{ type: 'text', text: 'hi' }], opts };
}

/** 带任务数据的 ContextEngine（模拟 lattice-core 注入的 ContextSource） */
function engineWithTask(): ContextEngine {
  const engine = new ContextEngine(new EventBus());
  engine.setSource({
    getTaskSummary: async () => '任务目标：重构管线',
    getRelevantSpecs: async () => [{ name: 'agent-layering', content: '分层规则正文' }],
    getRecentCheckpoints: async () => ['cp1: 完成 R1'],
    getProjectPaths: async () => ['/repo'],
  });
  return engine;
}

describe('任务上下文注入 middleware', () => {
  const ctxWith = (taskId?: string): MiddlewareContext => ({
    sourceId: 'mock',
    metadata: { taskId },
  });

  it('线程无任务关联 → 原样返回（与重构前行为一致）', async () => {
    const mw = createTaskContextMiddleware({
      engine: engineWithTask(),
      capabilities: capsWith(APPENDABLE),
    });
    const payload = payloadOf();
    expect(await mw.transformPrompt!(payload, ctxWith(undefined))).toBe(payload);
  });

  it('有任务但 ContextSource 未注入 → 不注入（空层不产生空壳段）', async () => {
    const mw = createTaskContextMiddleware({
      engine: new ContextEngine(new EventBus()),
      capabilities: capsWith(APPENDABLE),
    });
    const payload = payloadOf();
    expect(await mw.transformPrompt!(payload, ctxWith('T-1'))).toBe(payload);
  });

  it('有任务 + 有数据 → 注入 systemPrompt.append（含 spec 与 PRD）', async () => {
    const mw = createTaskContextMiddleware({
      engine: engineWithTask(),
      capabilities: capsWith(APPENDABLE),
    });
    const out = await mw.transformPrompt!(payloadOf(), ctxWith('T-1'));
    const config = out.opts.systemPrompt;
    expect(config?.mode).toBe('append');
    const text = config?.mode === 'append' ? config.additional : '';
    expect(text).toContain('分层规则正文');
    expect(text).toContain('任务目标：重构管线');
  });

  it('已有 append 段（如 skills 清单）→ 合并而非覆盖', async () => {
    const mw = createTaskContextMiddleware({
      engine: engineWithTask(),
      capabilities: capsWith(APPENDABLE),
    });
    const out = await mw.transformPrompt!(
      payloadOf({ systemPrompt: { mode: 'append', additional: '<available_skills>…' } }),
      ctxWith('T-1'),
    );
    const config = out.opts.systemPrompt;
    const text = config?.mode === 'append' ? config.additional : '';
    expect(text).toContain('<available_skills>…');
    expect(text).toContain('分层规则正文');
  });

  it('源不可 append/override → 降级为并入消息正文并发提示（不静默）', async () => {
    const notices: string[] = [];
    const mw = createTaskContextMiddleware({
      engine: engineWithTask(),
      capabilities: capsWith(LOCKED),
      onNotice: (m) => notices.push(m),
    });
    const out = await mw.transformPrompt!(payloadOf(), ctxWith('T-1'));
    expect(out.opts.systemPrompt).toBeUndefined();
    expect(out.message[0]).toMatchObject({ type: 'text' });
    expect(notices).toHaveLength(1);
  });
});

describe('反向权限通道：PermissionGuard 适配', () => {
  const req = {
    sessionId: 's1',
    kind: 'tool' as const,
    toolName: 'Write',
    description: '写入文件',
    detail: { path: '/repo/a.ts' },
  };

  it('规则 allow → 直接放行，不发问询事件', async () => {
    const events = new EventBus();
    const guard = new PermissionGuard(events);
    guard.setScope({ scopePaths: ['/repo'], safePaths: [] });
    guard.setRules([{ tool: 'Write', level: 'allow' }]);
    let asked = false;
    events.on('permission:request', () => (asked = true));

    const decide = createSourcePermissionHandler(guard);
    expect(await decide(req)).toMatchObject({ behavior: 'allow' });
    expect(asked).toBe(false);
  });

  it('规则 deny → 拒绝且带原因（源可转述给模型）', async () => {
    const guard = new PermissionGuard(new EventBus());
    guard.setScope({ scopePaths: ['/repo'], safePaths: [] });
    guard.setRules([{ tool: '*', level: 'deny' }]);
    const decision = await createSourcePermissionHandler(guard)(req);
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toBeTruthy();
  });

  it('规则 ask → 发 permission:request，respond(true) 后放行', async () => {
    const events = new EventBus();
    const guard = new PermissionGuard(events);
    guard.setScope({ scopePaths: ['/repo'], safePaths: [] });
    guard.setRules([{ tool: 'Write', level: 'ask' }]);
    events.on('permission:request', (e) => {
      const request = e.payload.request as { id: string };
      guard.respond(request.id, true);
    });
    expect(await createSourcePermissionHandler(guard)(req)).toMatchObject({ behavior: 'allow' });
  });

  it('规则 ask → 未应答超时自动拒绝（timeout → false）', async () => {
    vi.useFakeTimers();
    try {
      const events = new EventBus();
      const guard = new PermissionGuard(events);
      guard.setScope({ scopePaths: ['/repo'], safePaths: [] });
      guard.setRules([{ tool: 'Write', level: 'ask' }]);
      // 不应答，直接推进超过 60s 超时窗口
      const decision = createSourcePermissionHandler(guard)(req);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(await decision).toMatchObject({ behavior: 'deny' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('路径越界（scope 外）→ 拒绝，不问询', async () => {
    const events = new EventBus();
    const guard = new PermissionGuard(events);
    guard.setScope({ scopePaths: ['/repo'], safePaths: [] });
    let asked = false;
    events.on('permission:request', () => (asked = true));
    const decision = await createSourcePermissionHandler(guard)({
      ...req,
      detail: { path: '/etc/passwd' },
    });
    expect(decision.behavior).toBe('deny');
    expect(asked).toBe(false);
  });
});
