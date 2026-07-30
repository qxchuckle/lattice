/**
 * 不可信参数边界：tool args 由模型生成，类型必须实检
 *
 * 为什么必须测：这两处此前都是 `args.x as string` 断言。
 * - PermissionGuard：path 给成 number 时 `path.startsWith` 会在**权限守卫内部崩溃**
 * - LatticeToolProvider：错类型静默流进下游，报的是不相关的错，排查代价高
 */
import { describe, it, expect } from 'vitest';
import { PermissionGuard } from '../src/permission/permission-guard.js';
import { LatticeWorkflowProvider, type LatticeToolDeps } from '../src/tools/lattice-provider.js';
import { EventBus } from '../src/events/event-bus.js';

describe('PermissionGuard 脏参数', () => {
  const guardOf = () => {
    const g = new PermissionGuard(new EventBus());
    g.setRules([{ tool: '*', level: 'allow' }]);
    return g;
  };

  it('path 为非字符串 → 拒绝（失败关闭），不崩溃', () => {
    const g = guardOf();
    for (const bad of [123, true, {}, [], { nested: 1 }]) {
      expect(g.check('write', { path: bad })).toBe('deny');
    }
  });

  it('cwd 为非字符串同样拒绝（两个来源等价处理）', () => {
    expect(guardOf().check('bash', { cwd: 42 })).toBe('deny');
  });

  it('path 缺失或为 null → 按无路径处理（沿用既有行为，不误拒）', () => {
    const g = guardOf();
    expect(g.check('read', {})).toBe('allow');
    expect(g.check('read', { path: null })).toBe('allow');
  });

  it('pathPrefix 规则遇脏 path 不抛异常（回归：startsWith 崩溃点）', () => {
    const g = new PermissionGuard(new EventBus());
    g.setRules([{ tool: '*', level: 'allow', pathPrefix: '/safe' }]);
    expect(() => g.check('write', { path: { evil: true } })).not.toThrow();
  });
});

describe('LatticeToolProvider 参数校验', () => {
  const deps: LatticeToolDeps = {
    getUsername: async () => 'u',
    listTasks: async (opts) => [{ id: opts?.status ?? 'all', title: 't', status: 'active' }],
    getTask: async (taskId) => ({ id: taskId, title: 't', status: 'active' }),
    search: async (query, opts) => [{ title: query, snippet: opts?.type ?? '-', type: 'spec' }],
    getSpec: async (name) => ({ name, content: 'c', scope: 'project' }),
    listSpecs: async () => [],
    addCheckpoint: async () => true,
    listProjects: async () => [],
  };

  const providerOf = async () => {
    const p = new LatticeWorkflowProvider(deps);
    await p.init();
    return p;
  };

  it('必填参数类型错误 → 结构化失败，错误文案点名参数', async () => {
    const p = await providerOf();
    const r = await p.execute('lattice.getTask', { taskId: 123 });
    expect(r.success).toBe(false);
    expect(r.error).toContain('taskId');
    expect(r.error).toContain('number'); // 指出实际得到的类型
  });

  it('必填参数缺失/空串 → 失败而非传空值给下游', async () => {
    const p = await providerOf();
    expect((await p.execute('lattice.getSpec', {})).success).toBe(false);
    expect((await p.execute('lattice.getSpec', { name: '' })).success).toBe(false);
  });

  it('可选参数类型错误 → 当作未传（不把垃圾值当过滤条件）', async () => {
    const p = await providerOf();
    const r = await p.execute('lattice.listTasks', { status: { bad: 1 } });
    expect(r.success).toBe(true);
    expect((r.data as { id: string }[])[0].id).toBe('all'); // status 被忽略
  });

  it('批量必填：任一非法即失败，且指向第一个出错的参数', async () => {
    const p = await providerOf();
    const r = await p.execute('lattice.addCheckpoint', {
      taskId: 't1',
      type: 'note',
      title: 42,
      message: 'm',
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('title');
  });

  it('参数合法时正常透传', async () => {
    const p = await providerOf();
    const r = await p.execute('lattice.search', { query: 'q', type: 'spec' });
    expect(r.success).toBe(true);
    expect((r.data as { title: string; snippet: string }[])[0]).toMatchObject({
      title: 'q',
      snippet: 'spec',
    });
  });
});
