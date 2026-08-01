/**
 * 产品约定目录资源扫描测试（QoderSource 的目录约定发现路径，临时目录 fixtures）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scanCommandDir,
  scanFlatMdDir,
  scanSkillDir,
  filterKinds,
  parseFrontmatterAttrs,
} from '../src/resource-scan.js';
import type { SourceResourceInfo } from '@qcqx/lattice-agent-protocol';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'qoder-scan-'));
  // commands：嵌套目录（对齐 ~/.qoder/commands/lattice/task/start.md 形态）
  await mkdir(join(root, 'commands', 'lattice', 'task'), { recursive: true });
  await writeFile(join(root, 'commands', 'lattice', 'task', 'start.md'), '# /lattice/task/start');
  // agents：frontmatter 带 name/description
  await mkdir(join(root, 'agents'), { recursive: true });
  await writeFile(
    join(root, 'agents', 'my-agent.md'),
    '---\nname: my-agent\ndescription: 子代理描述\n---\n\n正文',
  );
  // skills：SKILL.md 目录形态
  await mkdir(join(root, 'skills', 'lattice'), { recursive: true });
  await writeFile(
    join(root, 'skills', 'lattice', 'SKILL.md'),
    '---\nname: lattice\ndescription: skill 描述\n---\n\n正文',
  );
  // rules：.md + .mdc 均识别
  await mkdir(join(root, 'rules'), { recursive: true });
  await writeFile(join(root, 'rules', 'style.mdc'), '规则正文首行');
});

describe('resource-scan', () => {
  it('scanCommandDir：name = 相对路径，scope 透传', () => {
    const out = scanCommandDir(join(root, 'commands'), 'user');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('lattice/task/start');
    expect(out[0].kind).toBe('command');
    expect(out[0].scope).toBe('user');
    expect(out[0].path).toContain('start.md');
  });

  it('scanFlatMdDir：agent frontmatter 解析；rule 识别 .mdc', () => {
    const agents = scanFlatMdDir(join(root, 'agents'), 'agent', 'user');
    expect(agents[0]).toMatchObject({ kind: 'agent', name: 'my-agent', description: '子代理描述' });

    const rules = scanFlatMdDir(join(root, 'rules'), 'rule', 'project');
    expect(rules[0]).toMatchObject({ kind: 'rule', name: 'style', scope: 'project' });
    expect(rules[0].description).toBe('规则正文首行');
  });

  it('scanSkillDir：SKILL.md 目录形态', () => {
    const skills = scanSkillDir(join(root, 'skills'), 'user');
    expect(skills[0]).toMatchObject({ kind: 'skill', name: 'lattice', description: 'skill 描述' });
    expect(skills[0].path).toContain('SKILL.md');
  });

  it('目录不存在返回空（契约：不抛错）', () => {
    expect(scanCommandDir('/no/such', 'user')).toEqual([]);
    expect(scanSkillDir('/no/such', 'user')).toEqual([]);
  });

  it('filterKinds：缺省全部，指定时过滤', () => {
    const list: SourceResourceInfo[] = [
      { kind: 'command', name: 'a' },
      { kind: 'rule', name: 'b' },
    ];
    expect(filterKinds(list)).toHaveLength(2);
    expect(filterKinds(list, ['rule'])).toEqual([{ kind: 'rule', name: 'b' }]);
  });

  it('parseFrontmatterAttrs：无 frontmatter / 未闭合返回空对象', () => {
    expect(parseFrontmatterAttrs('正文')).toEqual({});
    expect(parseFrontmatterAttrs('---\na: 1')).toEqual({});
    expect(parseFrontmatterAttrs("---\nname: 'x'\n---\n")).toEqual({ name: 'x' });
  });
});
