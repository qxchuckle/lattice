/**
 * 契约测试共享 fixture：最小可用的 ~/.lattice 数据根。
 *
 * 同一份 fixture 被三路契约测试复用：
 * - services 直调（packages/services/tests/contract.test.ts）
 * - web HTTP 绑定（packages/web/tests/contract.test.ts）
 * - vscode bridge 绑定（packages/vscode/tests/unit/bridge-contract.test.ts）
 * 任一绑定与 services 的形状漂移都会在这里被抓住。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Fixture {
  home: string;
  workspace: string;
  cleanup(): void;
}

export function createFixtureHome(): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'lattice-contract-'));
  const workspace = join(home, 'workspace');
  mkdirSync(workspace, { recursive: true });

  // 用户（username 存本地配置）
  mkdirSync(join(home, 'config'), { recursive: true });
  writeFileSync(join(home, 'config', 'config-local.json'), JSON.stringify({ username: 'tester' }));

  // 项目 alpha（localPaths 指向 workspace，供 anchor/路径匹配）
  const projectDir = join(home, 'users', 'tester', 'projects', 'alpha');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'project.json'),
    JSON.stringify({
      id: 'alpha',
      ids: ['alpha'],
      name: 'Alpha Project',
      description: 'contract fixture',
      localPaths: [workspace],
      gitRemotes: [],
      packageNames: ['alpha'],
      created: '2026-01-01T00:00:00.000Z',
    }),
  );

  // 任务（含 PRD + checkpoint）
  const taskDir = join(home, 'users', 'tester', 'tasks', 'task-alpha-1');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    join(taskDir, 'task.json'),
    JSON.stringify({
      id: 'task-alpha-1',
      title: 'Alpha task',
      status: 'in_progress',
      projects: ['alpha'],
      scopePaths: [{ path: workspace, addedAt: '2026-01-01T00:00:00.000Z' }],
      referencedSpecs: [{ id: 'spec-aaaa0001', relativePath: 'alpha-spec.md', scope: 'user' }],
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
    }),
  );
  writeFileSync(join(taskDir, 'prd.md'), '# Alpha task\n\nContract fixture PRD.\n');
  writeFileSync(
    join(taskDir, 'progress.yaml'),
    [
      'entries:',
      '  - id: cp-alpha-1',
      '    time: "2026-01-02T00:00:00.000Z"',
      '    type: decision',
      '    title: Fixture checkpoint',
      '    message: hello',
      '',
    ].join('\n'),
  );

  // spec 三层（global / user / project）
  mkdirSync(join(home, 'spec'), { recursive: true });
  writeFileSync(
    join(home, 'spec', 'global-spec.md'),
    '---\nid: spec-cccc0003\ntitle: Global spec\n---\n\nglobal body\n',
  );
  mkdirSync(join(home, 'users', 'tester', 'spec'), { recursive: true });
  writeFileSync(
    join(home, 'users', 'tester', 'spec', 'alpha-spec.md'),
    '---\nid: spec-aaaa0001\ntitle: User spec\n---\n\nuser spec body\n',
  );
  mkdirSync(join(projectDir, 'spec'), { recursive: true });
  writeFileSync(
    join(projectDir, 'spec', 'project-spec.md'),
    '---\nid: spec-bbbb0002\ntitle: Project spec\n---\n\nproject spec body\n',
  );

  // 项目关系（alpha → beta）
  writeFileSync(
    join(home, 'users', 'tester', 'relations.json'),
    JSON.stringify({
      version: 1,
      relations: [
        {
          id: 'rel-1',
          type: 'depends-on',
          projectA: 'alpha',
          projectB: 'beta',
          description: 'contract relation',
          createdBy: 'manual',
          created: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
  );

  return {
    home,
    workspace,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}
