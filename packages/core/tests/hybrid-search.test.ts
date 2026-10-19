import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { initDb, closeDb, hybridSearch, upsertFtsEntry, upsertSpecSearchMeta } from '../src/index';
import type { SearchDocumentMeta, SearchDocumentType } from '../src/types';
import { createTempLatticeHome, putFile } from './helpers';

/**
 * hybridSearch 混合检索单测（此前 0% 覆盖）：
 * 用 FTS 语料直写（upsertFtsEntry + upsertSpecSearchMeta）构造受控文档集，
 * 覆盖：标题 boost / 精确短语豁免 / 中文 ngram / 类型与项目过滤 / limit /
 * minFinalScore / 同名聚合 / type·scope 硬加权 / rerank 开关 / weakMatch /
 * normalizedScore / 任务·检查点·关系 meta 解析。语义检索离线降级（allowRemoteModels=false）。
 */

const U = 'u';

let env;

beforeEach(async () => {
  env = await createTempLatticeHome();
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({ username: U }),
  );
  // 硬离线：语义检索降级为 []，测试只依赖 FTS/fallback 确定性路径
  await putFile(
    join(env.latticeHome, 'config', 'config.json'),
    JSON.stringify({ rag: { embedding: { allowRemoteModels: false } } }),
  );
  await initDb();
});

afterEach(async () => {
  closeDb();
  await env.cleanup();
});

function addDoc(d: {
  path: string;
  title: string;
  content: string;
  tags?: string;
  type?: SearchDocumentType;
  username?: string;
  projectIds?: string[];
  meta?: Partial<SearchDocumentMeta>;
}) {
  const pids = d.projectIds ?? [];
  upsertFtsEntry({
    file_path: d.path,
    title: d.title,
    content: d.content,
    tags: d.tags ?? '',
    source_type: d.type ?? 'spec',
    username: d.username ?? U,
    // 与 encodeProjectIds 同格式：|id1|id2|
    project_id: pids.length > 0 ? `|${pids.join('|')}|` : '',
  });
  upsertSpecSearchMeta({
    filePath: d.path,
    docKind: d.meta?.docKind ?? 'spec',
    specId: d.meta?.specId,
    tags: d.meta?.tags ?? [],
    headings: d.meta?.headings ?? [],
    keywords: d.meta?.keywords ?? [],
    titleTerms: d.meta?.titleTerms ?? [],
    pathTerms: d.meta?.pathTerms ?? [],
    scopeKey: d.meta?.scopeKey ?? '',
    scopeTerms: d.meta?.scopeTerms ?? [],
    domainTerms: d.meta?.domainTerms ?? [],
    metaHash: d.meta?.metaHash ?? 'hash',
  });
}

test('标题精确命中：TITLE_EXACT_BOOST 排序第一 + normalizedScore/weakMatch 归一', async () => {
  const pathA = join(env.latticeHome, 'users', U, 'spec', 'a.md');
  const pathB = join(env.latticeHome, 'users', U, 'spec', 'b.md');
  addDoc({ path: pathA, title: 'Playwright 指南', content: '正文甲' });
  addDoc({ path: pathB, title: '其他文档', content: 'Playwright 指南相关内容正文' });

  const results = await hybridSearch('Playwright 指南');
  assert.ok(results.length >= 2);
  assert.equal(results[0].meta.filePath, pathA, '标题精确命中应排第一');
  assert.ok((results[0].meta.titleBoost as number) > 0.4);
  assert.equal(results[0].meta.normalizedScore, 1);
  assert.equal(results[0].meta.weakMatch, false);
  assert.ok((results[1].meta.normalizedScore as number) < 1);
});

test('精确短语命中：phraseBoost 加分且豁免 minFinalScore', async () => {
  const exact = join(env.latticeHome, 'users', U, 'spec', 'exact.md');
  const fuzzy = join(env.latticeHome, 'users', U, 'spec', 'fuzzy.md');
  addDoc({ path: exact, title: '排错手册', content: '遇到错误码 404 时按本文处理' });
  addDoc({ path: fuzzy, title: '排错手册二', content: '错误码与 404 分开出现' });

  const results = await hybridSearch('错误码 404');
  const hit = results.find((r) => r.meta.filePath === exact);
  assert.ok(hit, '精确短语文档应命中');
  assert.ok((hit.meta.phraseBoost as number) > 0, 'phraseBoost 应 > 0');

  // minFinalScore 极高时，精确短语文档仍豁免保留
  const strict = await hybridSearch('错误码 404', { minFinalScore: 0.99 });
  assert.ok(strict.some((r) => r.meta.filePath === exact));
});

