// @vitest-environment node
/**
 * /api/tasks/:id/status 路由的状态机契约测试
 *
 * web 测试环境把 @qcqx/lattice-core alias 到 core 浏览器入口（不含任务读写与 fsm），
 * 故整体 vi.mock 该模块：fsm 两个纯函数透传真实实现（保持与领域单一真相一致），
 * 数据读写（getUsername / getTaskMeta / updateTask）用受控 stub，Fastify 实例
 * 不 listen，经 app.inject 走完整路由链路。
 *
 * 注意：当前 TASK_TRANSITIONS 为全连通矩阵（见 core/src/task/fsm.ts 注释），
 * 真实 fsm 下「非法转换」分支不可达；用例②用 mockReturnValueOnce(false) 模拟
 * 未来收紧后的状态机否决，验证路由对 fsm 裁决的契约（200 + bad_request envelope + 不落库）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  getTaskMeta,
  updateTask,
  canTransitionTaskStatus,
  type TaskMeta,
} from '@qcqx/lattice-core';
import { registerTaskManagementRoutes } from './task-management';

vi.mock('@qcqx/lattice-core', async () => {
  // 真实 fsm（纯函数、零依赖）：状态值校验与转换表不 mock，契约与 core 同源
  const fsm = await vi.importActual<typeof import('../../../../core/src/task/fsm')>(
    '../../../../core/src/task/fsm',
  );
  return {
    getUsername: vi.fn(async () => 'tester'),
    getTaskMeta: vi.fn(async () => null),
    updateTask: vi.fn(async () => {}),
    archiveTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    addCheckpoint: vi.fn(async () => {}),
    createTask: vi.fn(async () => ({})),
    isValidTaskStatus: vi.fn(fsm.isValidTaskStatus),
    canTransitionTaskStatus: vi.fn(fsm.canTransitionTaskStatus),
  };
});

const mockedGetTaskMeta = vi.mocked(getTaskMeta);
const mockedUpdateTask = vi.mocked(updateTask);
const mockedCanTransition = vi.mocked(canTransitionTaskStatus);

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify();
  registerTaskManagementRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const postStatus = (status: string) =>
  app.inject({ method: 'POST', url: '/api/tasks/task-1/status', payload: { status } });

describe('POST /api/tasks/:id/status 状态机契约', () => {
  it('非法状态值（done）：isValidTaskStatus 拦截，返回 bad_request envelope 且不查库不落库', async () => {
    const res = await postStatus('done');
    // 业务错误统一返回 200 + envelope
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ code: 'bad_request', message: '无效的状态: done' });
    // 值校验失败即短路：不读任务元数据、不进状态机、不落库
    expect(mockedGetTaskMeta).not.toHaveBeenCalled();
    expect(mockedCanTransition).not.toHaveBeenCalled();
    expect(mockedUpdateTask).not.toHaveBeenCalled();
  });

  it('非法状态转换：canTransitionTaskStatus 否决 → 200 + bad_request envelope，不落库', async () => {
    mockedGetTaskMeta.mockResolvedValueOnce({ status: 'completed' } as unknown as TaskMeta);
    // 真实转换表当前全连通，此分支不可达；模拟 fsm 否决验证路由契约
    mockedCanTransition.mockReturnValueOnce(false);

    const res = await postStatus('planning');
    // 业务错误统一返回 200 + envelope（不再使用 HTTP 400）
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      code: 'bad_request',
      message: '无效的状态转换: completed -> planning',
    });
    expect(mockedCanTransition).toHaveBeenCalledWith('completed', 'planning');
    expect(mockedUpdateTask).not.toHaveBeenCalled();
  });

  it('合法转换（planning -> in_progress）：真实 fsm 放行，落库并返回 success', async () => {
    mockedGetTaskMeta.mockResolvedValueOnce({ status: 'planning' } as unknown as TaskMeta);

    const res = await postStatus('in_progress');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ code: 'ok' });
    expect(mockedCanTransition).toHaveBeenCalledWith('planning', 'in_progress');
    expect(mockedUpdateTask).toHaveBeenCalledWith('tester', 'task-1', { status: 'in_progress' });
  });

  it('任务不存在（meta 为 null）：跳过转换校验，交给 updateTask 按原逻辑处理', async () => {
    mockedGetTaskMeta.mockResolvedValueOnce(null);

    const res = await postStatus('completed');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ code: 'ok' });
    expect(mockedCanTransition).not.toHaveBeenCalled();
    expect(mockedUpdateTask).toHaveBeenCalledWith('tester', 'task-1', { status: 'completed' });
  });
});
