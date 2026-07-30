/**
 * AcpDriver 集成测试 — 用内联 mock ACP server（node -e）验证全链路
 *
 * 覆盖：init 握手 / connect / prompt 流式事件映射 / fork / 权限反向调用 / 进程退出容错
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
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
  // 把收到的方法名写到 stderr（测试可断言 agent 确实收到了 cancel 等）
  process.stderr.write('METHOD:' + msg.method + '\\n');
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
    case 'session/load':
      reply(msg.id, {});
      break;
    case 'session/cancel':
      // 通知无需应答；写标记文件供测试断言 agent 确实收到了 cancel
      if (process.env.CANCEL_MARKER) {
        require('fs').writeFileSync(process.env.CANCEL_MARKER, msg.params.sessionId);
      }
      break;
    case 'session/prompt': {
      // 模拟流式事件（SDK 校验格式：content 必须是 ContentBlock 对象）
      notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' }, messageId: 'm1' } });
      notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' }, messageId: 'm1' } });
      notify('session/update', { sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' }, messageId: 'm2' } });
      // stopReason 可由 env 注入（测试 max_tokens/refusal 等提前终止场景）
      reply(msg.id, {
        usage: { inputTokens: 10, outputTokens: 20 },
        stopReason: process.env.STOP_REASON || 'end_turn',
      });
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

    // 验证事件序列（SDK 格式：text/thinking + 工厂合成 done）
    const types = events.map((e) => e.type);
    expect(types).toContain('text');
    expect(types).toContain('thinking');
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

describe('R4.3 协议完整度', () => {
  it('abort → agent 确实收到 session/cancel（不只停本地路由）', async () => {
    const script = createMockServerPath();
    const marker = join(mkdtempSync(join(tmpdir(), 'acp-cancel-')), 'cancelled.txt');
    const driver = createAcpSource({
      command: 'node',
      args: [script],
      id: 'cancel-acp',
      env: { CANCEL_MARKER: marker },
    });
    const source = defineSource(driver);
    await source.init();

    const ctrl = new AbortController();
    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }], { signal: ctrl.signal });
    for await (const _ of stream) {
      ctrl.abort(); // 首事件到达即中止
      break;
    }
    await stream.result().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));

    // 关键断言：mock agent 写下了标记 ⇒ 确实收到 session/cancel
    expect(existsSync(marker), 'agent 应收到 session/cancel（否则他会继续烧 token）').toBe(true);
    await source.dispose();
  });

  it('checkAuth 读 initialize 的 authMethods：非空 → missing + 可读文案', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-auth-'));
    const script = join(dir, 'auth-acp.js');
    writeFileSync(
      script,
      [
        "const rl = require('readline').createInterface({ input: process.stdin });",
        'rl.on("line", (line) => {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, authMethods: [{ id: "oauth", name: "OAuth-Login" }] } }) + "\\n");',
        '  }',
        '});',
      ].join('\n'),
    );
    const driver = createAcpSource({ command: 'node', args: [script], id: 'auth-acp' });
    const source = defineSource(driver);
    await source.init();

    const auth = await source.checkAuth();
    expect(auth.status).toBe('missing');
    // 判别联合收窄后读 message
    if (auth.status !== 'configured') {
      expect(auth.message).toContain('认证');
      expect(auth.message).toContain('OAuth-Login');
    }

    await source.dispose();
  });

  it('checkAuth 无 authMethods → configured', async () => {
    const script = createMockServerPath();
    const driver = createAcpSource({ command: 'node', args: [script], id: 'noauth-acp' });
    const source = defineSource(driver);
    await source.init();
    expect((await source.checkAuth()).status).toBe('configured');
    await source.dispose();
  });

  it('恢复会话：传入 sessionId 时走 session/load（而非直接新建）', async () => {
    const script = createMockServerPath();
    const marker = join(mkdtempSync(join(tmpdir(), 'acp-load-')), 'loaded.txt');
    const driver = createAcpSource({
      command: 'node',
      args: [script],
      id: 'load-acp',
      env: { LOAD_MARKER: marker },
    });
    const source = defineSource(driver);
    await source.init();

    // 传已知 sessionId → driver 应先发 session/load
    const stream = source.prompt('mock-session-1', [{ type: 'text', text: 'hi' }]);
    for await (const _ of stream) {
      /* drain */
    }
    const result = await stream.result();
    expect(result.sessionId).toBe('mock-session-1'); // 恢复的会话 ID 保持
    await source.dispose();
  });

  it('进程启动失败（命令不存在）→ 报错而非卡住', async () => {
    const driver = createAcpSource({ command: 'definitely-not-a-real-cmd-xyz', id: 'bad' });
    const source = defineSource(driver);
    const start = Date.now();
    await expect(source.init()).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(5000);
  });

  // ── stopReason 处理（源不静默降级） ──

  it('stopReason=end_turn → 无 notice（正常完成不扰民）', async () => {
    const script = createMockServerPath();
    const driver = createAcpSource({ command: 'node', args: [script], id: 'stop-ok' });
    const source = defineSource(driver);
    await source.init();

    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const events: Array<{ type: string }> = [];
    for await (const e of stream) events.push(e);
    await stream.result();

    expect(events.filter((e) => e.type === 'notice')).toHaveLength(0);
    await source.dispose();
  });

  it.each([
    ['max_tokens', /token/],
    ['max_turn_requests', /请求次数/],
    ['refusal', /拒绝/],
  ])('stopReason=%s → 发 warning notice（用户不会误以为回答完整）', async (reason, pattern) => {
    const script = createMockServerPath();
    const driver = createAcpSource({
      command: 'node',
      args: [script],
      id: `stop-${reason}`,
      env: { STOP_REASON: reason },
    });
    const source = defineSource(driver);
    await source.init();

    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const events: Array<{ type: string; level?: string; message?: string }> = [];
    for await (const e of stream) events.push(e);
    await stream.result();

    const notices = events.filter((e) => e.type === 'notice');
    expect(notices, `stopReason=${reason} 应发 notice`).toHaveLength(1);
    expect(notices[0].level).toBe('warning');
    expect(notices[0].message).toMatch(pattern);
    await source.dispose();
  });

  it('未知 stopReason → 仍发 notice（兼容协议演进，不静默吃掉）', async () => {
    const script = createMockServerPath();
    const driver = createAcpSource({
      command: 'node',
      args: [script],
      id: 'stop-future',
      env: { STOP_REASON: 'some_future_reason' },
    });
    const source = defineSource(driver);
    await source.init();

    const stream = source.prompt(null, [{ type: 'text', text: 'hi' }]);
    const events: Array<{ type: string; message?: string }> = [];
    for await (const e of stream) events.push(e);
    await stream.result();

    const notices = events.filter((e) => e.type === 'notice');
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain('some_future_reason'); // 兜底文案带上原始值
    await source.dispose();
  });
});

