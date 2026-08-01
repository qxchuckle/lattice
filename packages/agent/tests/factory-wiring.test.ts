/**
 * factory 装配冒烟测试：createLatticeAgent 的接线是否真的成立
 *
 * 为什么必须有：R1.5/R2 把能力消费、任务注入、权限通道都挪进了 factory 装配，
 * 而在此之前 createLatticeAgent 从未被任何测试实例化过——接线错了不会有任何红灯。
 * 本文件盯的是「装配契约」：profile 解析、middleware 清单、降级提示上总线、权限通道就位。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSourceInstance } from '@qcqx/lattice-agent-source';
import { createLatticeAgent } from '../src/index.js';
import { defineSource } from '@qcqx/lattice-agent-source';
import { createScriptedDriver } from '@qcqx/lattice-agent-source/testing';
import { SourceRegistry } from '@qcqx/lattice-agent-source';
import type { SourceCapabilities } from '@qcqx/lattice-agent-protocol';

/** 贫瘠画像：不支持图片 + 不支持 append（触发两条降级路径） */
const LEAN: Partial<SourceCapabilities> = {
  prompt: {
    images: false,
    systemPrompt: { builtin: 'opaque', override: false, append: false },
    slashCommands: false,
    permissionModes: false,
  },
};

let tmpDir: string;
let baseDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'lattice-factory-'));
  process.env.LATTICE_HOME = tmpDir;
  baseDir = join(tmpDir, '.cache', 'sessions');
});
afterEach(async () => {
  delete process.env.LATTICE_HOME;
  await rm(tmpDir, { recursive: true, force: true });
});

async function setupAgent(capabilities?: Partial<SourceCapabilities>) {
  const registry = new SourceRegistry();
  registry.register(
    defineSource(
      createScriptedDriver({
        id: 'scripted',
        capabilities,
        script: [{ type: 'text', content: '回复' }],
      }),
    ),
  );
  await registry.initAll();
  const sources = {
    registry,
    dispose: async () => {},
  } as unknown as AgentSourceInstance;
  const agent = createLatticeAgent({
    sources,
  });
  return agent;
}

describe('createLatticeAgent 装配', () => {
  it('暴露 profiles，且能从握手 manifest 解析出该源的策略', async () => {
    const agent = await setupAgent();
    const profile = agent.profiles.get('scripted');
    expect(profile).toBeDefined();
    expect(profile!.sourceId).toBe('scripted');
    expect(profile!.plans.fork).toBe('none'); // 脚本化 driver 最保守基线
    await agent.dispose();
  });

  it('管线含 lattice 专属任务上下文注入（价值类拦截接进同一管线）', async () => {
    const agent = await setupAgent();
    const names = agent.profiles.get('scripted')!.middlewares.map((m) => m.name);
    expect(names).toContain('normalize');
    expect(names).toContain('tool-semantic');
    expect(names).toContain('capability-guard');
    expect(names).toContain('lattice-task-context');
    await agent.dispose();
  });

  it('未注册源 → profile 为 undefined（不抛错，宿主可据此禁用入口）', async () => {
    const agent = await setupAgent();
    expect(agent.profiles.get('ghost')).toBeUndefined();
    await agent.dispose();
  });

  it('降级提示上总线：图片被源拒收时 events 收到 source:notice（不静默）', async () => {
    const agent = await setupAgent(LEAN);
    const notices: Array<Record<string, unknown>> = [];
    agent.events.on('source:notice', (e) => notices.push(e.payload));

    const profile = agent.profiles.get('scripted')!;
    const normalize = profile.middlewares.find((m) => m.name === 'normalize')!;
    await normalize.transformPrompt!(
      {
        sessionId: null,
        message: [{ type: 'image', data: 'AAA', mimeType: 'image/png' }],
        opts: {},
      },
      { sourceId: 'scripted' },
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ sourceId: 'scripted', code: 'images_dropped' });
    await agent.dispose();
  });

  it('profile 缓存：同源重复取为同一对象；invalidate 后重解析', async () => {
    const agent = await setupAgent();
    const first = agent.profiles.get('scripted');
    expect(agent.profiles.get('scripted')).toBe(first);
    agent.profiles.invalidate('scripted');
    expect(agent.profiles.get('scripted')).not.toBe(first);
    await agent.dispose();
  });

  it('权限通道就位：PermissionGuard 规则生效于源侧权限请求', async () => {
    const agent = await setupAgent();
    agent.permission.setScope({ scopePaths: [baseDir], safePaths: [] });
    agent.permission.setRules([{ tool: 'Write', level: 'deny' }]);
    // 装配后的 handler 不对外暴露，故直接验证策略源（guard）的判定被 lattice 规则驱动
    expect(agent.permission.check('Write', { path: join(baseDir, 'a.ts') })).toBe('deny');
    expect(agent.permission.check('Read', { path: join(baseDir, 'a.ts') })).toBe('ask');
    await agent.dispose();
  });
});
