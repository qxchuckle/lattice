import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpAdapter } from '../src/adapters/http';
import { authStore, clearToken } from '../src/store';

// ── fetch 桩 ──

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(...queue: Response[]): { calls: FetchCall[]; fn: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return queue.length > 0 ? queue.shift()! : jsonResponse({});
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

let adapter: HttpAdapter;

beforeEach(() => {
  clearToken();
  adapter = new HttpAdapter();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

// ── 查询参数与路径编码 ──

describe('HttpAdapter 查询参数与路径', () => {
  it('项目/任务/spec/搜索：URL 参数与编码正确', async () => {
    const { calls } = stubFetch(
      jsonResponse([]), // projects
      jsonResponse([]), // tasks
      jsonResponse([]), // specs
      jsonResponse([]), // search
    );

    await adapter.getProjects('u 1');
    expect(calls[0].url).toBe('/api/projects?username=u%201');

    await adapter.getTasks({
      status: 'completed',
      projectId: 'legacy:p1',
      allUser: true,
      username: 'alice',
    });
    const taskUrl = decodeURIComponent(calls[1].url);
    expect(taskUrl).toContain('status=completed');
    expect(taskUrl).toContain('projectId=legacy:p1');
    expect(taskUrl).toContain('allUser=true');
    expect(taskUrl).toContain('username=alice');

    await adapter.getSpecs('project', 'legacy:p1', 'alice');
    const specUrl = decodeURIComponent(calls[2].url);
    expect(specUrl).toContain('scope=project');
    expect(specUrl).toContain('projectId=legacy:p1');
    expect(specUrl).toContain('username=alice');

    const signal = new AbortController().signal;
    await adapter.search('登录 bug', { type: 'task', projectId: 'p1', limit: 5, signal });
    const searchUrl = decodeURIComponent(calls[3].url);
    expect(searchUrl).toContain('q=登录+bug');
    expect(searchUrl).toContain('type=task');
    expect(searchUrl).toContain('projectId=p1');
    expect(searchUrl).toContain('limit=5');
    expect(calls[3].init?.signal).toBe(signal);
  });

  it('配置/垃圾桶/关系：可选参数省略时不拼 query', async () => {
    const { calls } = stubFetch(jsonResponse({}), jsonResponse([]), jsonResponse([]));
    await adapter.getConfig('global', true);
    expect(calls[0].url).toBe('/api/config?scope=global&diffDefaults=true');
    await adapter.getTrash();
    expect(calls[1].url).toBe('/api/trash');
    await adapter.getRelations('alice');
    expect(calls[2].url).toBe('/api/relations?username=alice');
  });
});

// ── 鉴权与错误语义 ──

describe('HttpAdapter 鉴权与错误语义', () => {
  it('有 token 时带 Bearer 头', async () => {
    authStore.token = 'tok-1';
    const { calls } = stubFetch(jsonResponse([]));
    await adapter.getProjects();
    expect(calls[0].init?.headers).toEqual({ Authorization: 'Bearer tok-1' });
  });

  it('401：清除 token 并抛 unauthorized（GET 与 POST 一致）', async () => {
    authStore.token = 'tok-2';
    stubFetch(jsonResponse({}, 401));
    await expect(adapter.getProjects()).rejects.toThrow('unauthorized');
    expect(authStore.token).toBeNull();

    authStore.token = 'tok-3';
    stubFetch(jsonResponse({}, 401));
    await expect(adapter.setConfig('a', 1, 'global')).rejects.toThrow('unauthorized');
    expect(authStore.token).toBeNull();
  });

  it('非 2xx：GET 抛 API 状态；POST 优先错误体 message，回退 HTTP 状态', async () => {
    stubFetch(jsonResponse({}, 500));
    await expect(adapter.getProjects()).rejects.toThrow('API 500: /api/projects');

    stubFetch(jsonResponse({ message: '磁盘只读' }, 403));
    await expect(adapter.openPath('task', 't1', 'default')).rejects.toThrow('磁盘只读');

    stubFetch({
      status: 502,
      ok: false,
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response);
    await expect(adapter.openPath('task', 't1', 'default')).rejects.toThrow('HTTP 502');
  });

  it('降级接口：失败时返回 null/[] 而非抛错', async () => {
    stubFetch(
      jsonResponse({}, 500),
      jsonResponse({}, 500),
      jsonResponse({}, 500),
      jsonResponse({ home: '/h' }), // 缺 pathSep → null
      jsonResponse({ path: '/p/x' }),
      jsonResponse({ paths: ['/a', '/b'] }),
    );
    await expect(adapter.getGlobalStatus()).resolves.toBeNull();
    await expect(adapter.getEntityPath('task', 't1')).resolves.toBeNull();
    await expect(adapter.getProjectLocalPaths('p1')).resolves.toEqual([]);
    await expect(adapter.getGlobalStatus()).resolves.toBeNull();
    await expect(adapter.getEntityPath('task', 't1')).resolves.toBe('/p/x');
    await expect(adapter.getProjectLocalPaths('p1')).resolves.toEqual(['/a', '/b']);
  });
});

// ── POST 与内容读写 ──

describe('HttpAdapter 内容与管理操作', () => {
  it('getContent：spec 走 POST，其余走 GET；saveContent/openPath 布尔结果', async () => {
    const { calls } = stubFetch(
      jsonResponse({ content: 'spec 正文' }),
      jsonResponse({ content: '文件正文' }),
      jsonResponse({ success: true }),
      jsonResponse({ success: false }),
    );
    await expect(adapter.getContent('spec', 'spec-aaaaaaaa')).resolves.toBe('spec 正文');
    expect(calls[0].url).toBe('/api/spec/content');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ specId: 'spec-aaaaaaaa' });

    await expect(adapter.getContent('task', 't1')).resolves.toBe('文件正文');
    expect(calls[1].url).toBe('/api/content/task/t1');

    await expect(adapter.saveContent('task', 't1', '新正文')).resolves.toBe(true);
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      type: 'task',
      entityId: 't1',
      content: '新正文',
    });

    await expect(adapter.openPath('task', 't1', 'vscode')).resolves.toBe(false);
  });

  it('任务管理/RAG/垃圾桶：success 映射布尔', async () => {
    const { calls } = stubFetch(
      jsonResponse({ success: true }),
      jsonResponse({ success: true }),
      jsonResponse({ success: true }),
      jsonResponse({ success: true }),
      jsonResponse({ indexedDocuments: 3 }),
      jsonResponse({ installed: true }),
      jsonResponse({ success: true }),
      jsonResponse({ success: true }),
      jsonResponse({ success: true }),
      jsonResponse({ count: 7 }),
    );

    await expect(adapter.updateTaskStatus('t1', 'completed')).resolves.toBe(true);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ status: 'completed' });

    await expect(adapter.archiveTask('t1')).resolves.toBe(true);
    await expect(adapter.deleteTask('t1')).resolves.toBe(true);

    await expect(adapter.addCheckpoint('t1', 'note', '标题', '正文')).resolves.toBe(true);
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({
      type: 'note',
      title: '标题',
      message: '正文',
    });

    await expect(adapter.getRagStatus()).resolves.toEqual({ indexedDocuments: 3 });
    await expect(adapter.getModelStatus()).resolves.toEqual({ installed: true });
    await expect(adapter.removeModel()).resolves.toBe(true);
    await expect(adapter.restoreTrash('trash-1')).resolves.toBe(true);
    await expect(adapter.purgeTrash('trash-1')).resolves.toBe(true);
    await expect(adapter.emptyTrash()).resolves.toEqual({ count: 7 });
  });

  it('配置写入/登录/鉴权：请求体与返回值透传', async () => {
    const { calls } = stubFetch(
      jsonResponse({ success: true }),
      jsonResponse({ success: true }),
      jsonResponse({ token: 'new-token', expiresIn: 3600 }),
      jsonResponse({ enabled: true }),
      jsonResponse({ success: true }),
      jsonResponse({ success: true }),
    );

    await expect(adapter.setConfig('rag.topK', 8, 'local')).resolves.toBe(true);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      key: 'rag.topK',
      value: 8,
      scope: 'local',
    });

    await expect(adapter.unsetConfig('rag.topK', 'local')).resolves.toBe(true);
    await expect(adapter.login('pwd', true)).resolves.toEqual({
      token: 'new-token',
      expiresIn: 3600,
    });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ password: 'pwd', remember: true });

    await expect(adapter.getAuthStatus()).resolves.toEqual({ enabled: true });
    await expect(adapter.changePassword(null)).resolves.toBe(true);
    await expect(adapter.logout()).resolves.toBe(true);
  });

  it('doctor 运行：POST 选项透传并返回报告', async () => {
    const { calls } = stubFetch(jsonResponse({ entries: [] }));
    await expect(adapter.runDoctor({ fix: true, migrate: true })).resolves.toEqual({ entries: [] });
    expect(calls[0].url).toBe('/api/doctor/run');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ fix: true, migrate: true });
  });

  it('无 body 的 POST：不设置 Content-Type/body', async () => {
    const { calls } = stubFetch(jsonResponse({ success: true }));
    await adapter.archiveTask('t1');
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[0].init?.headers).toEqual({});
  });
});
