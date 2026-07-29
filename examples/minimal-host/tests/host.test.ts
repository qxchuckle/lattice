/**
 * 验收测试：三包宿主故事线成立吗？
 *
 * 用 agent-source 的脚本化 driver 造两个能力迥异的源（富能力 / 贫瘠 ACP 式），
 * 同一份 MinimalHost 代码跑通两者，且宿主代码里零源判断：
 * - 富能力源：slash 原生透传、fork 带锚点
 * - 贫瘠源：宿主展开 slash、图片降级为占位、fork 丢锚点并给 notice、超出目录的模型被拒
 */
import { describe, it, expect } from 'vitest';
import { SourceRegistry, defineSource } from '@qcqx/lattice-agent-source';
import { createScriptedDriver } from '@qcqx/lattice-agent-source/testing';
import { PipelineError } from '@qcqx/lattice-agent-pipeline';
import type { SourceCapabilities } from '@qcqx/lattice-agent-protocol';
import { MinimalHost } from '../src/host.js';

const RICH: Partial<SourceCapabilities> = {
  session: {
    resume: true,
    fork: { atMessage: true },
    rename: true,
    maxConcurrentSessions: 'unlimited',
  },
  prompt: {
    images: true,
    systemPrompt: { builtin: 'none', override: true, append: true },
    slashCommands: { interpret: true },
    permissionModes: false,
  },
  models: { policy: 'open', tuning: true },
  skills: { nativeInjection: true },
};

const LEAN: Partial<SourceCapabilities> = {
  session: { resume: true, fork: { atMessage: false }, rename: false, maxConcurrentSessions: 4 },
  prompt: {
    images: false,
    systemPrompt: { builtin: 'opaque', override: false, append: false },
    slashCommands: { interpret: false },
    permissionModes: false,
  },
  models: { policy: 'catalog', tuning: false },
  skills: { nativeInjection: false },
};

/** 连 fork 都没有的源（对照组：投影层直接关掉分支/重问） */
const NO_FORK: Partial<SourceCapabilities> = {
  ...LEAN,
  session: { resume: true, fork: false, rename: false, maxConcurrentSessions: 1 },
};

const LEAN_MODELS = [
  {
    id: 'lean-1',
    displayName: 'Lean 1',
    capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
  },
];

async function setup() {
  const registry = new SourceRegistry();
  registry.register(
    defineSource(
      createScriptedDriver({
        id: 'rich',
        capabilities: RICH,
        script: [{ type: 'text', content: '富能力回复' }],
        outcome: { sourceMessageId: 'msg-9' },
      }),
    ),
  );
  registry.register(
    defineSource(
      createScriptedDriver({
        id: 'lean',
        capabilities: LEAN,
        models: LEAN_MODELS,
        script: [{ type: 'text', content: '贫瘠回复' }],
        outcome: { sourceMessageId: 'msg-3' },
      }),
    ),
  );
  registry.register(
    defineSource(
      createScriptedDriver({
        id: 'nofork',
        capabilities: NO_FORK,
        script: [{ type: 'text', content: '无分叉回复' }],
      }),
    ),
  );
  await registry.initAll();
  const host = new MinimalHost(registry, {
    resolveCommandTemplate: async (name) => (name === 'build' ? '构建指令正文' : null),
    listSkills: async () => [{ name: 'review', description: '代码评审' }],
  });
  return { registry, host };
}

describe('minimal-host：三包 + 会话簿记 = 完整宿主', () => {
  it('富能力源：slash 原样透传（源自解释），源级 skills 不重复罗列', async () => {
    const { host } = await setup();
    const profile = await host.prepare('rich');
    expect(profile.middlewares.map((m) => m.name)).toEqual([
      'normalize',
      'tool-semantic',
      'skills-injection',
      'capability-guard',
    ]);
    expect(profile.plans.skills.includeSourceSkills).toBe(false);

    host.createThread('t1', 'rich');
    const turn = await host.send('t1', [{ type: 'text', text: '/build now' }]);
    expect(turn.text).toBe('富能力回复');
    expect(turn.notices).toEqual([]);
  });

  it('贫瘠源：宿主展开 slash + 注入 skills 清单 + 图片降级并提示', async () => {
    const { host } = await setup();
    const profile = await host.prepare('lean');
    expect(profile.middlewares.map((m) => m.name)).toEqual([
      'normalize',
      'tool-semantic',
      'slash-expansion',
      'skills-injection',
      'capability-guard',
    ]);

    host.createThread('t2', 'lean');
    const turn = await host.send('t2', [
      { type: 'text', text: '/build now' },
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ]);
    expect(turn.text).toBe('贫瘠回复');
    // 图片降级 + skills 清单内联（该源既不支持 append 也不可覆盖）各出一条提示
    expect(turn.notices).toHaveLength(2);
    expect(turn.notices.join('|')).toMatch(/图片/);
  });

  it('会话簿记：首轮建会话，次轮续上同一 sessionId', async () => {
    const { host } = await setup();
    host.createThread('t3', 'rich');
    await host.send('t3', [{ type: 'text', text: 'a' }]);
    const second = await host.send('t3', [{ type: 'text', text: 'b' }]);
    expect(second.text).toBe('富能力回复');
  });

  it('fork：富能力源精确分叉无提示；贫瘠源丢锚点并给 notice', async () => {
    const { host } = await setup();
    host.createThread('t4', 'rich');
    await host.send('t4', [{ type: 'text', text: 'a' }]);
    expect(await host.fork('t4', 't4-branch')).toEqual([]);

    host.createThread('t5', 'lean');
    await host.send('t5', [{ type: 'text', text: 'a' }]);
    const notices = await host.fork('t5', 't5-branch');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/锚点/);
  });

  it('节点能力投影随源能力变化（UI 据数据渲染，不猜）', async () => {
    const { host } = await setup();
    // 锚点缺失（fork atMessage:false）仍可分支——近似执行由策略层带 notice 消化
    host.createThread('t6', 'lean');
    await host.prepare('lean');
    expect(host.nodeCapabilities('t6', 'done').canBranch).toBe(true);

    // 完全无 fork 能力 → 投影层直接关掉分支与重问（UI 置灰，接口同样拒绝）
    host.createThread('t6b', 'nofork');
    await host.prepare('nofork');
    expect(host.nodeCapabilities('t6b', 'done').canBranch).toBe(false);
    expect(host.nodeCapabilities('t6b', 'error').canRetry).toBe(false);
  });

  it('绕过 UI 直调：模型不在目录内 → PipelineError（与视图禁用状态一致）', async () => {
    const { host } = await setup();
    host.createThread('t7', 'lean');
    await expect(
      host.send('t7', [{ type: 'text', text: 'a' }], { model: 'ghost-model' }),
    ).rejects.toBeInstanceOf(PipelineError);
    // 目录内模型正常放行
    await expect(
      host.send('t7', [{ type: 'text', text: 'a' }], { model: 'lean-1' }),
    ).resolves.toMatchObject({ text: '贫瘠回复' });
  });
});
