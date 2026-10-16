import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  initDb,
  closeDb,
  registerProjectWithIds,
  findProjectDirName,
  getProjectSpecDir,
  exportSkill,
  verifyExport,
} from '../dist/index.mjs';
import { createTempLatticeHome, putFile } from './helpers.mjs';

// ltc export 领域行为：
// 1. 默认导出（spec+tasks、archived、用户前缀、项目文件夹、SKILL.md 自描述与条件「使用注意」）
// 2. 黑白名单（exclude-project 名称/id 归一化与连坐 / tag / filter / 时间 / 精确条目 / exclude-user）
// 3. 任务深度（prd / full）与「相关规范」交叉链接
// 4. dry-run / 幂等 / prune / clean 守卫 / verify（v2 与历史 v1）
// 5. 参数校验、空结果与 emptyKinds

const U = 'tester';
const ID_A = 'legacy:aaaaaaaaaaaaaaaa';
const ID_B = 'legacy:bbbbbbbbbbbbbbbb';
const ID_B_GIT = 'git:abcdefabcdefabcd';
const DERIVED_A = {
  gitRemotes: ['github.com/test/alpha'],
  packageNames: ['@test/alpha'],
  monorepoPackages: [],
};
const DERIVED_B = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

const T1 = '2026-09-01-1111-alpha-task';
const T2 = '2026-09-20-2222-beta-task';
const T3 = '2026-08-15-3333-beta-git-task';

/** 导出文件名基名：短 id（date-hex4） */
const tb = (id) => `${U}__${id.slice(0, 15)}`;

let env;
let OUT;

function sha256(content) {
  return `sha256:${createHash('sha256').update(content, 'utf-8').digest('hex')}`;
}

async function writeProjectSpec(primaryId, fileName, specId, title) {
  const dirName = await findProjectDirName(U, primaryId);
  const specDir = getProjectSpecDir(U, dirName);
  await putFile(
    join(specDir, fileName),
    `---\nid: ${specId}\ntitle: ${title}\ndescription: ${title}的说明\n---\n# ${title}\n`,
  );
}

