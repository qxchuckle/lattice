// spec: specs/rest-api-and-page-shell.md
// seed: tests/seed.spec.ts
//
// 由 Playwright Test Generator 工作流生成（自然语言计划 → 静态代码，commit 模式）。
// CI 纯执行：playwright test 直接运行，无需 LLM。
// 覆盖一期未触及的 REST 查询端点冒烟（sources/models/conversations/health）。
import { test, expect } from '@playwright/test';

interface ApiEnvelope<T> {
  code: string;
  data: T;
}

test.describe('REST 查询端点冒烟', () => {
  test('health 端点返回 ok', async ({ request }) => {
    // 1. GET /health
    const res = await request.get('/health');
    // Expected: 响应 200，body.status === 'ok'
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  test('sources 端点暴露 mock 源且可用', async ({ request }) => {
    // 1. GET /api/agent/sources
    const res = await request.get('/api/agent/sources');
    // Expected: 响应 200，body.code === 'ok'
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as ApiEnvelope<{
      sources: Array<{ id: string; available: boolean; modelPolicy: string }>;
    }>;
    expect(body.code).toBe('ok');
    // body.data.sources 数组长度 >= 1
    expect(body.data.sources.length).toBeGreaterThanOrEqual(1);
    // 存在 id === 'mock' 的源，available === true，modelPolicy === 'open'
    const mock = body.data.sources.find((s) => s.id === 'mock');
    expect(mock).toBeTruthy();
    expect(mock?.available).toBe(true);
    expect(mock?.modelPolicy).toBe('open');
  });

  test('models 端点暴露 mock-model 且支持 streaming', async ({ request }) => {
    // 1. GET /api/agent/models
    const res = await request.get('/api/agent/models');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as ApiEnvelope<{
      models: Array<{ id: string; capabilities: { streaming: boolean } }>;
    }>;
    expect(body.code).toBe('ok');
    // body.data.models 数组中存在 id === 'mock-model' 的模型
    const mockModel = body.data.models.find((m) => m.id === 'mock-model');
    expect(mockModel).toBeTruthy();
    // 该模型 capabilities.streaming === true
    expect(mockModel?.capabilities.streaming).toBe(true);
  });

  test('conversations 端点返回数组', async ({ request }) => {
    // 1. GET /api/agent/conversations
    const res = await request.get('/api/agent/conversations');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as ApiEnvelope<{ conversations: unknown[] }>;
    expect(body.code).toBe('ok');
    // body.data.conversations 为数组（Array.isArray）
    expect(Array.isArray(body.data.conversations)).toBeTruthy();
  });
});
