/**
 * 持久化结构版本：前兼容旧数据、后拒绝新版数据
 *
 * 为什么必须测：降级读取（新版写的数据被旧版读到）若静默进行，会丢弃新版字段并
 * 在下次写回时把结构写坏——数据损坏且不可逆。故「拒绝并报错」是硬要求。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRepository, SESSION_SCHEMA_VERSION } from '../src/session/session-repository.js';

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'lattice-schema-'));
});
afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const repoOf = () => new SessionRepository({ baseDir });

async function writeRawTree(treeId: string, payload: Record<string, unknown>): Promise<void> {
  const dir = join(baseDir, treeId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'tree.json'), JSON.stringify(payload), 'utf-8');
}

describe('tree.json 结构版本', () => {
  it('写入时落版本号', async () => {
    const repo = repoOf();
    await repo.writeTree({
      id: 't1',
      headNodeId: null,
      defaultBranchId: 'main',
      branches: [],
      createdAt: 0,
      updatedAt: 0,
    });
    const raw = JSON.parse(await readFile(join(baseDir, 't1', 'tree.json'), 'utf-8')) as {
      schemaVersion?: number;
    };
    expect(raw.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
  });

  it('旧数据（无 schemaVersion）正常加载：前兼容，不因缺字段丢会话', async () => {
    await writeRawTree('legacy', {
      id: 'legacy',
      headNodeId: null,
      defaultBranchId: 'main',
      branches: [],
      createdAt: 0,
      updatedAt: 0,
    });
    const tree = await repoOf().readTree('legacy');
    expect(tree?.id).toBe('legacy');
  });

  it('版本过新 → 抛错拒绝加载（不静默降级读取）', async () => {
    await writeRawTree('future', {
      id: 'future',
      schemaVersion: SESSION_SCHEMA_VERSION + 1,
      branches: [],
    });
    const error = await repoOf()
      .readTree('future')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/版本过新/);
    expect((error as Error).message).toMatch(/升级/); // 给出可执行的处置建议
  });

  it('同版本正常加载；不存在的树返回 undefined（非抛错）', async () => {
    await writeRawTree('same', {
      id: 'same',
      schemaVersion: SESSION_SCHEMA_VERSION,
      branches: [],
    });
    expect((await repoOf().readTree('same'))?.id).toBe('same');
    expect(await repoOf().readTree('ghost')).toBeUndefined();
  });

  it('损坏的 JSON 视为无此树（不阻断其他会话加载）', async () => {
    const dir = join(baseDir, 'broken');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'tree.json'), '{ not json', 'utf-8');
    expect(await repoOf().readTree('broken')).toBeUndefined();
  });
});