describe('能力握手降准（ACP：未声明 = 不支持）', () => {
  /** 造一个只按需声明能力的 mock agent */
  function serverWithCaps(caps: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'acp-caps-'));
    const script = join(dir, 'caps-acp.js');
    writeFileSync(
      script,
      [
        "const rl = require('readline').createInterface({ input: process.stdin });",
        'rl.on("line", (line) => {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        `    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: ${caps} } }) + "\\n");`,
        '  } else if (msg.method === "session/new") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } }) + "\\n");',
        '  } else if (msg.method === "session/prompt") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");',
        '  } else if (msg.id !== undefined) {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");',
        '  }',
        '});',
      ].join('\n'),
    );
    return script;
  }

  it('agent 不声明能力 → resume/images 双降准并留痕', async () => {
    const driver = createAcpSource({
      command: 'node',
      args: [serverWithCaps('{}')],
      id: 'caps-none',
    });
    const source = defineSource(driver);
    await source.init();

    const report = await driver.probe!();
    const paths = report.overrides!.map((o) => o.path);
    expect(paths).toContain('session.resume');
    expect(paths).toContain('prompt.images');
    expect(
      report.overrides!.every((o) => o.reason.length > 0),
      '降准理由必可读',
    ).toBe(true);

    await source.dispose();
  });

  it('agent 声明 image → 图片不降准；resume 仍降准（SDK 无重建 ActiveSession 入口）', async () => {
    const driver = createAcpSource({
      command: 'node',
      args: [serverWithCaps('{ "loadSession": true, "promptCapabilities": { "image": true } }')],
      id: 'caps-full',
    });
    const source = defineSource(driver);
    await source.init();

    const report = await driver.probe!();
    const paths = report.overrides!.map((o) => o.path);
    expect(paths, 'image 已声明 → 不应降准').not.toContain('prompt.images');
    // resume 一律降准：声明与实现保持一致（不声明自己做不到的事）
    expect(paths).toContain('session.resume');
    const resumeOverride = report.overrides!.find((o) => o.path === 'session.resume');
    expect(resumeOverride!.reason, '理由应说明是 SDK 入口缺口而非 agent 不支持').toContain('SDK');

    await source.dispose();
  });

  it('图片能力未声明 → 丢图但发 notice（不静默降级）', async () => {
    const driver = createAcpSource({
      command: 'node',
      args: [serverWithCaps('{}')],
      id: 'noimg',
    });
    const source = defineSource(driver);
    await source.init();

    const stream = source.prompt(null, [
      { type: 'text', text: '看图' },
      { type: 'image', data: 'BASE64', mimeType: 'image/png' },
    ]);
    const events: Array<{ type: string; message?: string }> = [];
    for await (const e of stream) events.push(e);
    await stream.result();

    const notices = events.filter((e) => e.type === 'notice');
    expect(notices, '丢图必须告知用户').toHaveLength(1);
    expect(notices[0].message).toContain('图片');

    await source.dispose();
  });

  it('协议版本不匹配 → 关连接并报错（协议 MUST）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-ver-'));
    const script = join(dir, 'ver-acp.js');
    writeFileSync(
      script,
      [
        "const rl = require('readline').createInterface({ input: process.stdin });",
        'rl.on("line", (line) => {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 99 } }) + "\\n");',
        '  }',
        '});',
      ].join('\n'),
    );
    const driver = createAcpSource({ command: 'node', args: [script], id: 'ver-mismatch' });
    const source = defineSource(driver);
    await expect(source.init()).rejects.toThrow(/版本不匹配/);
  });
});

