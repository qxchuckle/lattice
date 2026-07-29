/**
 * 权限闸门测试：反向通道的裁决语义
 *
 * 铁律锁定：默认拒绝（不默认放行）、session 记账免重复问、审计钩子必回调。
 */
import { describe, it, expect, vi } from 'vitest';
import type { SourcePermissionRequest } from '@qcqx/lattice-agent-protocol';
import { createPermissionGate } from '../src/index.js';

function req(overrides: Partial<SourcePermissionRequest> = {}): SourcePermissionRequest {
  return {
    sessionId: 's1',
    kind: 'tool',
    toolName: 'Write',
    description: '写入文件',
    ...overrides,
  };
}

describe('createPermissionGate', () => {
  it('无规则无 ask → 默认拒绝并说明原因（安全默认）', async () => {
    const gate = createPermissionGate();
    expect(await gate(req())).toMatchObject({ behavior: 'deny', message: expect.any(String) });
  });

  it('fallback=ask 但未提供 ask 回调 → 仍然拒绝（不静默放行）', async () => {
    const gate = createPermissionGate({ fallback: 'ask' });
    const decision = await gate(req());
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('问询通道');
  });

  it('规则按顺序匹配，首个命中生效', async () => {
    const gate = createPermissionGate({
      rules: [
        { kind: 'terminal', decision: { behavior: 'deny', message: '禁止执行命令' } },
        { toolName: 'Write', decision: { behavior: 'allow' } },
        { decision: { behavior: 'deny', message: '兜底规则' } },
      ],
    });
    expect((await gate(req({ kind: 'terminal', toolName: undefined }))).behavior).toBe('deny');
    expect((await gate(req())).behavior).toBe('allow');
    expect((await gate(req({ kind: 'other', toolName: undefined }))).message).toBe('兜底规则');
  });

  it('scope=session 的裁决被记账：同类请求不再走规则/问询', async () => {
    const ask = vi.fn(async () => ({ behavior: 'allow' as const, scope: 'session' as const }));
    const gate = createPermissionGate({ fallback: 'ask', ask });
    expect((await gate(req())).behavior).toBe('allow');
    expect((await gate(req())).behavior).toBe('allow');
    expect(ask).toHaveBeenCalledTimes(1); // 第二次命中记账
  });

  it('记账按「会话 + 种类 + 工具」隔离：换会话或换工具要重新问', async () => {
    const ask = vi.fn(async () => ({ behavior: 'allow' as const, scope: 'session' as const }));
    const gate = createPermissionGate({ fallback: 'ask', ask });
    await gate(req());
    await gate(req({ sessionId: 's2' }));
    await gate(req({ toolName: 'Bash' }));
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('scope=once 不记账（每次都重新裁决）', async () => {
    const ask = vi.fn(async () => ({ behavior: 'allow' as const, scope: 'once' as const }));
    const gate = createPermissionGate({ fallback: 'ask', ask });
    await gate(req());
    await gate(req());
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('审计钩子：规则命中/问询/记账/兜底四条路径都留痕', async () => {
    const trail: string[] = [];
    const gate = createPermissionGate({
      rules: [{ kind: 'terminal', decision: { behavior: 'deny' } }],
      fallback: 'ask',
      ask: async () => ({ behavior: 'allow', scope: 'session' }),
      onDecision: (_r, _d, via) => trail.push(via),
    });
    await gate(req({ kind: 'terminal', toolName: undefined }));
    await gate(req());
    await gate(req());
    const denyGate = createPermissionGate({ onDecision: (_r, _d, via) => trail.push(via) });
    await denyGate(req());
    expect(trail).toEqual(['rule#0', 'ask', 'session-memo', 'fallback-deny']);
  });
});
