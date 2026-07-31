/**
 * ClientMessage zod schema 行为契约（/schemas 子出口）
 *
 * parse, don't validate：WS 入站命令的唯一入口守卫。
 * 原 web/ws-commands.validateCommonFields 的全部拒绝场景迁移至此（单一来源），
 * 并补齐旧手写守卫做不到的：类型不符拒绝、缺必填拒绝、嵌套对象/数组递归校验。
 * 校验语义为 check-only：safeParse 判定形状，通过后继续使用原对象（未知键透传）。
 */
import { describe, it, expect } from 'vitest';
import type { ClientMessage } from '../src/index.js';
import { clientMessageSchema } from '../src/schemas.js';

/** 各消息类型的最小合法样例（编译期同时钉住 schema 与 TS 类型不漂移） */
const VALID_MESSAGES: ClientMessage[] = [
  { type: 'session.create' },
  { type: 'session.create', agentId: 'qoder', cwd: '/tmp/x', taskId: 't1', treeId: 'tree-1' },
  { type: 'session.send', sessionId: 's1', message: 'hello' },
  {
    type: 'session.send',
    sessionId: 's1',
    message: 'hi',
    segments: [
      { type: 'text', text: 'hi' },
      { type: 'command', name: 'plan', args: 'do it' },
      { type: 'image', data: 'aGk=', mimeType: 'image/png', name: 'a.png' },
      { type: 'ref', refType: 'spec', id: 'spec-1', display: 'Spec 1' },
      { type: 'inline-ref', refType: 'selection', display: 'sel', content: 'code' },
    ],
    parentNodeId: null,
    branchId: 'b1',
    requestId: 'r1',
    model: 'm1',
    thinkingLevel: 'high',
    contextWindow: 200000,
    sourceId: 'qoder',
  },
  { type: 'session.continue', sessionId: 's1', nodeId: 'n1', requestId: 'r1' },
  { type: 'session.retry', sessionId: 's1', nodeId: 'n1' },
  { type: 'session.undo', sessionId: 's1', nodeId: 'n1' },
  { type: 'session.delete', sessionId: 's1', nodeId: 'n1' },
  { type: 'session.abort', sessionId: 's1', requestId: 'r1' },
  { type: 'session.destroy', sessionId: 's1' },
  { type: 'tree.fork', treeId: 't1', nodeId: 'n1', branchName: 'alt' },
  { type: 'tree.delete', treeId: 't1', nodeIds: ['n1', 'n2'] },
  { type: 'tree.merge', treeId: 't1', branchId: 'b1', targetNodeId: 'n1', mode: 'squash' },
  { type: 'tree.switchHead', treeId: 't1', nodeId: 'n1' },
  { type: 'tree.setDefault', treeId: 't1', branchId: 'b1' },
  { type: 'permission.respond', requestId: 'r1', allowed: true },
  { type: 'tree.subscribe', treeId: 't1', sinceRev: 3, clientKind: 'web' },
  { type: 'tree.unsubscribe', treeId: 't1' },
  { type: 'presence.update', treeId: 't1', focusNodeId: null, typing: true },
  { type: 'ping' },
];

/** 便捷断言：拒绝且首条 issue 的定位信息包含指定字段名 */
function expectReject(msg: unknown, field: string): void {
  const r = clientMessageSchema.safeParse(msg);
  expect(r.success, `应拒绝：${JSON.stringify(msg).slice(0, 120)}`).toBe(false);
  if (!r.success) {
    const issue = r.error.issues[0];
    const detail = `${issue.path.join('.')}: ${issue.message}`;
    expect(detail).toContain(field);
  }
}

