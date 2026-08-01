/**
 * 资源扫描 + WorkflowEngine 本地命令测试（临时目录 fixtures，不触碰真实用户目录）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../src/events/event-bus.js';
import { WorkflowEngine } from '../src/workflow/workflow-engine.js';
import { scanLocalCommands, stripFrontmatter } from '../src/workflow/command-scan.js';

let latticeHome: string;
let cmdsDir: string;
let projectCwd: string;
let prevLatticeHome: string | undefined;

beforeAll(async () => {
  latticeHome = await mkdtemp(join(tmpdir(), 'lattice-cmds-'));
  cmdsDir = join(latticeHome, 'agent', 'commands');
  await mkdir(cmdsDir, { recursive: true });
  // 用户级：嵌套目录命令（name = 相对路径）
  await mkdir(join(cmdsDir, 'lattice', 'task'), { recursive: true });
  await writeFile(
    join(cmdsDir, 'lattice', 'task', 'start.md'),
    '# /lattice/task/start\n\n开始一个任务的模板正文',
  );
  // frontmatter 覆盖 name/description/argument-hint
  await writeFile(
    join(cmdsDir, 'custom.md'),
    '---\ndescription: 自定义命令\nargument-hint: <id>\n---\n\n命令正文',
  );

  projectCwd = await mkdtemp(join(tmpdir(), 'lattice-proj-'));
  await mkdir(join(projectCwd, '.lattice', 'commands'), { recursive: true });
  // 项目级同名覆盖用户级
  await writeFile(join(projectCwd, '.lattice', 'commands', 'custom.md'), '项目级正文');

  // 设置 LATTICE_HOME 指向测试目录
  prevLatticeHome = process.env.LATTICE_HOME;
  process.env.LATTICE_HOME = latticeHome;
});

afterAll(async () => {
  if (prevLatticeHome === undefined) delete process.env.LATTICE_HOME;
  else process.env.LATTICE_HOME = prevLatticeHome;
  await rm(latticeHome, { recursive: true, force: true });
  await rm(projectCwd, { recursive: true, force: true });
});

describe('scanLocalCommands', () => {
  it('递归扫描：name = 相对路径去 .md，描述取首行标题', () => {
    const cmds = scanLocalCommands(cmdsDir, 'user');
    const start = cmds.find((c) => c.name === 'lattice/task/start');
    expect(start).toBeDefined();
    expect(start!.description).toContain('/lattice/task/start');
    expect(start!.scope).toBe('user');
  });

  it('frontmatter 属性优先：description / argument-hint', () => {
    const cmds = scanLocalCommands(cmdsDir, 'user');
    const custom = cmds.find((c) => c.name === 'custom');
    expect(custom!.description).toBe('自定义命令');
    expect(custom!.argumentHint).toBe('<id>');
  });

  it('目录不存在返回空数组（不抛错）', () => {
    expect(scanLocalCommands('/no/such/dir', 'user')).toEqual([]);
  });
});

describe('stripFrontmatter', () => {
  it('去 frontmatter 保留正文；无 frontmatter 原样', () => {
    expect(stripFrontmatter('---\na: 1\n---\n\n正文')).toBe('正文');
    expect(stripFrontmatter('正文')).toBe('正文');
  });
});

// skills 清单文案的测试已随实现迁至 @qcqx/lattice-agent-pipeline
// （tests/profile.test.ts：formatSkillsAppendix 形态 + 注入通道选择）

describe('WorkflowEngine 本地命令', () => {
  it('loadLocalCommands：用户级 + 项目级，同名项目级覆盖', async () => {
    const engine = new WorkflowEngine(new EventBus(), {
      automation: 'manual',
    });
    const count = engine.loadLocalCommands(projectCwd);
    expect(count).toBeGreaterThanOrEqual(2);

    const resources = engine.listLocalResources();
    const custom = resources.find((r) => r.name === 'custom');
    expect(custom!.scope).toBe('project'); // 项目级覆盖

    // 模板正文读取（去 frontmatter）
    const template = await engine.getCommandTemplate('lattice/task/start');
    expect(template).toContain('开始一个任务的模板正文');
    expect(await engine.getCommandTemplate('custom')).toBe('项目级正文');
    expect(await engine.getCommandTemplate('no-such')).toBeNull();
  });
});
