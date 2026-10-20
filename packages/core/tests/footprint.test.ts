import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// template-assets 依赖构建期复制的 public/templates；单测直跑 src 时用固定桩，
// 以便验证 footprint 的注入/清除逻辑本身（template-assets 已被覆盖率 exclude）。
vi.mock('../src/template-assets', async () => {
  const { join: pathJoin } = await import('node:path');
  const root = () => pathJoin(process.env.LATTICE_HOME ?? '', '..', 'templates');
  return {
    getBundledTemplateDir: (rel: string, lang = 'zh') => pathJoin(root(), rel, lang),
    getDefaultDocLanguage: () => 'zh',
    getDocLanguageManifest: () => ({ supportedLanguages: ['zh', 'en'], defaultLanguage: 'zh' }),
    renderClaudeCode: (_data?: unknown, lang = 'zh') => `CLAUDE RULES ${lang}`,
    renderCursorRules: (_data?: unknown, lang = 'zh') =>
      `---\ndescription: rules\n---\n\nCURSOR RULES ${lang}`,
    renderWindsurfRules: (_data?: unknown, lang = 'zh') => `WINDSURF RULES ${lang}`,
    renderKiroSteering: (_data?: unknown, lang = 'zh') => `KIRO RULES ${lang}`,
  };
});

import {
  LATTICE_BEGIN_MARKER,
  LATTICE_END_MARKER,
  deployCommandsAsSkills,
  getAIToolConfigs,
  injectLatticeBlock,
  injectToToolRoot,
  listBundledAgentFiles,
  listBundledCommandSkillNames,
  resolveToolPath,
  splitFrontmatter,
  stripLatticeBlock,
} from '../src/injection/footprint';
import { createTempLatticeHome, putFile } from './helpers';

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  const templates = join(env.tmpRoot, 'templates');
  await putFile(join(templates, 'skills', 'zh', 'SKILL.md'), '# skill');
  await putFile(join(templates, 'skills', 'zh', 'lattice-rules.md'), '# rules');
  await putFile(join(templates, 'skills', 'en', 'SKILL.md'), '# English skill');
  await putFile(join(templates, 'commands', 'zh', 'task', 'start.md'), '目标：启动任务\n\n正文');
  await putFile(join(templates, 'commands', 'zh', 'plain.md'), '# 无目标行');
  await putFile(
    join(templates, 'commands', 'en', 'task', 'start.md'),
    '**Goal**: Start a task\n\nBody',
  );
  await putFile(join(templates, 'agents', 'zh', 'lattice-context.md'), '# agent');
  await putFile(join(templates, 'agents', 'en', 'lattice-context.md'), '# agent en');
});

afterEach(async () => {
  await env.cleanup();
});

test('getAIToolConfigs：平台足迹表与路径随 home 注入', () => {
  const home = '/tmp/fake-home';
  const tools = getAIToolConfigs(home);
  const ids = tools.map((t) => t.id);
  assert.deepEqual(ids, [
    'cursor',
    'claude-code',
    'windsurf',
    'kiro',
    'agent',
    'qoder',
    'trae',
    'codex',
  ]);
  for (const tool of tools) {
    assert.ok(tool.rulesPath.startsWith(home), `${tool.id} rules 路径应在 home 下`);
    assert.ok(tool.rulesContent.length > 0);
    assert.equal(tool.language, 'zh');
  }
  const claude = tools.find((t) => t.id === 'claude-code');
  assert.equal(claude?.appendRules, true);
  assert.equal(claude?.extraRules?.length, 1);
  const agent = tools.find((t) => t.id === 'agent');
  assert.equal(agent?.defaultChecked, true);
  assert.deepEqual(agent?.detectPaths, [join(home, '.agent')]);
  assert.equal(tools.find((t) => t.id === 'codex')?.commandsRoot, undefined);
  // 默认 home 分支（不触达文件系统）
  assert.equal(getAIToolConfigs().length, 8);
  // 显式语言
  assert.equal(getAIToolConfigs(home, 'en')[0].language, 'en');
  assert.match(getAIToolConfigs(home, 'en')[0].rulesContent, /en/);
});

test('resolveToolPath：命中 detectPath 时重写到实际根', () => {
  assert.equal(
    resolveToolPath('/home/u/.agents/AGENT.md', '/home/u/.agents', '/home/u/.agent'),
    '/home/u/.agent/AGENT.md',
  );
  assert.equal(
    resolveToolPath('/other/file.md', '/home/u/.agents', '/home/u/.agent'),
    '/other/file.md',
  );
});

