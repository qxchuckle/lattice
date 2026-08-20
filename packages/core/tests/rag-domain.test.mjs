import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import {
  collectAllSearchDocuments,
  joinDomain,
  computeDomainHash,
  encodeContractDirName,
  writeSyncDomains,
  readSyncDomains,
  initDb,
  closeDb,
} from '../dist/index.mjs';
import {
  createTempLatticeHome,
  assertIsolatedLatticeHome,
  putFile,
  createBareRemote,
} from './helpers.mjs';

// S4：RAG collector 域文档 —— 胜者才索引、被遮蔽副本永不索引、
// off 域不索引、域任务 PRD/design 文档、来源标注 source=hash。

let env;
let bare;

const U = 't';
const CONTRACT_A = 'git:ccc333ddd444eee5';
const DIR_A = encodeContractDirName(CONTRACT_A);
const DOMAIN_TASK = '2026-08-19-domain-task-01';

beforeEach(async () => {
  env = await createTempLatticeHome();
  bare = await createBareRemote('ragdomain');
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, sync: { domains: [] } }),
  );
  // 本地主数据
  await putFile(
    join(env.latticeHome, 'users', U, 'spec', 'commit-style.md'),
    '---\ntitle: commit\n---\n本地版提交规范\n',
  );
  await putFile(join(env.latticeHome, 'spec', 'team.md'), '---\ntitle: team\n---\n本地全局规范\n');
  await initDb();
  // bare 域内容（同事 alice + 同名 t + 域任务）
  assertIsolatedLatticeHome();
  const stage = join(env.tmpRoot, 'seeder');
  execFileSync('git', ['clone', '-q', bare.barePath, stage]);
  await putFile(
    join(stage, 'users', 'alice', 'spec', 'alice-rule.md'),
    '---\ntitle: alice\n---\n同事规范内容\n',
  );
  await putFile(
    join(stage, 'users', U, 'spec', 'commit-style.md'),
    '---\ntitle: commit\n---\n域同名版本\n',
  );
  await putFile(
    join(stage, 'users', U, 'spec', 'domain-only.md'),
    '---\ntitle: only\n---\n域独有规范\n',
  );
  await putFile(
    join(stage, 'users', U, 'tasks', DOMAIN_TASK, 'task.json'),
    JSON.stringify({
      id: DOMAIN_TASK,
      title: '域任务',
      status: 'completed',
      created: '2026-08-19T00:00:00.000Z',
    }),
  );
  await putFile(
    join(stage, 'users', U, 'tasks', DOMAIN_TASK, 'prd.md'),
    '# 域任务 PRD\n域经验内容\n',
  );
  await putFile(
    join(stage, 'users', U, 'tasks', DOMAIN_TASK, 'design.md'),
    '# 域任务 design\n设计讨论\n',
  );
  await putFile(
    join(stage, 'users', U, 'projects', DIR_A, 'project.json'),
    JSON.stringify({ ids: [CONTRACT_A], name: 'pack-app' }),
  );
  execFileSync('git', ['add', '.'], { cwd: stage });
  execFileSync(
    'git',
    ['-c', 'user.name=s', '-c', 'user.email=s@s', 'commit', '-q', '--no-verify', '-m', 'seed'],
    { cwd: stage },
  );
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: stage });
  await rm(stage, { recursive: true, force: true });
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
  await rm(bare.tmpRoot, { recursive: true, force: true });
});

test('collector 域文档：胜者索引、被遮蔽副本不索引、域任务 PRD/design、source 标注', async () => {
  await joinDomain({ remote: bare.barePath }, U);
  const hash = computeDomainHash(bare.barePath, 'main');
  const docs = await collectAllSearchDocuments();

  // 域独有 spec：索引 + source=hash
  const domainOnly = docs.find((d) => d.filePath.endsWith('domain-only.md'));
  assert.ok(domainOnly, '域独有 spec 被收集');
  assert.equal(domainOnly.source, hash);
  assert.equal(domainOnly.username, U);
  // 同事 spec：索引
  const alice = docs.find((d) => d.filePath.endsWith('alice-rule.md'));
  assert.ok(alice && alice.source === hash, '同事 spec 被收集并标注来源');
  // 被遮蔽副本不索引：本地 commit-style.md 只出现一次（本地版）
  const commits = docs.filter((d) => d.filePath.includes('commit-style'));
  assert.equal(commits.length, 1, '被遮蔽的域副本不索引');
  assert.ok(commits[0].filePath.startsWith(env.latticeHome), '唯一条目是本地版');
  assert.ok(!commits[0].source, '本地文档无 source 标注（无感）');
  // 全局同名遮蔽：team.md 只一条本地版
  const teams = docs.filter((d) => d.filePath.includes('team.md'));
  assert.equal(teams.length, 1, '全局被遮蔽副本不索引');
  // 域任务 PRD + design 文档
  const prd = docs.find((d) => d.filePath.endsWith(`${DOMAIN_TASK}/prd.md`));
  assert.ok(prd && prd.source === hash && prd.sourceType === 'task', '域任务 PRD 文档');
  const design = docs.find((d) => d.filePath.endsWith(`${DOMAIN_TASK}/design.md`));
  assert.ok(
    design && design.source === hash && design.sourceType === 'design',
    '域任务 design 文档',
  );
  // 域项目元数据文档
  const projDoc = docs.find((d) => d.sourceType === 'project' && d.source === hash);
  assert.ok(projDoc, '域项目元数据文档');
});

test('off 域不索引；reference 域照常索引（域只影响注入不影响检索）', async () => {
  await joinDomain({ remote: bare.barePath }, U);
  const domains = await readSyncDomains();
  const hash = computeDomainHash(bare.barePath, 'main');

  // reference：检索照常
  domains[0] = { ...domains[0], use: 'reference' };
  await writeSyncDomains(domains);
  let docs = await collectAllSearchDocuments();
  assert.ok(
    docs.some((d) => d.source === hash),
    'reference 域文档照常索引',
  );

  // off：完全不索引
  domains[0] = { ...domains[0], use: 'off' };
  await writeSyncDomains(domains);
  docs = await collectAllSearchDocuments();
  assert.ok(!docs.some((d) => d.source === hash), 'off 域文档不索引');
  // 本地文档不受影响
  assert.ok(docs.some((d) => d.filePath.includes('commit-style.md') && !d.source));
});
