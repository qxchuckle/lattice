/**
 * SDK fork × compaction 契约测试（由 .temp-docs/compaction-probe 探针转正）
 *
 * 验证"压缩后任意节点分支继承天然正确"的核心论证依赖的两个 SDK 行为：
 *   - Qoder forkSession 跨 compact_boundary 切片（按文件顺序，UUID 重映射）
 *   - Pi createBranchedSession 对压缩前/压缩条目/压缩后三类 fork 点的处理
 *
 * 环境守卫：pi 包在 node < 22 因 undici 8.5 的 markAsUncloneable bug 无法加载，
 * 该部分自动 skip（node >= 22 或 undici 修复后自动恢复回归）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── Qoder：QODER_CONFIG_DIR 逃生口 + 构造 CC 磁盘格式 JSONL ──

describe('Qoder forkSession × compact_boundary', () => {
  let configDir: string;
  let sdk: typeof import('@qoder-ai/qoder-agent-sdk');
  const sessionId = randomUUID();
  const cwd = process.cwd();
  const ids = {
    u1: randomUUID(),
    a1: randomUUID(),
    a2: randomUUID(),
    cb: randomUUID(),
    u3: randomUUID(),
    a3: randomUUID(),
  };

  const base = (uuid: string, parentUuid: string | null) => ({
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd,
    sessionId,
    version: '2.1.11',
    gitBranch: '',
    uuid,
    timestamp: new Date().toISOString(),
  });
  const userMsg = (uuid: string, parentUuid: string | null, text: string) => ({
    ...base(uuid, parentUuid),
    type: 'user',
    message: { role: 'user', content: text },
  });
  const asstMsg = (uuid: string, parentUuid: string, text: string) => ({
    ...base(uuid, parentUuid),
    type: 'assistant',
    message: {
      id: `msg_${uuid.slice(0, 8)}`,
      role: 'assistant',
      model: 'test',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'qoder-fork-test-'));
    process.env.QODER_CONFIG_DIR = configDir;
    sdk = await import('@qoder-ai/qoder-agent-sdk');

    const u2 = randomUUID();
    const entries = [
      userMsg(ids.u1, null, '第一问'),
      asstMsg(ids.a1, ids.u1, '第一答'),
      userMsg(u2, ids.a1, '第二问'),
      asstMsg(ids.a2, u2, '第二答'),
      {
        // 真实 CC/qoder 格式：boundary parentUuid=null 开新根，靠 logicalParentUuid 链接
        ...base(ids.cb, null),
        logicalParentUuid: ids.a2,
        type: 'system',
        subtype: 'compact_boundary',
        content: 'Conversation compacted',
        isMeta: false,
        level: 'info',
        compactMetadata: { trigger: 'auto', preTokens: 37418 },
      },
      userMsg(ids.u3, ids.cb, '压缩后追问'),
      asstMsg(ids.a3, ids.u3, '压缩后回答'),
    ];
    const projDir = join(configDir, 'projects', 'probe-project');
    await mkdir(projDir, { recursive: true });
    await writeFile(
      join(projDir, `${sessionId}.jsonl`),
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
  });

  afterAll(async () => {
    delete process.env.QODER_CONFIG_DIR;
    await rm(configDir, { recursive: true, force: true });
  });

  it('fork upTo 压缩前消息 → 切片仅含原始前缀，不含 boundary，UUID 全重映射', async () => {
    const { sessionId: forked } = await sdk.forkSession(sessionId, { upToMessageId: ids.a1 });
    const msgs = await sdk.getSessionMessages(forked, { includeSystemMessages: true });
    expect(msgs.map((m) => m.subtype ?? m.type)).toEqual(['user', 'assistant']);
    const oldIds: string[] = Object.values(ids);
    expect(
      msgs.every((m) => !oldIds.includes(m.uuid)),
      'fork 产物 UUID 全部重映射',
    ).toBe(true);
  });

  it('fork upTo 压缩后消息 → 切片含 boundary（分支继承 summary 上下文）', async () => {
    const { sessionId: forked } = await sdk.forkSession(sessionId, { upToMessageId: ids.a3 });
    const msgs = await sdk.getSessionMessages(forked, { includeSystemMessages: true });
    expect(
      msgs.some((m) => m.subtype === 'compact_boundary'),
      '切片包含压缩边界',
    ).toBe(true);
    // boundary parentUuid=null 断链后主链 = boundary 起（forkSession 按文件顺序切片不受断链影响）
    const texts = msgs
      .map((m) =>
        typeof m.message === 'object' && m.message !== null
          ? ((m.message as { content?: unknown }).content ?? '')
          : '',
      )
      .map((c) => (typeof c === 'string' ? c : ((c as { text?: string }[])[0]?.text ?? '')));
    expect(texts).toContain('压缩后追问');
    expect(texts).toContain('压缩后回答');
  });
});

// ── Pi：node < 22 时 undici 8.5 模块求值即抛错（且产生 unhandled rejection 副作用），
// 故按版本预判，不满足则不 import ──

const nodeMajor = Number(process.version.slice(1).split('.')[0]);
let pi: typeof import('@earendil-works/pi-coding-agent') | null = null;
if (nodeMajor >= 22) {
  try {
    pi = await import('@earendil-works/pi-coding-agent');
  } catch {
    pi = null;
  }
}

describe.skipIf(!pi)('Pi createBranchedSession × compaction entry', () => {
  let root: string;
  let a1 = '';
  let a3 = '';
  let comp = '';
  let parentFile = '';
  const cwd = process.cwd();

  const user = (text: string) => ({
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  });
  const asst = (text: string) => ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test-model',
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
  });

  /** 复制父会话到干净目录再打开（模拟 PiSource 真实布局：每 session 独立目录） */
  const openFresh = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-fork-open-'));
    await copyFile(parentFile, join(dir, basename(parentFile)));
    return { manager: pi!.SessionManager.continueRecent(cwd, dir), dir };
  };

  const entryTypes = async (path: string) =>
    (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string })
      .filter((e) => e.type !== 'session')
      .map((e) => e.type);

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pi-fork-test-'));
    const sm = pi!.SessionManager.create(cwd, root);
    sm.appendMessage(user('第一问') as never);
    a1 = sm.appendMessage(asst('第一答') as never);
    const u2 = sm.appendMessage(user('第二问') as never);
    sm.appendMessage(asst('第二答') as never);
    comp = sm.appendCompaction('SUMMARY-OF-U1-A1', u2, 12345);
    sm.appendMessage(user('压缩后追问') as never);
    a3 = sm.appendMessage(asst('压缩后回答') as never);
    parentFile = sm.getSessionFile()!;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('fork 点 = compaction entry 本身 → 合法，上下文用 summary + 保留段', async () => {
    const { manager } = await openFresh();
    manager.branch(comp);
    const branched = manager.createBranchedSession(comp);
    expect(branched, 'createBranchedSession(compactionEntryId) 返回新文件').toBeTruthy();
    expect(await entryTypes(branched!)).toContain('compaction');
    const ctx = pi!.SessionManager.open(branched!).buildSessionContext();
    expect(ctx.messages[0].role, '上下文首条为压缩摘要').toBe('compactionSummary');
  });

  it('fork 点 = 压缩前 entry → 产物为原始全量前缀（不含 compaction）', async () => {
    const { manager } = await openFresh();
    const branched = manager.createBranchedSession(a1);
    expect(await entryTypes(branched!)).toEqual(['message', 'message']);
    const ctx = pi!.SessionManager.open(branched!).buildSessionContext();
    expect(ctx.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('fork 点 = 压缩后 entry → 产物含 compaction，正确继承 summary 上下文', async () => {
    const { manager } = await openFresh();
    const branched = manager.createBranchedSession(a3);
    expect(await entryTypes(branched!)).toContain('compaction');
    const ctx = pi!.SessionManager.open(branched!).buildSessionContext();
    expect(ctx.messages[0].role).toBe('compactionSummary');
    const texts = ctx.messages.map((m) => {
      const content = (m as { content?: unknown }).content;
      return typeof content === 'string'
        ? content
        : ((content as { text?: string }[] | undefined)?.[0]?.text ?? '');
    });
    expect(texts).toContain('压缩后回答');
  });

  it('机制回归：createBranchedSession 副作用切换 manager 当前文件（PiSource 须每次新开 manager）', async () => {
    const { manager } = await openFresh();
    const before = manager.getSessionFile();
    manager.createBranchedSession(a1);
    expect(manager.getSessionFile(), 'fork 后 manager 已指向新分支文件').not.toBe(before);
  });
});

// pi 不可加载时输出原因（避免静默 skip 造成"全绿"错觉）
if (!pi) {
  describe('Pi createBranchedSession × compaction entry (skipped)', () => {
    it(`环境不满足：pi-coding-agent 需 node >= 22（undici 8.5），当前 ${process.version}`, () => {
      expect(pi).toBeNull();
    });
  });
}
