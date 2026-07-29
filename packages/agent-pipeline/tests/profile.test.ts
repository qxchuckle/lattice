/**
 * profile 解析 + 通用 middleware 行为测试
 *
 * 核心验收：三种能力画像 → 装配出不同管线，而消费方代码一行 if 都不写。
 */
import { describe, it, expect, vi } from 'vitest';
import type { PromptPayload, MiddlewareContext } from '@qcqx/lattice-agent-protocol';
import {
  resolveSourceProfile,
  runPrompt,
  parseSlashCommand,
  formatSkillsAppendix,
  createNormalizeMiddleware,
  createSkillsInjectionMiddleware,
  createCapabilityGuardMiddleware,
  PipelineError,
  type PipelineNotice,
} from '../src/index.js';
import { PI_LIKE, QODER_LIKE, ACP_LIKE, manifestOf, createFakeSource } from './fixtures.js';

const CTX: MiddlewareContext = { sourceId: 'fake' };

function payloadOf(text: string, opts: PromptPayload['opts'] = {}): PromptPayload {
  return { sessionId: null, message: [{ type: 'text', text }], opts };
}

describe('resolveSourceProfile：能力 → 计划', () => {
  it('Pi 画像：原生 slash + 原生 skills → 只装通用两件（normalize + guard）', () => {
    const profile = resolveSourceProfile(manifestOf('pi', PI_LIKE), {
      resolveCommandTemplate: async () => 'T',
      listSkills: async () => [{ name: 's' }],
    });
    expect(profile.middlewares.map((m) => m.name)).toEqual(['normalize', 'capability-guard']);
    expect(profile.plans).toMatchObject({
      fork: 'at-message',
      slash: { kind: 'native' },
      toolInjection: { kind: 'direct', transport: 'in-process' },
    });
  });

  it('Qoder 画像：无原生 slash + 无原生 skills → 装满四件', () => {
    const profile = resolveSourceProfile(manifestOf('qoder', QODER_LIKE), {
      resolveCommandTemplate: async () => 'T',
      listSkills: async () => [{ name: 's' }],
    });
    expect(profile.middlewares.map((m) => m.name)).toEqual([
      'normalize',
      'slash-expansion',
      'skills-injection',
      'capability-guard',
    ]);
    expect(profile.plans.toolInjection).toEqual({ kind: 'direct', transport: 'mcp-bridge' });
  });

  it('ACP 画像：fork 无锚点 → 投影里如实反映（UI 据此渲染，不猜）', () => {
    const profile = resolveSourceProfile(manifestOf('acp', ACP_LIKE));
    expect(profile.plans.fork).toBe('session-only');
    expect(profile.projection).toEqual({ fork: { atMessage: false } });
    expect(profile.plans.compaction.kind).toBe('host-polyfill');
  });

  it('宿主未提供模板解析器 → 不装 slash 展开（避免装个空壳吞命令）', () => {
    const profile = resolveSourceProfile(manifestOf('qoder', QODER_LIKE));
    expect(profile.middlewares.map((m) => m.name)).not.toContain('slash-expansion');
  });

  it('available/downgrades 原样透出（可用性是数据，不是硬编码）', () => {
    const profile = resolveSourceProfile(
      manifestOf('x', ACP_LIKE, {
        available: false,
        downgrades: [
          { path: 'resources.kinds', declared: ['command'], actual: [], reason: 'probe 实探为空' },
        ],
      }),
    );
    expect(profile.available).toBe(false);
    expect(profile.downgrades).toHaveLength(1);
  });
});

