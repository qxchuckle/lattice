# REST API 与页面壳冒烟测试计划

> 由 Playwright Test Planner 工作流产出（自然语言 → Generator 生成静态代码）。
> 一期 6 个测试聚焦 WS 协议层（presence/session/tree/permission/recovery），
> 本计划补齐一期未覆盖的 **REST 查询端点** 与 **页面壳同源可达性** 两个面。

## 应用概述

E2E 服务器（`fixtures/server-setup.ts` 启动）在 `http://localhost:14530` 暴露：

- `GET /health` — 健康检查，返回 `{ "status": "ok" }`
- `GET /api/agent/sources` — 可用源列表（mock 源 `id="mock"`，`available=true`）
- `GET /api/agent/models` — 模型列表（mock 源提供 `mock-model`，streaming=true）
- `GET /api/agent/conversations` — 历史会话列表（数组，初始可为空）
- `GET /` — 页面壳：web 客户端构建（若存在）或最小 HTML 占位页

## 测试场景

### 1. REST 查询端点冒烟

**Seed:** `tests/seed.spec.ts`

#### 1.1 health 端点返回 ok

**Steps:**
1. `GET /health`

**Expected:**
- 响应 200
- body.status === 'ok'

#### 1.2 sources 端点暴露 mock 源且可用

**Steps:**
1. `GET /api/agent/sources`

**Expected:**
- 响应 200，body.code === 'ok'
- body.data.sources 数组长度 >= 1
- 存在 id === 'mock' 的源，available === true，modelPolicy === 'open'

#### 1.3 models 端点暴露 mock-model 且支持 streaming

**Steps:**
1. `GET /api/agent/models`

**Expected:**
- 响应 200，body.code === 'ok'
- body.data.models 数组中存在 id === 'mock-model' 的模型
- 该模型 capabilities.streaming === true

#### 1.4 conversations 端点返回数组

**Steps:**
1. `GET /api/agent/conversations`

**Expected:**
- 响应 200，body.code === 'ok'
- body.data.conversations 为数组（Array.isArray）

### 2. 页面壳同源可达性

**Seed:** `tests/seed.spec.ts`

#### 2.1 baseURL 加载页面壳且同源 REST 可达

**Steps:**
1. `page.goto('/')`
2. 在浏览器上下文 `fetch('/health')`（同源请求）

**Expected:**
- 页面加载不抛错（响应 200）
- 同源 fetch `/health` 返回 res.ok() 且 body.status === 'ok'