test('中文 ngram 变体命中（3-gram 走 FTS）', async () => {
  const path = join(env.latticeHome, 'users', U, 'spec', 'cn.md');
  addDoc({ path, title: '前端开发规范', content: '项目前端开发约定' });

  const results = await hybridSearch('前端开发');
  const hit = results.find((r) => r.meta.filePath === path);
  assert.ok(hit, '中文查询应命中');
  assert.ok((hit.meta.sources as string[]).includes('fts'));
});

test('类型过滤：spec 精确；task 域包含 design', async () => {
  const p = env.latticeHome;
  addDoc({
    path: join(p, 'users', U, 'spec', 's.md'),
    title: '过滤目标甲',
    content: '过滤目标甲',
    type: 'spec',
  });
  addDoc({
    path: join(p, 'users', U, 'task', '2026-01-01-aaaa', 'task.json'),
    title: '过滤目标乙',
    content: '过滤目标乙',
    type: 'task',
  });
  addDoc({
    path: join(p, 'users', U, 'task', '2026-01-01-aaaa', 'design.md'),
    title: '过滤目标丙',
    content: '过滤目标丙',
    type: 'design',
  });
  addDoc({
    path: join(p, 'users', U, 'projects', 'p1', 'project.json'),
    title: '过滤目标丁',
    content: '过滤目标丁',
    type: 'project',
  });

  const specs = await hybridSearch('过滤目标', { type: 'spec' });
  assert.deepEqual(
    specs.map((r) => r.type),
    ['spec'],
  );

  const tasks = await hybridSearch('过滤目标', { type: 'task' });
  const types = tasks.map((r) => r.type).sort();
  assert.deepEqual(types, ['design', 'task'], 'task 域应包含 design');
});

test('项目过滤：|id| 边界匹配（存储与查询同前缀）', async () => {
  const p = env.latticeHome;
  addDoc({
    path: join(p, 'users', U, 'spec', 'p1.md'),
    title: '项目过滤甲',
    content: '项目过滤甲',
    projectIds: ['legacy:proj1'],
  });
  addDoc({
    path: join(p, 'users', U, 'spec', 'p2.md'),
    title: '项目过滤乙',
    content: '项目过滤乙',
    projectIds: ['proj2'],
  });

  const hit1 = await hybridSearch('项目过滤', { projectId: 'legacy:proj1' });
  assert.deepEqual(
    hit1.map((r) => r.meta.filePath),
    [join(p, 'users', U, 'spec', 'p1.md')],
  );

  const hit2 = await hybridSearch('项目过滤', { projectId: 'proj2' });
  assert.deepEqual(
    hit2.map((r) => r.meta.filePath),
    [join(p, 'users', U, 'spec', 'p2.md')],
  );

  const none = await hybridSearch('项目过滤', { projectId: 'git:other' });
  assert.equal(none.length, 0);
});

test('limit 截断作用于去重后结果', async () => {
  for (let i = 0; i < 5; i++) {
    addDoc({
      path: join(env.latticeHome, 'users', U, 'spec', `lim-${i}.md`),
      title: `限量文档${i}`,
      content: `限量查询目标 ${i}`,
    });
  }
  const results = await hybridSearch('限量查询目标', { limit: 2 });
  assert.equal(results.length, 2);
});

test('minFinalScore：弱候选剔除；置 0 时保留并标 weakMatch', async () => {
  const p = env.latticeHome;
  const weak = join(p, 'users', U, 'spec', 'weak.md');
  // 子串跨 token 边界：FTS 不命中（token=xzzqtargetx），仅 fallback LIKE 命中
  addDoc({ path: weak, title: '无关标题', content: '内容前缀 xzzqtargetx 后缀' });

  const filtered = await hybridSearch('zzqtarget');
  assert.equal(
    filtered.find((r) => r.meta.filePath === weak),
    undefined,
    '弱候选应被默认阈值剔除',
  );

  const kept = await hybridSearch('zzqtarget', { minFinalScore: 0 });
  const hit = kept.find((r) => r.meta.filePath === weak);
  assert.ok(hit, '阈值置 0 应保留 fallback 命中');
  assert.ok(hit.meta.fallbackRank, '应为 fallback 命中');
  assert.equal(hit.meta.weakMatch, true, '低绝对分应标 weakMatch');
  assert.equal(hit.meta.normalizedScore, 1);
});

test('同名聚合：同类型同标题合并，duplicates 记录被并入条目', async () => {
  const p = env.latticeHome;
  const dupA = join(p, 'users', U, 'projects', 'pA', 'spec', 'x.md');
  const dupB = join(p, 'users', U, 'projects', 'pB', 'spec', 'x.md');
  addDoc({ path: dupA, title: '同名规范', content: '同名规范查询目标', projectIds: ['legacy:pA'] });
  addDoc({ path: dupB, title: '同名规范', content: '同名规范查询目标', projectIds: ['legacy:pB'] });

  const results = await hybridSearch('同名规范查询目标');
  const heads = results.filter((r) => r.title === '同名规范');
  assert.equal(heads.length, 1, '同类型同标题应合并为一条');
  assert.equal(heads[0].meta.duplicateCount, 1);
  const duplicates = heads[0].meta.duplicates as { filePath: string }[];
  assert.equal(duplicates[0].filePath, dupB);
});