describe('normalize middleware', () => {
  it('源不支持图片 → 图片块替换为占位文本并回调 notice（不静默丢）', async () => {
    const notices: PipelineNotice[] = [];
    const mw = createNormalizeMiddleware({
      capabilities: ACP_LIKE,
      onNotice: (n) => notices.push(n),
    });
    const out = await mw.transformPrompt!(
      {
        sessionId: null,
        message: [
          { type: 'text', text: 'look' },
          { type: 'image', data: 'AAA', mimeType: 'image/png' },
        ],
        opts: {},
      },
      CTX,
    );
    expect(out.message).toEqual([
      { type: 'text', text: 'look' },
      { type: 'text', text: '[图片：当前源不支持图片输入，已省略]' },
    ]);
    expect(notices.map((n) => n.code)).toEqual(['images_dropped']);
  });

  it('源支持图片 → payload 原对象返回（零拷贝，无副作用）', async () => {
    const mw = createNormalizeMiddleware({ capabilities: PI_LIKE });
    const payload = payloadOf('hi');
    expect(await mw.transformPrompt!(payload, CTX)).toBe(payload);
  });

  it('append 不可用且内置不可读 → 指令并入消息正文 + notice', async () => {
    const notices: PipelineNotice[] = [];
    const mw = createNormalizeMiddleware({
      capabilities: ACP_LIKE,
      onNotice: (n) => notices.push(n),
    });
    const out = await mw.transformPrompt!(
      payloadOf('hi', { systemPrompt: { mode: 'append', additional: '守则' } }),
      CTX,
    );
    expect(out.opts.systemPrompt).toBeUndefined();
    expect(out.message[0]).toEqual({ type: 'text', text: '守则' });
    expect(notices.map((n) => n.code)).toEqual(['system_prompt_inlined']);
  });

  it('override 请求碰上不可覆盖的源 → 抛 unsupported_option（不静默降级）', async () => {
    const mw = createNormalizeMiddleware({ capabilities: ACP_LIKE });
    await expect(
      mw.transformPrompt!(
        payloadOf('hi', { systemPrompt: { mode: 'override', prompt: 'X' } }),
        CTX,
      ),
    ).rejects.toBeInstanceOf(PipelineError);
  });
});

describe('slash 展开 middleware', () => {
  it('首行命令解析：名称/参数/多行正文', () => {
    expect(parseSlashCommand('/build')).toEqual({ name: 'build', args: undefined });
    expect(parseSlashCommand('/build --fast')).toEqual({ name: 'build', args: '--fast' });
    expect(parseSlashCommand('/skill:review a\nbody')).toEqual({
      name: 'skill:review',
      args: 'a\nbody',
    });
  });

  it('非命令文本不误伤（正文里的斜杠、路径）', () => {
    expect(parseSlashCommand('请看 /etc/hosts 里的配置')).toBeNull();
    expect(parseSlashCommand('a/b')).toBeNull();
  });

  it('展开为标记包裹形态，args 置于模板之前', async () => {
    const { source, calls } = createFakeSource();
    const profile = resolveSourceProfile(manifestOf('qoder', QODER_LIKE), {
      resolveCommandTemplate: async (name) => (name === 'build' ? '构建步骤：…' : null),
      commandLabel: 'Lattice Command',
    });
    await runPrompt({
      source,
      payload: payloadOf('/build --fast'),
      middlewares: profile.middlewares,
    });
    const sent = calls.prompts[0].message[0];
    expect(sent.type === 'text' && sent.text).toBe(
      '--fast\n\n--- Lattice Command: build ---\n构建步骤：…\n--- End Lattice Command ---',
    );
  });

  it('未知命令 → 原样透传（可能是源级命令或普通文本）', async () => {
    const { source, calls } = createFakeSource();
    const profile = resolveSourceProfile(manifestOf('qoder', QODER_LIKE), {
      resolveCommandTemplate: async () => null,
    });
    await runPrompt({ source, payload: payloadOf('/unknown x'), middlewares: profile.middlewares });
    const sent = calls.prompts[0].message[0];
    expect(sent.type === 'text' && sent.text).toBe('/unknown x');
  });
});