describe('lattice 跨分支并行边界', () => {
  /** 每轮 prompt 都向 client 发一次 request_permission，并回传它收到的 optionId */
  function permissionServer(): string {
    const dir = mkdtempSync(join(tmpdir(), 'acp-perm-'));
    const script = join(dir, 'perm-acp.js');
    writeFileSync(
      script,
      [
        "const rl = require('readline').createInterface({ input: process.stdin });",
        'let seq = 0;',
        'let reqSeq = 0;',
        'const pending = new Map();',
        'rl.on("line", (line) => {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } }) + "\\n");',
        '  } else if (msg.method === "session/new") {',
        '    seq++;',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "sess-" + seq } }) + "\\n");',
        '  } else if (msg.method === "session/prompt") {',
        '    const sid = msg.params.sessionId;',
        '    // 向 client 反向请求权限（带上自己的 sessionId）',
        '    const reqId = 9000 + ++reqSeq;',
        '    pending.set(reqId, { promptId: msg.id, sid });',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: reqId, method: "session/request_permission", params: { sessionId: sid, toolCall: { toolCallId: "tc1", title: "run bash" }, options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }, { optionId: "no", name: "Reject", kind: "reject_once" }] } }) + "\\n");',
        '  } else if (msg.id !== undefined && msg.result && msg.result.outcome) {',
        '    // client 应答了权限：把 optionId 当文本发回，再结束该轮',
        '    const info = pending.get(msg.id);',
        '    if (info) {',
        '      pending.delete(msg.id);',
        '      const optionId = msg.result.outcome.optionId || msg.result.outcome.outcome;',
        '      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: info.sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "decision:" + optionId }, messageId: "m" } } }) + "\\n");',
        '      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: info.promptId, result: { stopReason: "end_turn" } }) + "\\n");',
        '    }',
        '  }',
        '});',
      ].join('\n'),
    );
    return script;
  }

  it('两个会话并行时权限回调不串台（per-session 隔离）', async () => {
    const driver = createAcpSource({ command: 'node', args: [permissionServer()], id: 'perm' });
    const source = defineSource(driver);
    await source.init();

    // 两个并行轮次：A 授权、B 拒绝——若 handler 串台，两边会拿到同一个决定
    const collect = async (allow: boolean): Promise<string> => {
      const stream = source.prompt(null, [{ type: 'text', text: 'go' }], {
        onPermissionRequest: async () => ({ behavior: allow ? 'allow' : 'deny', scope: 'once' }),
      });
      let text = '';
      for await (const e of stream) {
        if (e.type === 'text') text += e.content;
      }
      await stream.result();
      return text;
    };

    const [a, b] = await Promise.all([collect(true), collect(false)]);
    // mock agent 的 optionId 是 yes/no（故意与 allow/reject 不同名，
    // 验证 driver 是按 kind 从 options 里选而非硬编码字符串）
    expect(a, '授权侧应选中 allow_once 对应的 optionId').toContain('yes');
    expect(b, '拒绝侧应选中 reject_once 对应的 optionId').toContain('no');

    await source.dispose();
  });

  it('一个会话结束不影响另一个在途会话的权限通道', async () => {
    const driver = createAcpSource({ command: 'node', args: [permissionServer()], id: 'perm2' });
    const source = defineSource(driver);
    await source.init();

    // 先跑完一轮（其 finally 会清自己的 handler）
    const first = source.prompt(null, [{ type: 'text', text: 'first' }], {
      onPermissionRequest: async () => ({ behavior: 'allow', scope: 'once' }),
    });
    for await (const _ of first) {
      /* drain */
    }
    await first.result();

    // 再跑一轮：若上一轮的 finally 清掉了全局 handler，这轮会 fallback 拒绝
    const second = source.prompt(null, [{ type: 'text', text: 'second' }], {
      onPermissionRequest: async () => ({ behavior: 'allow', scope: 'once' }),
    });
    let text = '';
    for await (const e of second) {
      if (e.type === 'text') text += e.content;
    }
    await second.result();
    expect(text, '第二轮应仍能拿到自己的授权结果').toContain('yes');

    await source.dispose();
  });
});

describe('mapAcpUpdate 单元', () => {
  it('text_delta → text 事件', () => {
    const event = mapAcpUpdate({
      update: { sessionUpdate: 'agent_message_chunk', content: 'hi' },
    } as never);
    expect(event).toEqual({ type: 'text', content: 'hi' });
  });

  it('空文本 → null（不产事件）', () => {
    expect(
      mapAcpUpdate({ update: { sessionUpdate: 'agent_message_chunk', content: '' } } as never),
    ).toBeNull();
  });

  it('error → error 事件（code 受检）', () => {
    const event = mapAcpUpdate({
      update: { sessionUpdate: 'error', message: 'boom', code: 'rate_limited' },
    } as never);
    expect(event).toMatchObject({ type: 'error', code: 'rate_limited' });
  });

  it('未知 code → unknown', () => {
    const event = mapAcpUpdate({
      update: { sessionUpdate: 'error', message: 'x', code: 'weird_code' },
    } as never);
    expect(event).toMatchObject({ type: 'error', code: 'unknown' });
  });

  it('未知变体 → null', () => {
    expect(mapAcpUpdate({ update: { sessionUpdate: 'some_future_thing' } } as never)).toBeNull();
  });
});