test('splitFrontmatter：无 frontmatter / CRLF / 坏块', () => {
  assert.deepEqual(splitFrontmatter('# body'), { frontmatter: '', body: '# body' });
  assert.deepEqual(splitFrontmatter('---\ntitle: x\n---\n\nbody'), {
    frontmatter: '---\ntitle: x\n---\n',
    body: 'body',
  });
  assert.deepEqual(splitFrontmatter('---\r\ntitle: x\r\n---\r\n\r\nbody'), {
    frontmatter: '---\r\ntitle: x\r\n---\r\n',
    body: 'body',
  });
  assert.deepEqual(splitFrontmatter('---\nno close'), {
    frontmatter: '',
    body: '---\nno close',
  });
});

test('injectLatticeBlock/stripLatticeBlock：新建/替换/覆盖/追加/清除', async () => {
  const file = join(env.tmpRoot, 'rules.md');
  const content = '---\ntitle: rules\n---\n\n引导词正文\n';

  // 新建：frontmatter 在最外，正文包标记
  await injectLatticeBlock(file, content, 'overwrite');
  let text = await readFile(file, 'utf-8');
  assert.ok(text.startsWith('---\ntitle: rules\n---\n'));
  assert.ok(text.includes(LATTICE_BEGIN_MARKER));
  assert.ok(text.includes(LATTICE_END_MARKER));
  assert.ok(text.includes('引导词正文'));

  // 已有完整标记 → 只替换块内正文，块外用户内容保留
  await putFile(
    file,
    `用户前置\n${LATTICE_BEGIN_MARKER}\n旧正文\n${LATTICE_END_MARKER}\n用户后置\n`,
  );
  await injectLatticeBlock(file, '新正文', 'append');
  text = await readFile(file, 'utf-8');
  assert.match(text, /用户前置/);
  assert.match(text, /新正文/);
  assert.match(text, /用户后置/);
  assert.ok(!text.includes('旧正文'));

  // 覆盖模式：清掉原内容
  await putFile(file, '旧用户内容');
  await injectLatticeBlock(file, '覆盖正文', 'overwrite');
  text = await readFile(file, 'utf-8');
  assert.ok(!text.includes('旧用户内容'));
  assert.match(text, /覆盖正文/);

  // 追加模式：保留原内容且只有一份 frontmatter 外的块
  await putFile(file, '用户内容\n');
  await injectLatticeBlock(file, '追加正文', 'append');
  text = await readFile(file, 'utf-8');
  assert.match(text, /用户内容\n\n/);
  assert.match(text, /追加正文/);

  // 空文件
  await putFile(file, '   \n');
  await injectLatticeBlock(file, '空文件正文', 'append');
  assert.match(await readFile(file, 'utf-8'), /空文件正文/);

  // strip：无标记原样返回
  assert.deepEqual(stripLatticeBlock('plain'), { content: 'plain', found: false });
  assert.deepEqual(stripLatticeBlock(`${LATTICE_END_MARKER}\n${LATTICE_BEGIN_MARKER}`), {
    content: `${LATTICE_END_MARKER}\n${LATTICE_BEGIN_MARKER}`,
    found: false,
  });

  const stripped = stripLatticeBlock(`前\n${LATTICE_BEGIN_MARKER}\n块\n${LATTICE_END_MARKER}\n后`);
  assert.equal(stripped.found, true);
  assert.match(stripped.content, /前/);
  assert.match(stripped.content, /后/);
  assert.ok(!stripped.content.includes(LATTICE_BEGIN_MARKER));

  const onlyBlock = stripLatticeBlock(
    `---\ntitle: x\n---\n${LATTICE_BEGIN_MARKER}\n块\n${LATTICE_END_MARKER}\n`,
  );
  assert.equal(onlyBlock.found, true);
  assert.equal(onlyBlock.content.trim(), '---\ntitle: x\n---');
});

