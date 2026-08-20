import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import {
  joinDomain,
  syncDomains,
  unlinkDomain,
  createComposite,
  readSyncDomains,
  writeSyncDomains,
  computeDomainHash,
  encodeContractDirName,
  collectAllSearchDocuments,
  initDb,
  closeDb,
} from '../dist/index.mjs';
import { createTempLatticeHome, putFile, createBareRemote } from './helpers.mjs';

/**
 * 端到端全生命周期（最终验证）：双机真实 git 流程。
 * 机器 A（qcqx）发布经验 → 机器 B（alice）join 消费 + 贡献 → A 拉取看见 B →
 * A 退出贡献 → B 拉取后视图消失 → unlink 全清理。全程隔离 LATTICE_HOME。
 */

let homeA;
let homeB;
let bare;

const CONTRACT_WORK = 'git:e2e111workproj01';

beforeEach(async () => {
  homeA = await createTempLatticeHome();
  bare = await createBareRemote('e2e');
  // 机器 A 主数据：工作项目 + spec + 任务
  await putFile(
    join(homeA.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: 'qcqx', sync: { domains: [] } }),
  );
  await putFile(
    join(
      homeA.latticeHome,
      'users',
      'qcqx',
      'projects',
      encodeContractDirName(CONTRACT_WORK),
      'project.json',
    ),
    JSON.stringify({ ids: [CONTRACT_WORK], name: 'work-app' }),
  );
  await putFile(
    join(
      homeA.latticeHome,
      'users',
      'qcqx',
      'projects',
      encodeContractDirName(CONTRACT_WORK),
      'spec',
      'api.md',
    ),
    '---\ntitle: api\n---\nA 的工作规范\n',
  );
  await putFile(
    join(homeA.latticeHome, 'users', 'qcqx', 'tasks', '2026-08-20-e2e-task-a', 'task.json'),
    JSON.stringify({
      id: '2026-08-20-e2e-task-a',
      title: 'A 的经验任务',
      status: 'completed',
      created: '2026-08-20T00:00:00.000Z',
      projects: [CONTRACT_WORK],
    }),
  );
  await putFile(
    join(homeA.latticeHome, 'users', 'qcqx', 'tasks', '2026-08-20-e2e-task-a', 'prd.md'),
    '# A 的经验\n',
  );
});

afterEach(async () => {
  if (homeB) {
    await homeB.cleanup();
    homeB = null;
  }
  await homeA.cleanup();
  await rm(bare.tmpRoot, { recursive: true, force: true });
});

function switchToHomeA() {
  process.env.LATTICE_HOME = homeA.latticeHome;
}

function switchToHomeB() {
  process.env.LATTICE_HOME = homeB.latticeHome;
}

