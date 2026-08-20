import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm, mkdir } from 'node:fs/promises';
import {
  createComposite,
  joinDomain,
  computeDomainHash,
  encodeContractDirName,
  sourceLabel,
} from '../dist/index.mjs';
import {
  createTempLatticeHome,
  assertIsolatedLatticeHome,
  putFile,
  createBareRemote,
} from './helpers.mjs';

// S3：Provider 读时合并 —— 遮蔽（本地>域序）、use 三档双视图、来源标注、
// G1 降级、G2 rebase 跳过、契约 ID 项目对齐。

let env;
let bare;

const U = 't';
const CONTRACT_A = 'git:aaa111bbb222ccc3';
const DIR_A = encodeContractDirName(CONTRACT_A);
const DOMAIN = 'team-pack';

beforeEach(async () => {
  env = await createTempLatticeHome();
  bare = await createBareRemote('provider');
  // 本地主数据
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U, sync: { domains: [] } }),
  );
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', DIR_A, 'project.json'),
    JSON.stringify({ ids: [CONTRACT_A], name: 'work-app' }),
  );
  await putFile(
    join(env.latticeHome, 'users', U, 'projects', DIR_A, 'spec', 'api.md'),
    '---\ntitle: api\n---\n本地版 api\n',
  );
  await putFile(
    join(env.latticeHome, 'users', U, 'spec', 'commit-style.md'),
    '---\ntitle: commit\n---\n本地版\n',
  );
  await putFile(join(env.latticeHome, 'spec', 'team.md'), '---\ntitle: team\n---\n本地全局\n');
});

afterEach(async () => {
  await env.cleanup();
  await rm(bare.tmpRoot, { recursive: true, force: true });
});

/** 在 bare 域里预置经验包内容（同事视角 + 同名用户视角） */
async function seedDomainContent() {
  assertIsolatedLatticeHome();
  const { execFileSync } = await import('node:child_process');
  const stage = join(env.tmpRoot, 'seeder');
  execFileSync('git', ['clone', '-q', bare.barePath, stage]);
  // 同事 alice 的独有 spec
  await putFile(
    join(stage, 'users', 'alice', 'spec', 'alice-style.md'),
    '---\ntitle: alice\n---\n同事规范\n',
  );
  // 同名用户 t：同名 spec（应被本地遮蔽）+ 独有 spec（应并集可见）
  await putFile(
    join(stage, 'users', U, 'spec', 'commit-style.md'),
    '---\ntitle: commit\n---\n域里的同名版本\n',
  );
  await putFile(
    join(stage, 'users', U, 'spec', 'domain-only.md'),
    '---\ntitle: only\n---\n域独有\n',
  );
  // 同名用户 t 的项目（同契约 ID → 本地遮蔽元数据，spec 并集）
  await putFile(
    join(stage, 'users', U, 'projects', DIR_A, 'project.json'),
    JSON.stringify({ ids: [CONTRACT_A], name: 'work-app-remote' }),
  );
  await putFile(
    join(stage, 'users', U, 'projects', DIR_A, 'spec', 'from-domain.md'),
    '---\ntitle: fd\n---\n域同事贡献\n',
  );
  // 全局 spec
  await putFile(join(stage, 'spec', 'team.md'), '---\ntitle: team\n---\n域版全局\n');
  execFileSync('git', ['add', '.'], { cwd: stage });
  execFileSync(
    'git',
    ['-c', 'user.name=s', '-c', 'user.email=s@s', 'commit', '-q', '--no-verify', '-m', 'seed'],
    { cwd: stage },
  );
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: stage });
  await rm(stage, { recursive: true, force: true });
}

test('遮蔽与并集：本地同路径遮蔽域版，域独有并集可见，遮蔽条目可发现', async () => {
  await seedDomainContent();
  await joinDomain({ remote: bare.barePath, label: DOMAIN }, U); // 默认 trusted
  const c = await createComposite(U);
  const view = await c.knowledgeView();

  const ns = (v) => v.namespace;
  // 本地同路径 spec 遮蔽域版
  const commit = view.specs.find((v) => ns(v) === `user:${U}:commit-style.md`);
  assert.ok(commit, 'commit-style 存在');
  assert.equal(commit.source, 'local', '同名用户 spec 本地胜');
  assert.ok(commit.spec.content.includes('本地版'));
  // 域独有 spec 并集可见 + 来源标注
  const only = view.specs.find((v) => ns(v) === `user:${U}:domain-only.md`);
  assert.ok(
    only && only.source === computeDomainHash(bare.barePath, 'main'),
    '域独有 spec 可见且来源正确',
  );
  // 同事 spec 可见
  assert.ok(view.specs.some((v) => ns(v) === 'user:alice:alice-style.md'));
  // 项目 spec 并集（本地 api + 域同事贡献 from-domain）
  assert.ok(
    view.specs.some((v) => ns(v) === `project:${U}:${CONTRACT_A}:api.md`),
    '本地项目 spec 在',
  );
  assert.ok(
    view.specs.some((v) => ns(v) === `project:${U}:${CONTRACT_A}:from-domain.md`),
    '域同事项目 spec 并集可见',
  );
  // 全局同名遮蔽
  const team = view.specs.find((v) => ns(v) === 'global:team.md');
  assert.equal(team?.source, 'local', '全局同名本地胜');
  // 遮蔽可发现性
  assert.ok(
    view.shadowed.some(
      (s) => s.namespace === `user:${U}:commit-style.md` && s.lostSource !== 'local',
    ),
  );
  assert.ok(view.shadowed.some((s) => s.namespace === 'global:team.md'));
  // 项目元数据遮蔽：胜者 name 是本地版
  const proj = view.projects.find((p) => p.contractId === CONTRACT_A && p.username === U);
  assert.equal(proj?.source, 'local');
  assert.equal(proj?.project.name, 'work-app');
});