async function writeTask(id, { status, projects, created, updated, prd, progress, design, refs }) {
  const dir = join(env.latticeHome, 'users', U, 'tasks', id);
  await putFile(
    join(dir, 'task.json'),
    JSON.stringify({
      id,
      title: id,
      status,
      projects,
      created,
      updated,
      ...(refs ? { referencedSpecs: refs } : {}),
    }),
  );
  await putFile(join(dir, 'prd.md'), prd ?? `# ${id}\n\n正文。\n`);
  if (progress) await putFile(join(dir, 'progress.yaml'), progress);
  if (design) await putFile(join(dir, 'design.md'), design);
}

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
  );
  initDb();
  OUT = join(env.tmpRoot, 'export-out');

  await registerProjectWithIds(U, [ID_A], join(env.tmpRoot, 'proj-alpha'), DERIVED_A);
  await registerProjectWithIds(U, [ID_B, ID_B_GIT], join(env.tmpRoot, 'proj-beta'), DERIVED_B);

  await putFile(
    join(env.latticeHome, 'spec', 'global-rule.md'),
    '---\nid: spec-gggg0001\ntitle: 全局规则\ndescription: 全局约束说明\n---\n# 全局规则\n\n全局约束。\n',
  );
  await putFile(
    join(env.latticeHome, 'users', U, 'spec', 'user-hbos.md'),
    '---\nid: spec-hhhh0001\ntitle: HBOS 约定\ntags:\n  - hbos\ndescription: HBOS 前端约定说明\n---\n# HBOS 约定\n\n正文 A。\n',
  );
  await putFile(
    join(env.latticeHome, 'users', U, 'spec', 'user-plain.md'),
    '---\nid: spec-pppp0001\ntitle: 普通规范\ndescription: 普通说明\n---\n# 普通规范\n\n正文 B。\n',
  );

  await writeProjectSpec(ID_A, 'alpha-conv.md', 'spec-aaaa0001', 'Alpha 约定');
  await writeProjectSpec(ID_B, 'beta-conv.md', 'spec-bbbb0001', 'Beta 约定');

  await writeTask(T1, {
    status: 'archived',
    projects: [ID_A],
    created: '2026-09-01T08:00:00.000Z',
    updated: '2026-09-10T08:00:00.000Z',
    refs: [
      {
        id: 'spec-aaaa0001',
        relativePath: 'alpha-conv.md',
        scope: 'project',
        projectId: ID_A,
        firstReadAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    prd: '# Alpha 历史任务\n\n## 目标\n\n完成 alpha 能力。\n\n执行 ltc task progress 查看进度。\n',
    progress:
      'entries:\n  - id: cp_1\n    time: 2026-09-02T00:00:00.000Z\n    type: decision\n    title: 采用方案 A\n    message: 理由一。\n  - id: cp_2\n    time: 2026-09-03T00:00:00.000Z\n    type: note\n    title: 环境事实\n    message: 记录。\n',
    design: '# Design\n\n被否决方案 B。\n',
  });
  await writeTask(T2, {
    status: 'in_progress',
    projects: ['bbbbbbbbbbbbbbbb'],
    created: '2026-09-20T08:00:00.000Z',
  });
  await writeTask(T3, {
    status: 'archived',
    projects: [ID_B_GIT],
    created: '2026-08-15T08:00:00.000Z',
  });
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

test('默认导出：结构 / 前缀 / 归档默认 / digest / SKILL.md 自描述', async () => {
  const r = await exportSkill({ execUser: U, outputDir: OUT });
  assert.equal(r.dryRun, false);
  assert.equal(r.stats.scannedSpecs, 5);
  assert.equal(r.stats.exportedSpecs, 5);
  assert.equal(r.stats.scannedTasks, 3);
  assert.equal(r.stats.exportedTasks, 2); // T1 + T3（T2 in_progress 默认剔除）

  const files = [
    'SKILL.md',
    'manifest.yaml',
    'spec-catalog.md',
    'task-catalog.md',
    'project-index.md',
    'global/tester__global-rule.md',
    'user/tester__user-hbos.md',
    'user/tester__user-plain.md',
    'proj-alpha/tester__alpha-conv.md',
    'proj-beta/tester__beta-conv.md',
    `tasks/${tb(T1)}.md`,
    `tasks/${tb(T3)}.md`,
  ];
  for (const f of files) assert.ok(existsSync(join(OUT, f)), `应存在：${f}`);
  assert.ok(!existsSync(join(OUT, `tasks/${tb(T2)}.md`)), 'in_progress 默认不导出');

  const skill = await readFile(join(OUT, 'SKILL.md'), 'utf8');
  assert.match(skill, /name: lattice-knowledge/);
  assert.match(skill, /description: Lattice 知识库：开发规范/); // 固定模板
  assert.ok(!/description:.*\d+ 份/.test(skill), 'description 不含计数等数据面内容');
  assert.match(skill, /必须读取/);
  assert.match(skill, /## 怎么使用/);
  assert.match(skill, /## 使用注意/); // T1 PRD 含 ltc 引用 → 条件生成
  assert.match(skill, /## 目录/);
  assert.match(skill, /spec-catalog\.md/);
  assert.match(skill, /task-catalog\.md/);
  assert.match(skill, /project-index\.md/);
  assert.match(skill, /Markdown 相对链接/);
  assert.ok(!skill.includes('### proj-alpha'), 'SKILL.md 不再内联清单（渐进式加载）');

  // 规范目录（第二层）
  const specCatalog = await readFile(join(OUT, 'spec-catalog.md'), 'utf8');
  assert.match(specCatalog, /### proj-alpha/);
  assert.match(specCatalog, /github.com\/test\/alpha/); // 项目匹配信息行
  assert.match(specCatalog, /HBOS 前端约定说明/);
  assert.match(specCatalog, /\[HBOS 约定\]\(user\/tester__user-hbos\.md\)/);

  // 任务档案目录（第二层，按项目分组；项目节附规范目录引用）
  const taskCatalog = await readFile(join(OUT, 'task-catalog.md'), 'utf8');
  assert.match(taskCatalog, /共 2 个任务/);
  assert.match(taskCatalog, /\[proj-alpha\]\(spec-catalog\.md#proj-alpha\)/);
  assert.match(taskCatalog, /\[2026-09-01-1111-alpha-task\]\(tasks\/tester__2026-09-01-1111\.md\)/);

  // 项目索引表（本地环境对接：包名 / git remote ↔ 规范 / 任务）
  const projectIndex = await readFile(join(OUT, 'project-index.md'), 'utf8');
  assert.match(projectIndex, /# 项目索引/);
  assert.match(projectIndex, /@test\/alpha/);
  assert.match(projectIndex, /github.com\/test\/alpha/);
  assert.match(projectIndex, /\[1 份\]\(spec-catalog\.md#proj-alpha\)/);
  assert.match(projectIndex, /\[1 个\]\(task-catalog\.md#proj-alpha\)/);
  assert.match(projectIndex, /\[1 个\]\(task-catalog\.md#proj-beta\)/);
  assert.ok(!projectIndex.includes('描述'), '全空描述列应省略（非内容截断）');

  const digest = await readFile(join(OUT, `tasks/${tb(T1)}.md`), 'utf8');
  assert.match(digest, /taskId: 2026-09-01-1111-alpha-task/);
  assert.equal((digest.match(/^# /gm) || []).length, 1, 'PRD 自带 H1 时不应重复加标题');
  assert.match(digest, /## 关联项目/);
  assert.match(digest, /\[proj-alpha\]\(\.\.\/spec-catalog\.md#proj-alpha\)/);
  assert.match(digest, /## 相关规范/);
  assert.match(digest, /\[Alpha 约定\]\(\.\.\/proj-alpha\/tester__alpha-conv\.md\)/);
  assert.match(digest, /## 过程要点/);
  assert.match(digest, /采用方案 A/);
  assert.ok(!digest.includes('环境事实'), 'note 类型不进过程要点');

  const manifestRaw = await readFile(join(OUT, 'manifest.yaml'), 'utf8');
  assert.match(manifestRaw, /tool: lattice-export/);
  assert.match(manifestRaw, /version: 2/);
  assert.match(manifestRaw, /tasks: 2/);
  assert.match(manifestRaw, /spec-catalog\.md/);
  assert.match(manifestRaw, /project-index\.md/);

  assert.equal(r.projectMatches.length, 0);
  assert.equal(r.emptyKinds.length, 0);
});

test('exclude-project：名称子串、id 变体归一化与连坐', async () => {
  const r = await exportSkill({ execUser: U, outputDir: OUT, excludeProjects: ['proj-beta'] });
  assert.ok(!existsSync(join(OUT, 'proj-beta')), 'beta 项目文件夹不应生成');
  assert.ok(!existsSync(join(OUT, `tasks/${tb(T3)}.md`)), 'T3（git id 变体）应被连坐剔除');
  assert.ok(existsSync(join(OUT, `tasks/${tb(T1)}.md`)));
  assert.ok(existsSync(join(OUT, 'user/tester__user-hbos.md')), 'user/global 不受项目排除影响');
  const betaMatch = r.projectMatches.find((m) => m.value === 'proj-beta');
  assert.ok(betaMatch && betaMatch.projects.includes('proj-beta'), '命中透明应列出 proj-beta');

  // 任务里 B 记为无前缀 plain id，排除值亦为 plain → 归一化后仍命中
  const OUT2 = join(env.tmpRoot, 'out2');
  const r2 = await exportSkill({
    execUser: U,
    outputDir: OUT2,
    excludeProjects: ['bbbbbbbbbbbbbbbb'],
  });
  assert.ok(!existsSync(join(OUT2, 'proj-beta')));
  assert.ok(!existsSync(join(OUT2, `tasks/${tb(T3)}.md`)));
  assert.equal(r2.stats.exportedTasks, 1); // 仅 T1 幸存
});

test('黑名单排除优先 + tag/filter/时间/精确条目', async () => {
  await exportSkill({ execUser: U, outputDir: OUT, excludeTags: ['hbos'] });
  assert.ok(!existsSync(join(OUT, 'user/tester__user-hbos.md')));
  assert.ok(existsSync(join(OUT, 'user/tester__user-plain.md')));

  const OUT2 = join(env.tmpRoot, 'out2');
  const rFilter = await exportSkill({ execUser: U, outputDir: OUT2, filters: ['alpha'] });
  assert.equal(rFilter.stats.exportedSpecs, 1); // 仅 alpha-conv
  assert.equal(rFilter.stats.exportedTasks, 1); // 仅 T1（PRD 含 alpha）
  assert.ok(existsSync(join(OUT2, 'proj-alpha/tester__alpha-conv.md')));
  assert.ok(!existsSync(join(OUT2, 'user/tester__user-hbos.md')));

  const OUT3 = join(env.tmpRoot, 'out3');
  await exportSkill({ execUser: U, outputDir: OUT3, excludeFilters: ['alpha'] });
  assert.ok(!existsSync(join(OUT3, `tasks/${tb(T1)}.md`)));
  assert.ok(existsSync(join(OUT3, `tasks/${tb(T3)}.md`)));

  const OUT4 = join(env.tmpRoot, 'out4');
  const rTime = await exportSkill({
    execUser: U,
    outputDir: OUT4,
    taskStatuses: ['all'],
    taskSince: '2026-09-01',
    taskUntil: '2026-09-05',
  });
  assert.equal(rTime.stats.exportedTasks, 1); // 仅 T1（双端 inclusive）
  assert.ok(existsSync(join(OUT4, `tasks/${tb(T1)}.md`)));

  const OUT5 = join(env.tmpRoot, 'out5');
  const rSpec = await exportSkill({ execUser: U, outputDir: OUT5, specs: ['user-hbos'] });
  assert.equal(rSpec.stats.exportedSpecs, 1); // 前缀匹配
  assert.ok(existsSync(join(OUT5, 'user/tester__user-hbos.md')));

  const OUT6 = join(env.tmpRoot, 'out6');
  const rTask = await exportSkill({
    execUser: U,
    outputDir: OUT6,
    kinds: ['task'],
    tasks: ['2026-09-20'],
    taskStatuses: ['all'],
  });
  assert.equal(rTask.stats.exportedTasks, 1); // 精确任务 + all 状态
  assert.ok(existsSync(join(OUT6, `tasks/${tb(T2)}.md`)));
});

test('任务深度：prd（无附加节）与 full（原样目录 + README 交叉链接）', async () => {
  const OUTP = join(env.tmpRoot, 'out-prd');
  await exportSkill({ execUser: U, outputDir: OUTP, kinds: ['task'], taskDepth: 'prd' });
  const prd = await readFile(join(OUTP, `tasks/${tb(T1)}.md`), 'utf8');
  assert.ok(!prd.includes('## 过程要点'));
  assert.ok(!prd.includes('## 相关规范'));
  assert.match(prd, /完成 alpha 能力/);

  const OUTF = join(env.tmpRoot, 'out-full');
  await exportSkill({ execUser: U, outputDir: OUTF, taskDepth: 'full' });
  const dir = join(OUTF, `tasks/${tb(T1)}`);
  for (const f of ['prd.md', 'progress.yaml', 'design.md', 'README.md']) {
    assert.ok(existsSync(join(dir, f)), `full 应含 ${f}`);
  }
  const readme = await readFile(join(dir, 'README.md'), 'utf8');
  assert.match(readme, /## 关联项目/);
  assert.match(readme, /\[proj-alpha\]\(\.\.\/\.\.\/spec-catalog\.md#proj-alpha\)/);
  assert.match(readme, /\[Alpha 约定\]\(\.\.\/\.\.\/proj-alpha\/tester__alpha-conv\.md\)/);
  assert.ok(!existsSync(join(OUTF, `tasks/${tb(T1)}.md`)), 'full 不产生单文件形态');
});

test('dry-run：不写盘且给出将写入/将清理清单', async () => {
  const r = await exportSkill({ execUser: U, outputDir: OUT, dryRun: true });
  assert.equal(r.dryRun, true);
  assert.ok(r.written.length > 0);
  assert.ok(!existsSync(OUT), 'dry-run 不应创建目录');

  await exportSkill({ execUser: U, outputDir: OUT });
  const r2 = await exportSkill({
    execUser: U,
    outputDir: OUT,
    dryRun: true,
    prune: true,
    excludeProjects: ['proj-beta'],
  });
  assert.equal(r2.deleted.length, 0);
  assert.ok(
    r2.wouldDelete.some((p) => p.startsWith('proj-beta/')),
    'dry-run 应报告将清理的 beta 文件',
  );
  assert.ok(existsSync(join(OUT, 'proj-beta/tester__beta-conv.md')), 'dry-run 不实际删除');
});

test('幂等 + prune：重复导出跳过、收窄重导清理陈旧（含空目录）', async () => {
  const first = await exportSkill({ execUser: U, outputDir: OUT });
  assert.equal(first.skipped.length, 0);
  const second = await exportSkill({ execUser: U, outputDir: OUT });
  assert.equal(second.written.length, 0);
  assert.ok(second.skipped.length > 0);

  const pruned = await exportSkill({
    execUser: U,
    outputDir: OUT,
    prune: true,
    excludeProjects: ['proj-beta'],
  });
  assert.ok(pruned.deleted.includes('proj-beta/tester__beta-conv.md'));
  assert.ok(pruned.deleted.includes(`tasks/${tb(T3)}.md`));
  assert.ok(!existsSync(join(OUT, 'proj-beta')), '被清空的项目目录应移除');
  assert.ok(existsSync(join(OUT, 'SKILL.md')), '生成文件不应被误删');

  const OUT2 = join(env.tmpRoot, 'out2');
  await exportSkill({ execUser: U, outputDir: OUT2 });
  const narrowed = await exportSkill({
    execUser: U,
    outputDir: OUT2,
    excludeProjects: ['proj-beta'],
  });
  assert.equal(narrowed.deleted.length, 0);
  assert.ok(
    existsSync(join(OUT2, 'proj-beta/tester__beta-conv.md')),
    '无 prune 时旧文件保留（快照语义）',
  );
});

test('写入安全闸：非空默认拒绝；--overwrite 覆盖合并；--clean 清空重导；互斥校验', async () => {
  const OUT2 = join(env.tmpRoot, 'out2');
  await putFile(join(OUT2, 'junk.txt'), 'x');
  // 非空且非本工具管理 → 默认拒绝（dry-run 同样拒绝，保证预演一致）
  await assert.rejects(() => exportSkill({ execUser: U, outputDir: OUT2 }), /非空且非本工具管理/);
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT2, dryRun: true }),
    /非空且非本工具管理/,
  );

  // --overwrite：覆盖合并（无关文件保留 + 正常写入）
  const ow = await exportSkill({ execUser: U, outputDir: OUT2, overwrite: true });
  assert.ok(ow.written.length > 0);
  assert.ok(existsSync(join(OUT2, 'junk.txt')), '--overwrite 不删无关文件');
  assert.ok(existsSync(join(OUT2, 'SKILL.md')));

  // 已含本工具 manifest → 默认增量放行（重复导出工作流）
  const again = await exportSkill({ execUser: U, outputDir: OUT2 });
  assert.equal(again.written.length, 0);
  assert.ok(again.skipped.length > 0);

  // --clean：清空目标后重导
  const OUT3 = join(env.tmpRoot, 'out3');
  await putFile(join(OUT3, 'leftover.txt'), 'x');
  await exportSkill({ execUser: U, outputDir: OUT3, clean: true });
  assert.ok(!existsSync(join(OUT3, 'leftover.txt')), '--clean 清空整个目录');
  assert.ok(existsSync(join(OUT3, 'SKILL.md')));

  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT3, clean: true, prune: true }),
    /互斥/,
  );
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT3, clean: true, overwrite: true }),
    /互斥/,
  );
});

test('verify：v2 校验、篡改/多余检测与历史 v1 目录兼容', async () => {
  await exportSkill({ execUser: U, outputDir: OUT });
  let v = await verifyExport(OUT);
  assert.equal(v.ok, true);

  await putFile(join(OUT, 'user/tester__user-plain.md'), '篡改');
  v = await verifyExport(OUT);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.type === 'hash-mismatch'));

  const OUT2 = join(env.tmpRoot, 'out2');
  await exportSkill({ execUser: U, outputDir: OUT2 });
  await putFile(join(OUT2, 'extra.txt'), 'x');
  v = await verifyExport(OUT2);
  assert.ok(v.issues.some((i) => i.type === 'extra'));

  // legacy v1（lattice-spec-export）目录仍可校验
  const OUT3 = join(env.tmpRoot, 'out3');
  const content = '# 老产物\n';
  const legacyManifest = [
    'exportedAt: 2026-08-19T00:00:00.000Z',
    'tool: lattice-spec-export',
    'version: 1',
    'name: legacy',
    'stats: { global: 0, user: 1, project: 0 }',
    'files:',
    '  - path: user/t__old.md',
    `    hash: ${sha256(content)}`,
    '    title: 老产物',
    '    source: { level: user, user: tester }',
  ].join('\n');
  await putFile(join(OUT3, 'user', 't__old.md'), content);
  await putFile(join(OUT3, 'manifest.yaml'), legacyManifest);
  v = await verifyExport(OUT3);
  assert.equal(v.ok, true);
});

test('参数校验、空结果与 emptyKinds', async () => {
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT, kinds: ['bad'] }),
    /无效的 --only/,
  );
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT, kinds: ['task'], tags: ['x'] }),
    /仅适用于 spec/,
  );
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT, kinds: ['spec'], taskDepth: 'full' }),
    /仅适用于 task/,
  );
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT, taskStatuses: ['bogus'] }),
    /无效 --task-status/,
  );
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT, scope: ['bogus'] }),
    /无效 --scope/,
  );
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT, taskSince: '2026/09/01' }),
    /YYYY-MM-DD/,
  );
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT, skillName: 'Bad_Name' }),
    /kebab-case/,
  );
  await assert.rejects(
    () => exportSkill({ execUser: U, outputDir: OUT, filters: ['不存在的关键词xyz'] }),
    /无匹配内容/,
  );

  // exclude-user：user/project 级被剔除，global 级（无归属用户）豁免
  const r = await exportSkill({ execUser: U, outputDir: OUT, excludeUsers: [U] });
  assert.equal(r.stats.exportedSpecs, 1);
  assert.equal(r.stats.exportedTasks, 0);

  // 类型被选中但为空 → emptyKinds 提示（不报错）
  const OUT2 = join(env.tmpRoot, 'out2');
  const r2 = await exportSkill({ execUser: U, outputDir: OUT2, taskStatuses: ['planning'] });
  assert.deepEqual(r2.emptyKinds, ['task']);
  const taskCatalog = await readFile(join(OUT2, 'task-catalog.md'), 'utf8');
  assert.match(taskCatalog, /无/);
  const skill = await readFile(join(OUT2, 'SKILL.md'), 'utf8');
  assert.match(skill, /task-catalog\.md/);
});