test('双机全生命周期：发布 → 消费 → 互推 → 退出传播 → unlink', async () => {
  // ── 阶段 1：A join 并全量发布 ──
  const jr = await joinDomain({ remote: bare.barePath, routes: ['*'] }, 'qcqx');
  assert.equal(jr.summary?.users, 0, '空域无用户');
  const sync1 = await syncDomains('qcqx');
  assert.equal(sync1[0].push?.status, 'pushed', 'A 首次推送');
  const hash = computeDomainHash(bare.barePath, 'main');

  // ── 阶段 2：机器 B（alice）join 同域，只读消费 ──
  homeB = await createTempLatticeHome();
  switchToHomeB();
  await putFile(
    join(homeB.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: 'alice', sync: { domains: [] } }),
  );
  const jrB = await joinDomain({ remote: bare.barePath }, 'alice');
  assert.ok(jrB.summary && jrB.summary.users >= 1, 'B 看见域内用户');
  assert.equal(jrB.summary.sameNameUserPresent, false, 'B 与 A 不同名');

  // B 的 provider 合并视图：能看见 A 的经验
  let view = await (await createComposite('alice')).knowledgeView();
  assert.ok(
    view.specs.some((v) => v.spec.content.includes('A 的工作规范')),
    'B 看见 A 的项目 spec',
  );
  assert.ok(
    view.tasks.some((v) => v.task.id === '2026-08-20-e2e-task-a'),
    'B 看见 A 的任务',
  );
  assert.ok(
    view.projects.some((v) => v.contractId === CONTRACT_WORK),
    'B 看见 A 的项目',
  );

  // ── 阶段 3：B 贡献自己的内容（selective routes）──
  await putFile(
    join(
      homeB.latticeHome,
      'users',
      'alice',
      'projects',
      encodeContractDirName('git:e2e222aliceproj0'),
      'project.json',
    ),
    JSON.stringify({ ids: ['git:e2e222aliceproj0'], name: 'alice-app' }),
  );
  await putFile(
    join(homeB.latticeHome, 'users', 'alice', 'spec', 'alice-style.md'),
    '---\ntitle: alice\n---\nB 的规范\n',
  );
  const domainsB = await readSyncDomains();
  domainsB[0] = { ...domainsB[0], routes: ['*'] };
  await writeSyncDomains(domainsB);
  const syncB = await syncDomains('alice');
  assert.equal(syncB[0].push?.status, 'pushed', 'B 推送自己的贡献');

  // B 的推送没删 A 的内容（互删护栏端到端）
  const bareFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
    cwd: bare.barePath,
    encoding: 'utf-8',
  })
    .split('\n')
    .filter(Boolean);
  assert.ok(
    bareFiles.some((f) => f.startsWith('users/qcqx/')),
    'A 的内容仍在（互删护栏）',
  );
  assert.ok(
    bareFiles.some((f) => f.startsWith('users/alice/')),
    'B 的内容已上',
  );

  // ── 阶段 4：A 拉取后看见 B 的贡献 ──
  switchToHomeA();
  const syncA2 = await syncDomains('qcqx');
  assert.ok(syncA2[0].pulled, 'A 拉取成功');
  view = await (await createComposite('qcqx')).knowledgeView();
  assert.ok(
    view.specs.some((v) => v.spec.content.includes('B 的规范')),
    'A 看见 B 的贡献',
  );

  // ── 阶段 5：A 删除任务并退出（退出传播）→ B 拉取后视图消失 ──
  await rm(join(homeA.latticeHome, 'users', 'qcqx', 'tasks', '2026-08-20-e2e-task-a'), {
    recursive: true,
    force: true,
  });
  const syncA3 = await syncDomains('qcqx');
  assert.ok(
    (syncA3[0].push?.removed ?? 0) >= 2,
    `A 退出任务贡献，实际 removed=${syncA3[0].push?.removed}`,
  );

  switchToHomeB();
  const syncB2 = await syncDomains('alice');
  assert.ok(syncB2[0].pulled, 'B 拉取');
  view = await (await createComposite('alice')).knowledgeView();
  assert.ok(
    !view.tasks.some((v) => v.task.id === '2026-08-20-e2e-task-a'),
    'B 视图中 A 的任务已消失（退出传播）',
  );
  assert.ok(
    view.specs.some((v) => v.spec.content.includes('A 的工作规范')),
    'A 的 spec 贡献仍在（未退出）',
  );

  // ── 阶段 6：RAG 文档收集（B 视角含 A 的域文档；已退出的任务不在）──
  initDb();
  const docs = await collectAllSearchDocuments();
  closeDb();
  assert.ok(
    docs.some((d) => d.source === hash && d.filePath.includes('api.md')),
    '域 spec 文档进索引集',
  );
  assert.ok(
    docs.some((d) => !d.source && d.filePath.includes('alice-style.md')),
    'B 本地文档照常',
  );
  assert.ok(!docs.some((d) => d.filePath.includes('e2e-task-a')), '已退出的任务文档不在索引集');

  // ── 阶段 7：unlink 全清理 ──
  await unlinkDomain(hash);
  const after = await readSyncDomains();
  assert.equal(after.length, 0, 'B 配置已清');
  view = await (await createComposite('alice')).knowledgeView();
  assert.ok(!view.specs.some((v) => v.source === hash), 'unlink 后域数据从视图消失');

  // A 侧也清理（主数据毫发无伤验证）
  switchToHomeA();
  const aFiles = await (
    await import('node:fs/promises')
  ).readdir(
    join(
      homeA.latticeHome,
      'users',
      'qcqx',
      'projects',
      encodeContractDirName(CONTRACT_WORK),
      'spec',
    ),
  );
  assert.ok(aFiles.includes('api.md'), 'A 主数据全程未被触碰');
});