describe('skills 注入 middleware', () => {
  it('源原生注入 → 工厂返回 null（不装配，避免双份清单）', () => {
    expect(
      createSkillsInjectionMiddleware({ capabilities: PI_LIKE, listSkills: async () => [] }),
    ).toBeNull();
  });

  it('清单为空 → 不改 payload（不注入空壳标签）', async () => {
    const mw = createSkillsInjectionMiddleware({
      capabilities: QODER_LIKE,
      listSkills: async () => [],
    })!;
    const payload = payloadOf('hi');
    expect(await mw.transformPrompt!(payload, CTX)).toBe(payload);
  });

  it('可 append 的源 → 清单进 systemPrompt.append', async () => {
    const mw = createSkillsInjectionMiddleware({
      capabilities: QODER_LIKE,
      listSkills: async () => [{ name: 'review', description: '代码评审' }],
    })!;
    const out = await mw.transformPrompt!(payloadOf('hi'), CTX);
    expect(out.opts.systemPrompt).toEqual({
      mode: 'append',
      additional: '<available_skills>\n- review：代码评审\n</available_skills>',
    });
  });

  it('宿主已有 append 请求 → 合并而非覆盖', async () => {
    const mw = createSkillsInjectionMiddleware({
      capabilities: QODER_LIKE,
      listSkills: async () => [{ name: 's' }],
    })!;
    const out = await mw.transformPrompt!(
      payloadOf('hi', { systemPrompt: { mode: 'append', additional: '宿主守则' } }),
      CTX,
    );
    expect(out.opts.systemPrompt).toMatchObject({ mode: 'append' });
    const config = out.opts.systemPrompt;
    expect(config?.mode === 'append' && config.additional).toContain('宿主守则');
    expect(config?.mode === 'append' && config.additional).toContain('available_skills');
  });

  it('清单懒加载：不触发 listSkills 之外的调用（每轮一次）', async () => {
    const listSkills = vi.fn(async () => [{ name: 's' }]);
    const mw = createSkillsInjectionMiddleware({ capabilities: QODER_LIKE, listSkills })!;
    await mw.transformPrompt!(payloadOf('hi'), CTX);
    expect(listSkills).toHaveBeenCalledTimes(1);
  });

  it('清单文案形态', () => {
    expect(formatSkillsAppendix([])).toBe('');
    expect(formatSkillsAppendix([{ name: 'a' }, { name: 'b', description: 'B' }])).toBe(
      '<available_skills>\n- a\n- b：B\n</available_skills>',
    );
  });
});

describe('能力守卫 middleware（接口行为 ≡ 视图）', () => {
  it('catalog 源 + 目录外模型 → unsupported_option', async () => {
    const mw = createCapabilityGuardMiddleware({
      capabilities: QODER_LIKE,
      catalog: [
        {
          id: 'ok',
          displayName: 'OK',
          capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
          contextWindow: 1000,
          maxOutputTokens: 100,
        },
      ],
    });
    await expect(mw.transformPrompt!(payloadOf('hi', { model: 'ghost' }), CTX)).rejects.toThrow(
      /目录内模型/,
    );
    await expect(mw.transformPrompt!(payloadOf('hi', { model: 'ok' }), CTX)).resolves.toBeDefined();
  });

  it('权限模式：不在声明清单内 → 拒绝；无权限轴的源收到该参数 → 拒绝', async () => {
    const qoderGuard = createCapabilityGuardMiddleware({ capabilities: QODER_LIKE });
    await expect(
      qoderGuard.transformPrompt!(payloadOf('hi', { permissionMode: 'yolo' }), CTX),
    ).rejects.toThrow(/不支持权限模式/);
    await expect(
      qoderGuard.transformPrompt!(payloadOf('hi', { permissionMode: 'plan' }), CTX),
    ).resolves.toBeDefined();

    const piGuard = createCapabilityGuardMiddleware({ capabilities: PI_LIKE });
    await expect(
      piGuard.transformPrompt!(payloadOf('hi', { permissionMode: 'default' }), CTX),
    ).rejects.toThrow(/没有权限模式轴/);
  });

  it('注入通道不存在 → 丢弃宿主工具并回调 notice（不静默）', async () => {
    const notices: PipelineNotice[] = [];
    const mw = createCapabilityGuardMiddleware({
      capabilities: ACP_LIKE,
      onNotice: (n) => notices.push(n),
    });
    const out = await mw.transformPrompt!(
      payloadOf('hi', {
        tools: {
          tools: [
            {
              name: 't',
              description: '',
              parameters: {},
              execute: async () => ({ success: true }),
            },
          ],
        },
      }),
      CTX,
    );
    expect(out.opts.tools).toBeUndefined();
    expect(notices.map((n) => n.code)).toEqual(['tools_dropped']);
  });

  it('图片绕过 normalize 直达 guard → 拒绝（纵深防御）', async () => {
    const mw = createCapabilityGuardMiddleware({ capabilities: ACP_LIKE });
    await expect(
      mw.transformPrompt!(
        {
          sessionId: null,
          message: [{ type: 'image', data: 'A', mimeType: 'image/png' }],
          opts: {},
        },
        CTX,
      ),
    ).rejects.toThrow(/不接受图片/);
  });
});
