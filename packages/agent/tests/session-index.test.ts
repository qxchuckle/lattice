/**
 * SessionIndexManager 测试（此前覆盖率 4.9%）
 *
 * 索引是会话列表的数据源：坏了用户直观感受是「会话消失」，
 * 而正文（tree.json/nodes.jsonl）其实还在。故重点锁两类行为：
 * 1. 增删改查与排序（列表可见性）
 * 2. 损坏/缺失时的兜底与 rebuild（不因单个坏目录丢掉其余会话）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionIndexManager, type SessionIndexEntry } from '../src/session/session-index.js';

let baseDir: string;
let indexPath: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'lattice-idx-'));
  indexPath = join(baseDir, 'index.json');
});
afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const mgrOf = () => new SessionIndexManager({ indexPath, baseDir });

const entry = (treeId: string, over: Partial<SessionIndexEntry> = {}): SessionIndexEntry => ({
  treeId,
  nodeCount: 1,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/** 造一个真实的会话目录（rebuild 的输入） */
async function makeTreeDir(
  dir: string,
  tree: Record<string, unknown>,
  nodeLines?: string[],
): Promise<void> {
  const d = join(baseDir, dir);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, 'tree.json'), JSON.stringify(tree), 'utf-8');
  if (nodeLines) await writeFile(join(d, 'nodes.jsonl'), nodeLines.join('\n'), 'utf-8');
}

describe('索引 CRUD', () => {
  it('索引文件不存在 → 空索引而非抛错', async () => {
    const idx = await mgrOf().load();
    expect(idx.sessions).toEqual([]);
  });

  it('upsert 新增与更新同一 treeId（不产生重复条目）', async () => {
    const m = mgrOf();
    await m.upsert(entry('t1', { title: '旧' }));
    await m.upsert(entry('t1', { title: '新', nodeCount: 5 }));
    const list = await m.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: '新', nodeCount: 5 });
  });

  it('listSessions 按 updatedAt 倒序（最近活跃在前）', async () => {
    const m = mgrOf();
    await m.upsert(entry('old', { updatedAt: 100 }));
    await m.upsert(entry('new', { updatedAt: 300 }));
    await m.upsert(entry('mid', { updatedAt: 200 }));
    expect((await m.listSessions()).map((s) => s.treeId)).toEqual(['new', 'mid', 'old']);
  });

  it('touch 更新活跃信息，updatedAt 单调前进', async () => {
    const m = mgrOf();
    await m.upsert(entry('t1', { updatedAt: 1 }));
    await m.touch('t1', { lastRole: 'assistant', nodeCount: 9 });
    const e = await m.getEntry('t1');
    expect(e).toMatchObject({ lastRole: 'assistant', nodeCount: 9 });
    expect(e!.updatedAt).toBeGreaterThan(1);
  });

  it('touch/updateSummary 作用于不存在的 treeId → 静默无操作（不造幽灵条目）', async () => {
    const m = mgrOf();
    await m.touch('ghost', { nodeCount: 3 });
    await m.updateSummary('ghost', 's');
    expect(await m.listSessions()).toEqual([]);
  });

  it('updateSummary 写入摘要（compaction 结果对列表可见）', async () => {
    const m = mgrOf();
    await m.upsert(entry('t1'));
    await m.updateSummary('t1', '压缩摘要');
    expect((await m.getEntry('t1'))?.summary).toBe('压缩摘要');
  });

  it('remove 删除条目并落盘', async () => {
    const m = mgrOf();
    await m.upsert(entry('t1'));
    await m.upsert(entry('t2'));
    await m.remove('t1');
    expect((await m.listSessions()).map((s) => s.treeId)).toEqual(['t2']);
    const onDisk = JSON.parse(await readFile(indexPath, 'utf-8')) as { sessions: unknown[] };
    expect(onDisk.sessions, '删除必须持久化，否则重启后会话复活').toHaveLength(1);
  });

  it('invalidate 后重新读盘（多进程写入时的可见性）', async () => {
    const m = mgrOf();
    await m.upsert(entry('t1'));
    // 模拟另一进程改写索引文件
    await writeFile(
      indexPath,
      JSON.stringify({ sessions: [entry('external')], updatedAt: 2 }),
      'utf-8',
    );
    expect(
      (await m.listSessions()).map((s) => s.treeId),
      '缓存未失效时看不到外部写入',
    ).toEqual(['t1']);
    m.invalidate();
    expect((await m.listSessions()).map((s) => s.treeId)).toEqual(['external']);
  });

  it('索引文件损坏 → 视为空索引，不阻断后续写入', async () => {
    await writeFile(indexPath, '{ 坏的 json', 'utf-8');
    const m = mgrOf();
    expect((await m.load()).sessions).toEqual([]);
    await m.upsert(entry('t1'));
    expect(await m.listSessions()).toHaveLength(1);
  });
});

describe('rebuild（索引损坏兜底）', () => {
  it('从目录重建：读 tree.json，nodes.jsonl 行数作 nodeCount', async () => {
    await makeTreeDir('tree-a', { id: 'tree-a', title: 'A', createdAt: 1, updatedAt: 2 }, [
      '{"id":"n1"}',
      '{"id":"n2"}',
      '', // 空行不计
    ]);
    const idx = await mgrOf().rebuild();
    expect(idx.sessions).toHaveLength(1);
    expect(idx.sessions[0]).toMatchObject({ treeId: 'tree-a', title: 'A', nodeCount: 2 });
  });

  it('缺 nodes.jsonl → nodeCount 0，仍收录该会话', async () => {
    await makeTreeDir('tree-b', { id: 'tree-b', createdAt: 1, updatedAt: 1 });
    const idx = await mgrOf().rebuild();
    expect(idx.sessions[0]).toMatchObject({ treeId: 'tree-b', nodeCount: 0 });
  });

  it('单个坏目录不影响其余会话（逐目录容错，不整体失败）', async () => {
    await makeTreeDir('good', { id: 'good', createdAt: 1, updatedAt: 1 });
    const badDir = join(baseDir, 'bad');
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, 'tree.json'), '{ 坏', 'utf-8');
    await mkdir(join(baseDir, 'no-tree-json'), { recursive: true });

    const idx = await mgrOf().rebuild();
    expect(idx.sessions.map((s) => s.treeId)).toEqual(['good']);
  });

  it('rebuild 结果落盘并覆盖旧索引（旧的幽灵条目被清掉）', async () => {
    const m = mgrOf();
    await m.upsert(entry('ghost'));
    await makeTreeDir('real', { id: 'real', createdAt: 1, updatedAt: 1 });
    await m.rebuild();
    expect((await m.listSessions()).map((s) => s.treeId)).toEqual(['real']);
    const onDisk = JSON.parse(await readFile(indexPath, 'utf-8')) as {
      sessions: { treeId: string }[];
    };
    expect(onDisk.sessions.map((s) => s.treeId)).toEqual(['real']);
  });

  it('baseDir 不存在 → 空索引（首次启动路径）', async () => {
    const m = new SessionIndexManager({
      indexPath: join(baseDir, 'x', 'index.json'),
      baseDir: join(baseDir, 'nope'),
    });
    expect((await m.rebuild()).sessions).toEqual([]);
  });
});
