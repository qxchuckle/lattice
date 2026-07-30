/**
 * AcpDriver 集成测试 — 用内联 mock ACP server（node -e）验证全链路
 *
 * 覆盖：init 握手 / connect / prompt 流式事件映射 / fork / 权限反向调用 / 进程退出容错
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAcpSource } from '../src/sources/acp/index.js';
import { defineSource } from '../src/define-source.js';
import { mapAcpUpdate } from '../src/sources/acp/event-map.js';

// ── mock ACP server 脚本（JSON-RPC over stdio） ──

const MOCK_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let sessionId = 'mock-session-1';

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
}
function notify(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\\n');
}

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  switch (msg.method) {
    case 'initialize':
      reply(msg.id, {
        protocolVersion: 1,
        agentInfo: { name: 'mock-agent', version: '2.0.0' },
        capabilities: {},
        configOptions: [{ category: 'model', options: [{ id: 'mock-model', name: 'Mock Model' }] }],
      });
      break;
    case 'session/new':
      reply(msg.id, { sessionId });
      break;
    case 'session/prompt': {
      // 模拟流式事件
      notify('session/update', { sessionId, update: { sessionUpdate: 'text_delta', text: 'Hello' } });
      notify('session/update', { sessionId, update: { sessionUpdate: 'text_delta', text: ' world' } });
      notify('session/update', { sessionId, update: { sessionUpdate: 'thinking_delta', text: 'hmm' } });
      notify('session/update', { sessionId, update: { sessionUpdate: 'tool_use', id: 'tc1', name: 'bash', input: { cmd: 'ls' } } });
      notify('session/update', { sessionId, update: { sessionUpdate: 'tool_result', id: 'tc1', name: 'bash', content: 'file.txt' } });
      reply(msg.id, { usage: { inputTokens: 10, outputTokens: 20 } });
      break;
    }
    case 'session/fork':
      reply(msg.id, { sessionId: 'forked-session-1' });
      break;
    default:
      reply(msg.id, {});
  }
});
`;

function createMockServerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'acp-test-'));
  const scriptPath = join(dir, 'mock-acp.js');
  writeFileSync(scriptPath, MOCK_SERVER);
  return scriptPath;
}

// ── 测试 ──

describe('AcpDriver 全链路', () => {
  it('init 握手 + listModels（从 configOptions 提取）', async () => {
    const script = createMockServerPath();
    const driver = createAcpSource({ command: 'node', args: [script], id: 'mock-acp' });
    const source = defineSource(driver);

    // init 触发 initialize 握手
    await source.init();
    const models = await source.listModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('mock-model');
    expect(models[0].displayName).toBe('Mock Model');

    await source.dispose();
  });

  it('prompt 流式事件映射：text/thinking/tool_call/tool_result', async () => {
    const script = createMockServerPath();
    const driver = createAcpSource({ command: 'node', args: [script], id: 'mock-acp' });
    const source = defineSource(driver);
    await source.init();

    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const events: Array<{ type: string }> = [];
    for await (const event of stream) {
      events.push(event);
    }
    const result = await stream.result();

    // 验证事件序列
    const types = events.map((e) => e.type);
    expect(types).toContain('text');
    expect(types).toContain('thinking');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('done'); // 工厂合成

    // 验证文本内容拼接
    const textEvents = events.filter((e) => e.type === 'text') as unknown as Array<{
      content: string;
    }>;
    expect(textEvents.map((e) => e.content).join('')).toBe('Hello world');

    // 验证 usage 回填
    expect(result.usage).toEqual({ input: 10, output: 20 });
    expect(result.sessionId).toBe('mock-session-1');

    await source.dispose();
  });

  it('fork：返回新 session ID', async () => {
    const script = createMockServerPath();
    const driver = createAcpSource({ command: 'node', args: [script], id: 'mock-acp' });
    const source = defineSource(driver);
    await source.init();

    // 先建会话
    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    for await (const _ of stream) {
      /* drain */
    }
    await stream.result();

    // fork
    const forkedId = await source.forkSession('mock-session-1');
    expect(forkedId).toBe('forked-session-1');

    await source.dispose();
  });

  it('能力声明：ACP 残缺面正确标注', () => {
    const driver = createAcpSource({ command: 'echo', id: 'test' });
    expect(driver.capabilities.prompt.systemPrompt.override).toBe(false);
    expect(driver.capabilities.context.compaction).toBe(false);
    expect(driver.capabilities.resources).toBe(false);
    expect(driver.capabilities.session.fork).toEqual({ atMessage: false });
    expect(driver.capabilities.execution.mode).toBe('delegated');
  });

  it('进程退出 → 在途请求立即 reject（不挂到超时）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-exit-'));
    const script = join(dir, 'exit-acp.js');
    writeFileSync(
      script,
      [
        "const rl = require('readline').createInterface({ input: process.stdin });",
        'rl.on("line", (line) => {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } }) + "\\n");',
        '    setTimeout(() => process.exit(0), 10);',
        '  }',
        '});',
      ].join('\n'),
    );
    const driver = createAcpSource({
      command: 'node',
      args: [script],
      id: 'exit-acp',
      timeoutMs: 5000,
    });
    const source = defineSource(driver);
    await source.init();

    // 等进程退出
    await new Promise((r) => setTimeout(r, 80));

    // 此时发 prompt 应立即报错（进程已死），而非挂 5s 超时
    const start = Date.now();
    await expect(source.prompt(null, [{ type: 'text', text: 'hi' }]).result()).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('mapAcpUpdate 单元', () => {
  it('text_delta → text 事件', () => {
    const event = mapAcpUpdate({ update: { sessionUpdate: 'text_delta', text: 'hi' } });
    expect(event).toEqual({ type: 'text', content: 'hi' });
  });

  it('空文本 → null（不产事件）', () => {
    expect(mapAcpUpdate({ update: { sessionUpdate: 'text_delta', text: '' } })).toBeNull();
  });

  it('error → error 事件（code 受检）', () => {
    const event = mapAcpUpdate({
      update: { sessionUpdate: 'error', message: 'boom', code: 'rate_limited' },
    });
    expect(event).toMatchObject({ type: 'error', code: 'rate_limited' });
  });

  it('未知 code → unknown', () => {
    const event = mapAcpUpdate({
      update: { sessionUpdate: 'error', message: 'x', code: 'weird_code' },
    });
    expect(event).toMatchObject({ type: 'error', code: 'unknown' });
  });

  it('未知变体 → null', () => {
    expect(mapAcpUpdate({ update: { sessionUpdate: 'some_future_thing' } })).toBeNull();
  });
});