test('硬加权：relation typeWeight=0.7；spec scope project>user>global', async () => {
  const p = env.latticeHome;
  const relPath = join(p, 'users', U, 'relation', 'rel-1');
  addDoc({ path: relPath, title: '加权关系条目', content: '加权查询目标', type: 'relation' });

  const specProject = join(p, 'users', U, 'projects', 'p1', 'spec', 'scope.md');
  const specUser = join(p, 'users', U, 'spec', 'scope.md');
  const specGlobal = join(p, 'spec', 'scope.md');
  addDoc({ path: specProject, title: '范围指南甲', content: '范围查询目标' });
  addDoc({ path: specUser, title: '范围指南乙', content: '范围查询目标' });
  addDoc({ path: specGlobal, title: '范围指南丙', content: '范围查询目标' });

  const rel = await hybridSearch('加权查询目标');
  assert.equal(rel[0].meta.typeWeight, 0.7);

  const scoped = await hybridSearch('范围查询目标');
  const byPath = new Map(scoped.map((r) => [r.meta.filePath, r]));
  assert.equal(byPath.get(specProject).meta.scopeWeight, 1.1);
  assert.equal(byPath.get(specUser).meta.scopeWeight, 1);
  assert.equal(byPath.get(specGlobal).meta.scopeWeight, 0.95);
  const order = scoped.map((r) => r.meta.filePath);
  assert.ok(
    order.indexOf(specProject) < order.indexOf(specUser) &&
      order.indexOf(specUser) < order.indexOf(specGlobal),
    `scope 权重排序应为 project>user>global，实际：${order.join(' | ')}`,
  );
});

test('rerank 开关：默认启用（关键词权重加分）；关闭后 rerankBoost=0', async () => {
  const path = join(env.latticeHome, 'users', U, 'spec', 'rerank.md');
  addDoc({
    path,
    title: '命中词重排',
    content: '重排查询目标正文',
    meta: { keywords: ['命中词'], docKind: 'spec' },
  });

  const on = await hybridSearch('命中词', { useLightweightRerank: true });
  assert.equal(on[0].meta.rerankEnabled, true);
  assert.ok((on[0].meta.rerankBoost as number) > 0);
  assert.ok((on[0].meta.matchedKeywords as string[]).includes('命中词'));

  const off = await hybridSearch('命中词', { useLightweightRerank: false });
  assert.equal(off[0].meta.rerankEnabled, false);
  assert.equal(off[0].meta.rerankBoost, 0);
});

test('无命中返回空数组', async () => {
  const results = await hybridSearch('绝不存在的查询词xyzzy');
  assert.deepEqual(results, []);
});

test('后处理 meta：taskId / checkpointId / relationId 从路径解析', async () => {
  const p = env.latticeHome;
  const taskId = '2026-01-01-aaaa';
  addDoc({
    path: join(p, 'users', U, 'task', taskId, 'task.json'),
    title: '元数据任务',
    content: '元数据查询目标',
    type: 'task',
  });
  addDoc({
    path: join(p, 'users', U, 'task', taskId, 'checkpoint', 'cp-1234', 'progress.yaml'),
    title: '元数据检查点',
    content: '元数据查询目标',
    type: 'checkpoint',
  });
  addDoc({
    path: join(p, 'users', U, 'relation', 'rel-9'),
    title: '元数据关系',
    content: '元数据查询目标',
    type: 'relation',
  });

  const results = await hybridSearch('元数据查询目标');
  const byType = new Map(results.map((r) => [r.type, r]));
  assert.equal(byType.get('task').meta.taskId, taskId);
  assert.equal(byType.get('checkpoint').meta.taskId, taskId);
  assert.equal(byType.get('checkpoint').meta.checkpointId, 'cp-1234');
  assert.equal(byType.get('relation').meta.relationId, 'rel-9');
});

test('语义检索离线降级：结果来自 fts/fallback，无 semantic 贡献', async () => {
  const path = join(env.latticeHome, 'users', U, 'spec', 'offline.md');
  addDoc({ path, title: '离线检索文档', content: '离线检索目标正文' });

  const results = await hybridSearch('离线检索目标', { minFinalScore: 0 });
  assert.equal(results.length, 1);
  const sources = results[0].meta.sources as string[];
  assert.ok(sources.includes('fts'), '应有 fts 贡献');
  assert.ok(!sources.includes('semantic'), '语义离线不应有 semantic 贡献');
  assert.equal(results[0].meta.semanticRank, null);
});