test('deployCommandsAsSkills/listBundled*：命令转 skill 与模板清单', async () => {
  const commandsDir = join(env.tmpRoot, 'commands');
  await putFile(join(commandsDir, 'task', 'start.md'), '目标：启动任务\n\n正文');
  await putFile(join(commandsDir, 'plain.md'), '# 无目标行');
  await putFile(join(commandsDir, 'goal.md'), '**Goal**: Start with English marker\n\nBody');
  await putFile(
    join(commandsDir, 'frontmatter.md'),
    '---\ndescription: From frontmatter\n---\n\nBody',
  );
  const skillsRoot = join(env.tmpRoot, 'skills');
  const deployed = await deployCommandsAsSkills(commandsDir, skillsRoot);
  assert.deepEqual(deployed.sort(), [
    'lattice-frontmatter',
    'lattice-goal',
    'lattice-plain',
    'lattice-task-start',
  ]);

  const start = await readFile(join(skillsRoot, 'lattice-task-start', 'SKILL.md'), 'utf-8');
  assert.match(start, /name: lattice-task-start/);
  assert.match(start, /description: 启动任务/);
  const goal = await readFile(join(skillsRoot, 'lattice-goal', 'SKILL.md'), 'utf-8');
  assert.match(goal, /description: Start with English marker/);
  const frontmatter = await readFile(join(skillsRoot, 'lattice-frontmatter', 'SKILL.md'), 'utf-8');
  assert.match(frontmatter, /description: From frontmatter/);
  const plain = await readFile(join(skillsRoot, 'lattice-plain', 'SKILL.md'), 'utf-8');
  assert.match(plain, /description: Lattice lattice-plain 命令/);

  const bundledSkills = await listBundledCommandSkillNames();
  assert.deepEqual(bundledSkills.sort(), ['lattice-plain', 'lattice-task-start']);

  const agents = await listBundledAgentFiles();
  assert.deepEqual(agents, ['lattice-context.md']);
});

test('injectToToolRoot：rules/extraRules/skill/commands/agents 全量落盘', async () => {
  const root = join(env.tmpRoot, 'tool-root');
  const tool = {
    id: 'test-tool',
    name: 'Test',
    detectPath: '/virtual/.test-tool',
    rulesPath: '/virtual/.test-tool/RULES.md',
    rulesContent: '---\ntitle: rules\n---\n\n规则正文',
    extraRules: [
      {
        rulesPath: '/virtual/.test-tool/rules/extra.mdc',
        rulesContent: '额外规则',
        appendRules: true,
      },
    ],
    skillPath: '/virtual/.test-tool/skills/lattice/SKILL.md',
    commandsRoot: '/virtual/.test-tool/commands',
    agentsRoot: '/virtual/.test-tool/agents',
  };
  const injected = await injectToToolRoot(tool, root);
  const kinds = injected.map((p) => p.kind);
  assert.ok(kinds.includes('rules'));
  assert.ok(kinds.includes('skill'));
  assert.ok(kinds.includes('commands'));
  assert.ok(kinds.includes('agents'));
  assert.ok(injected.some((p) => p.path.includes('extra.mdc')));

  const rules = await readFile(join(root, 'RULES.md'), 'utf-8');
  assert.match(rules, /规则正文/);
  const extra = await readFile(join(root, 'rules', 'extra.mdc'), 'utf-8');
  assert.match(extra, /额外规则/);
});

test('injectToToolRoot：codex 将 commands 转为独立 skills', async () => {
  const root = join(env.tmpRoot, 'codex-root');
  const codex = getAIToolConfigs(env.tmpRoot).find((t) => t.id === 'codex');
  assert.ok(codex);
  const injected = await injectToToolRoot(codex, root);
  assert.ok(injected.some((p) => p.kind === 'cmd-skill'));
  assert.ok(injected.some((p) => p.kind === 'skill'));
});

test('injectToToolRoot：按 en 语言包落盘 skill/commands/agents/rules', async () => {
  const root = join(env.tmpRoot, 'en-root');
  const tool = getAIToolConfigs(env.tmpRoot, 'en').find((t) => t.id === 'cursor');
  assert.ok(tool);
  await injectToToolRoot(tool, root);

  assert.match(
    await readFile(join(root, 'skills', 'lattice', 'SKILL.md'), 'utf-8'),
    /English skill/,
  );
  assert.match(
    await readFile(join(root, 'skills', 'lattice', 'lattice-rules.md'), 'utf-8'),
    /CLAUDE RULES en/,
  );
  assert.match(
    await readFile(join(root, 'commands', 'lattice', 'task', 'start.md'), 'utf-8'),
    /Goal/,
  );
  assert.match(await readFile(join(root, 'agents', 'lattice-context.md'), 'utf-8'), /agent en/);
});
