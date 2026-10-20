import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAIToolConfigs, injectLatticeBlock, injectToToolRoot } from '../src/injection/footprint';
import { executeUninjectPlan, scanInjections } from '../src/injection/uninject';
import { createTempLatticeHome, putFile } from './helpers';

vi.mock('../src/template-assets', async () => {
  const { join: pathJoin } = await import('node:path');
  const root = () => pathJoin(process.env.LATTICE_HOME ?? '', '..', 'templates');
  return {
    getBundledTemplateDir: (rel: string, lang = 'zh') => pathJoin(root(), rel, lang),
    getDefaultDocLanguage: () => 'zh',
    getDocLanguageManifest: () => ({ supportedLanguages: ['zh', 'en'], defaultLanguage: 'zh' }),
    renderClaudeCode: () => 'CLAUDE RULES',
    renderCursorRules: () => '---\ndescription: rules\n---\n\nCURSOR RULES',
    renderWindsurfRules: () => 'WINDSURF RULES',
    renderKiroSteering: () => 'KIRO RULES',
  };
});

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;
let toolHome: string;

beforeEach(async () => {
  env = await createTempLatticeHome();
  toolHome = join(env.tmpRoot, 'home');
  const templates = join(env.tmpRoot, 'templates');
  await putFile(join(templates, 'skills', 'zh', 'SKILL.md'), '# skill');
  await putFile(join(templates, 'skills', 'en', 'SKILL.md'), '# skill en');
  await putFile(join(templates, 'commands', 'zh', 'task', 'start.md'), '目标：启动任务\n');
  await putFile(join(templates, 'commands', 'en', 'task', 'start.md'), '**Goal**: Start a task\n');
  await putFile(join(templates, 'agents', 'zh', 'lattice-context.md'), '# agent');
  await putFile(join(templates, 'agents', 'en', 'lattice-context.md'), '# agent en');
});

afterEach(async () => {
  await env.cleanup();
});

test('scanInjections：空目录无发现；toolIds 过滤', async () => {
  assert.deepEqual(await scanInjections({ home: toolHome }), {
    findings: [],
    scannedRoots: [],
  });
  assert.deepEqual(
    (await scanInjections({ home: toolHome, toolIds: ['cursor'] })).scannedRoots,
    [],
  );
});

test('scan+execute：注入后全量识别并清除（rules/skill/commands/agents）', async () => {
  const cursor = getAIToolConfigs(toolHome).find((t) => t.id === 'cursor');
  assert.ok(cursor);
  await injectToToolRoot(cursor, cursor.detectPath);

  const plan = await scanInjections({ home: toolHome });
  const kinds = plan.findings.map((f) => f.kind);
  assert.ok(kinds.includes('rules'));
  assert.ok(kinds.includes('skill-dir'));
  assert.ok(kinds.includes('commands-dir'));
  assert.ok(kinds.includes('agents-file'));
  const rulesFinding = plan.findings.find((f) => f.kind === 'rules');
  assert.equal(rulesFinding?.action, 'delete-file');

  const result = await executeUninjectPlan(plan);
  assert.ok(result.deletedFiles.length >= 2);
  assert.ok(result.deletedDirs.length >= 2);
  assert.deepEqual((await scanInjections({ home: toolHome })).findings, []);
});

test('rules 保留用户内容：remove-block 而非删文件', async () => {
  const cursor = getAIToolConfigs(toolHome).find((t) => t.id === 'cursor');
  assert.ok(cursor);
  await putFile(cursor.rulesPath, '用户前置内容\n');
  await injectLatticeBlock(cursor.rulesPath, '注入正文', 'append');

  const plan = await scanInjections({ home: toolHome, toolIds: ['cursor'] });
  const finding = plan.findings.find((f) => f.kind === 'rules');
  assert.equal(finding?.action, 'remove-block');

  const result = await executeUninjectPlan(plan);
  assert.ok(result.removedBlocks.includes(cursor.rulesPath));
  const left = await readFile(cursor.rulesPath, 'utf-8');
  assert.match(left, /用户前置内容/);
  assert.ok(!left.includes('注入正文'));

  // 无标记文件不被识别
  await putFile(cursor.rulesPath, '纯用户内容');
  assert.deepEqual(
    (await scanInjections({ home: toolHome, toolIds: ['cursor'] })).findings.filter(
      (f) => f.kind === 'rules',
    ),
    [],
  );
});

test('多候选根与 extraRules：agent/claude 全部识别', async () => {
  const tools = getAIToolConfigs(toolHome);
  const claude = tools.find((t) => t.id === 'claude-code');
  const agent = tools.find((t) => t.id === 'agent');
  assert.ok(claude && agent);
  await injectToToolRoot(claude, claude.detectPath);
  await injectToToolRoot(agent, agent.detectPath);
  await injectToToolRoot(agent, join(toolHome, '.agent'));

  const plan = await scanInjections({ home: toolHome, toolIds: ['claude-code', 'agent'] });
  assert.ok(plan.scannedRoots.includes(claude.detectPath));
  assert.ok(plan.scannedRoots.includes(agent.detectPath));
  assert.ok(plan.scannedRoots.includes(join(toolHome, '.agent')));

  const claudeRules = plan.findings.filter((f) => f.toolId === 'claude-code' && f.kind === 'rules');
  assert.ok(claudeRules.length >= 2, '主 rules + extraRules 都应被识别');
  assert.ok(plan.findings.some((f) => f.toolId === 'agent' && f.targetRoot.endsWith('.agent')));

  const result = await executeUninjectPlan(plan);
  assert.ok(result.deletedDirs.length > 0);
  assert.deepEqual((await scanInjections({ home: toolHome })).findings, []);
});

test('en 语言包注入后：uninject 仍按同一路径/名单全量清除', async () => {
  const cursor = getAIToolConfigs(toolHome, 'en').find((t) => t.id === 'cursor');
  assert.ok(cursor);
  await injectToToolRoot(cursor, cursor.detectPath);

  const plan = await scanInjections({ home: toolHome, toolIds: ['cursor'] });
  assert.ok(plan.findings.some((f) => f.kind === 'skill-dir'));
  assert.ok(plan.findings.some((f) => f.kind === 'commands-dir'));
  assert.ok(plan.findings.some((f) => f.kind === 'agents-file'));

  await executeUninjectPlan(plan);
  assert.deepEqual((await scanInjections({ home: toolHome, toolIds: ['cursor'] })).findings, []);
});

test('codex：commands 转化的 skill 目录按名单精确清除', async () => {
  const codex = getAIToolConfigs(toolHome).find((t) => t.id === 'codex');
  assert.ok(codex);
  await injectToToolRoot(codex, codex.detectPath);
  const plan = await scanInjections({ home: toolHome, toolIds: ['codex'] });
  assert.ok(plan.findings.some((f) => f.kind === 'codex-skill-dir'));
  // 用户自建 lattice-* skill 不在 bundled 名单内 → 保留
  const custom = join(codex.detectPath, 'skills', 'lattice-custom');
  await putFile(join(custom, 'SKILL.md'), '# custom');
  const result = await executeUninjectPlan(plan);
  assert.ok(result.deletedDirs.some((p) => p.includes('lattice-task-start')));
  const after = await scanInjections({ home: toolHome, toolIds: ['codex'] });
  assert.ok(!after.findings.some((f) => f.path.includes('lattice-custom')));
  assert.ok(await readFile(join(custom, 'SKILL.md'), 'utf-8'));
});