test('use 三档：trusted 全并 / reference 检索可见但约束视图不含 / off 全不可见', async () => {
  await seedDomainContent();
  const { writeSyncDomains, domainHashOf: h } = await import('../dist/index.mjs');
  const hash = h({ remote: bare.barePath });
  const { readSyncDomains } = await import('../dist/index.mjs');

  // trusted
  await joinDomain({ remote: bare.barePath }, U);
  let c = await createComposite(U);
  let k = await c.knowledgeView();
  let ct = await c.constraintView();
  assert.ok(
    k.specs.some((v) => ns2(v) === `user:${U}:domain-only.md`),
    'trusted 检索可见',
  );
  assert.ok(
    ct.specs.some((v) => ns2(v) === `user:${U}:domain-only.md`),
    'trusted 约束视图含域同名用户 spec（默认全合并）',
  );

  // reference：检索可见、约束不含
  const domains = await readSyncDomains();
  domains[0] = { ...domains[0], use: 'reference' };
  await writeSyncDomains(domains);
  c = await createComposite(U);
  k = await c.knowledgeView();
  ct = await c.constraintView();
  assert.ok(
    k.specs.some((v) => ns2(v) === `user:${U}:domain-only.md`),
    'reference 检索仍可见',
  );
  assert.ok(
    !ct.specs.some((v) => ns2(v) === `user:${U}:domain-only.md` && v.username === U),
    'reference 约束视图不含域同名用户 spec',
  );
  assert.ok(
    ct.specs.some((v) => v.source === 'local'),
    'reference 下本地照常',
  );

  // off：两视图均不含
  domains[0] = { ...domains[0], use: 'off' };
  await writeSyncDomains(domains);
  c = await createComposite(U);
  k = await c.knowledgeView();
  ct = await c.constraintView();
  assert.ok(!k.specs.some((v) => v.source === hash), 'off 域两视图均不含');
  assert.ok(!ct.specs.some((v) => v.source === hash));
  void domains;
});

test('G1 降级：镜像缺失的域被跳过，本地与其余结果正常返回', async () => {
  await seedDomainContent();
  const jr = await joinDomain({ remote: bare.barePath }, U);
  // 制造镜像缺失（手删目录，G4 场景）→ G1 降级路径
  const { rm } = await import('node:fs/promises');
  const { mirrorDirOf } = await import('../dist/index.mjs');
  await rm(mirrorDirOf({ remote: bare.barePath }), { recursive: true, force: true });
  const c = await createComposite(U);
  const view = await c.knowledgeView(); // 不得抛错
  assert.ok(
    view.specs.some((v) => v.source === 'local'),
    '本地源正常',
  );
  assert.ok(
    view.degraded.some((d) => d.includes(jr.domainHash) && d.includes('镜像目录缺失')),
    `记录降级：${view.degraded.join('；')}`,
  );
});

test('G2 脏读防护：镜像 rebase 中间态 → 该域跳过', async () => {
  await seedDomainContent();
  await joinDomain({ remote: bare.barePath }, U);
  const { execFileSync } = await import('node:child_process');
  const { mirrorDirOf } = await import('../dist/index.mjs');
  const mirrorDir = mirrorDirOf({ remote: bare.barePath });
  // 手造 rebase 中间态目录
  await mkdir(join(mirrorDir, '.git', 'rebase-merge'), { recursive: true });
  const c = await createComposite(U);
  const view = await c.knowledgeView();
  assert.ok(
    view.specs.every((v) => v.source === 'local'),
    '该域本轮被跳过',
  );
  assert.ok(view.degraded.some((d) => d.includes('同步进行中')));
  await rm(join(mirrorDir, '.git', 'rebase-merge'), { recursive: true, force: true });
  void execFileSync;
});

test('sourceLabel：本地空串、域 hash8、label+hash8', async () => {
  assert.equal(sourceLabel('local'), '');
  assert.equal(sourceLabel('1234567890abcdef'), '域 12345678');
  assert.equal(
    sourceLabel('1234567890abcdef', new Map([['1234567890abcdef', '团队']])),
    '团队(12345678)',
  );
});

function ns2(v) {
  return v.namespace;
}