describe('clientMessageSchema：合法消息全类型通过', () => {
  it.each(VALID_MESSAGES.map((m) => [m.type, m] as const))('%s 通过', (_type, msg) => {
    expect(clientMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('check-only 语义：未知键不导致拒绝，判定通过后原对象可继续使用（扩展字段透传）', () => {
    const msg = { type: 'ping', vendorExt: { a: 1 } };
    expect(clientMessageSchema.safeParse(msg).success).toBe(true);
    expect(msg.vendorExt.a).toBe(1); // 原对象未被替换/剥离
  });
});

describe('clientMessageSchema：长度/数量上限（迁移自 validateCommonFields，拒绝场景全保留）', () => {
  const long = (n: number): string => 'x'.repeat(n);

  it('treeId > 256 拒绝', () => {
    expectReject({ type: 'session.create', treeId: long(257) }, 'treeId');
  });

  it('sessionId > 256 拒绝', () => {
    expectReject({ type: 'session.send', sessionId: long(257), message: 'hi' }, 'sessionId');
  });

  it('branchId > 256 拒绝', () => {
    expectReject({ type: 'tree.setDefault', treeId: 't1', branchId: long(257) }, 'branchId');
  });

  it('branchName > 256 拒绝', () => {
    expectReject(
      { type: 'tree.fork', treeId: 't1', nodeId: 'n1', branchName: long(257) },
      'branchName',
    );
  });

  it('nodeId > 256 拒绝', () => {
    expectReject({ type: 'session.undo', sessionId: 's1', nodeId: long(257) }, 'nodeId');
  });

  it('nodeIds 单元素 > 256 拒绝', () => {
    expectReject({ type: 'tree.delete', treeId: 't1', nodeIds: ['ok', long(257)] }, 'nodeIds');
  });

  it('nodeIds 数量 > 1000 拒绝', () => {
    const many = Array.from({ length: 1001 }, (_, i) => `n${i}`);
    expectReject({ type: 'tree.delete', treeId: 't1', nodeIds: many }, 'nodeIds');
  });

  it('nodeIds 恰好 1000 个通过（边界）', () => {
    const exact = Array.from({ length: 1000 }, (_, i) => `n${i}`);
    expect(
      clientMessageSchema.safeParse({ type: 'tree.delete', treeId: 't1', nodeIds: exact }).success,
    ).toBe(true);
  });

  it('message > 200_000 拒绝；恰好 200_000 通过（边界）', () => {
    expectReject({ type: 'session.send', sessionId: 's1', message: long(200_001) }, 'message');
    expect(
      clientMessageSchema.safeParse({
        type: 'session.send',
        sessionId: 's1',
        message: long(200_000),
      }).success,
    ).toBe(true);
  });

  it('targetNodeId > 256 拒绝（旧守卫遗漏的 ID 字段也设限）', () => {
    expectReject(
      { type: 'tree.merge', treeId: 't1', branchId: 'b1', targetNodeId: long(257) },
      'targetNodeId',
    );
  });
});

describe("clientMessageSchema：类型不符与缺必填（parse, don't validate——入口即拒，不再留给业务守卫）", () => {
  it('treeId 非 string（number/null）拒绝', () => {
    expectReject({ type: 'session.create', treeId: 12345 }, 'treeId');
    expectReject({ type: 'session.create', treeId: null }, 'treeId');
  });

  it('session.send 缺 sessionId / 缺 message 拒绝', () => {
    expectReject({ type: 'session.send', message: 'hi' }, 'sessionId');
    expectReject({ type: 'session.send', sessionId: 's1' }, 'message');
  });

  it('permission.respond 缺 requestId / allowed 非 boolean 拒绝', () => {
    expectReject({ type: 'permission.respond', allowed: true }, 'requestId');
    expectReject({ type: 'permission.respond', requestId: 'r1', allowed: 'yes' }, 'allowed');
  });

  it('nodeIds 非数组拒绝', () => {
    expectReject({ type: 'tree.delete', treeId: 't1', nodeIds: 'n1' }, 'nodeIds');
  });

  it('tree.merge mode 非法枚举拒绝', () => {
    expectReject(
      { type: 'tree.merge', treeId: 't1', branchId: 'b1', targetNodeId: 'n1', mode: 'rebase' },
      'mode',
    );
  });

  it('未知 type 拒绝', () => {
    expect(clientMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({}).success).toBe(false);
    expect(clientMessageSchema.safeParse(null).success).toBe(false);
  });
});

describe('clientMessageSchema：嵌套 segments 递归校验', () => {
  const base = { type: 'session.send', sessionId: 's1', message: 'hi' } as const;

  it('未知段 type 拒绝', () => {
    expectReject({ ...base, segments: [{ type: 'bogus', text: 'x' }] }, 'segments');
  });

  it('段内字段类型不符拒绝（text.text 非 string）', () => {
    expectReject({ ...base, segments: [{ type: 'text', text: 42 }] }, 'segments');
  });

  it('inline-ref content 超长拒绝（嵌套自由文本同样有上限）', () => {
    expectReject(
      {
        ...base,
        segments: [
          { type: 'inline-ref', refType: 'selection', display: 's', content: 'x'.repeat(200_001) },
        ],
      },
      'segments',
    );
  });

  it('ref.refType 非法枚举拒绝', () => {
    expectReject(
      { ...base, segments: [{ type: 'ref', refType: 'url', id: 'a', display: 'a' }] },
      'segments',
    );
  });

  it('segments 数量 > 1000 拒绝（数组防资源耗尽）', () => {
    const many = Array.from({ length: 1001 }, () => ({ type: 'text', text: 'a' }));
    expectReject({ ...base, segments: many }, 'segments');
  });
});
