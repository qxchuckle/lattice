/**
 * CLI 核心命令流 E2E（L3）
 *
 * 覆盖命令矩阵关键路径：init → status → project register/list/where →
 * task create/start/checkpoint/progress/info/list → task delete → trash list/restore →
 * doctor → search（FTS 路径，无 embedding 模型）→ 帮助/错误边界。
 * 由 .temp-docs/regression-*.sh 打印式脚本改写为断言式。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setupCliEnv, createSampleProject, type CliEnv } from './helpers';

let env: CliEnv;
let projectDir: string;

beforeAll(async () => {
  env = await setupCliEnv();
  projectDir = await createSampleProject(env, 'myapp');
}, 60000);

describe('status / 基础身份', () => {
  it('status --global：init 后显示全局状态与用户名', async () => {
    const r = await env.run(['status', '--global']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('tester');
  });

  it('status（非项目目录）：友好提示而非报错', async () => {
    const r = await env.run(['status']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('不是 Lattice 项目');
  });
});

describe('project 命令域', () => {
  it('project register <path>：注册示例项目', async () => {
    const r = await env.run(['project', 'register', projectDir]);
    expect(r.exitCode, r.stderr).toBe(0);
  });

  it('project list：包含已注册项目', async () => {
    const r = await env.run(['project', 'list']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('myapp');
  });

  it('project where .：在项目目录内解析出项目身份', async () => {
    const r = await env.run(['project', 'where', '.'], { cwd: projectDir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('myapp');
  });

  it('project list --search：按关键词过滤', async () => {
    const hit = await env.run(['project', 'list', '--search', 'myapp']);
    expect(hit.exitCode).toBe(0);
    expect(hit.stdout).toContain('myapp');
  });
});

describe('task 命令域（全生命周期）', () => {
  let taskId: string;

  it('task create：创建任务并输出任务 ID 与 PRD 路径', async () => {
    const r = await env.run(['task', 'create', 'E2E 测试任务', '-f'], { cwd: projectDir });
    expect(r.exitCode, r.stderr).toBe(0);
    const m = r.stdout.match(/(\d{4}-\d{2}-\d{2}-[0-9a-f]{4}-\S*)/);
    expect(m, `输出应含任务 ID：${r.stdout}`).toBeTruthy();
    taskId = m![1];
    expect(r.stdout, '输出 PRD 路径').toContain('prd.md');
  });

  it('task start：状态切换为 in_progress', async () => {
    const r = await env.run(['task', 'start', taskId]);
    expect(r.exitCode, r.stderr).toBe(0);
    const info = await env.run(['task', 'info', taskId]);
    expect(info.stdout).toContain('in_progress');
  });

  it('task checkpoint + progress：结构化进度记录可读回', async () => {
    const cp = await env.run([
      'task',
      'checkpoint',
      taskId,
      '--type',
      'note',
      '--title',
      'E2E 检查点',
      '-m',
      '检查点内容正文',
    ]);
    expect(cp.exitCode, cp.stderr).toBe(0);
    expect(cp.stdout).toMatch(/cp_[0-9a-f]{8}/);

    const progress = await env.run(['task', 'progress', taskId]);
    expect(progress.exitCode).toBe(0);
    expect(progress.stdout).toContain('E2E 检查点');
  });

  it('task checkpoint：非法 type 报错退出', async () => {
    const r = await env.run([
      'task',
      'checkpoint',
      taskId,
      '--type',
      'invalid-type',
      '--title',
      'x',
      '-m',
      'y',
    ]);
    expect(r.exitCode).not.toBe(0);
  });

  it('task list --current：项目目录内列出关联任务', async () => {
    const r = await env.run(['task', 'list'], { cwd: projectDir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('E2E 测试任务');
  });

  it('task complete：完成任务', async () => {
    const r = await env.run(['task', 'complete', taskId, '-f']);
    expect(r.exitCode, r.stderr).toBe(0);
    const info = await env.run(['task', 'info', taskId]);
    expect(info.stdout).toContain('completed');
  });
});

describe('trash（软删除闭环）', () => {
  let taskId: string;

  beforeAll(async () => {
    const r = await env.run(['task', 'create', '待删除任务', '-f']);
    taskId = r.stdout.match(/(\d{4}-\d{2}-\d{2}-[0-9a-f]{4}-\S*)/)![1];
  });

  it('task delete → 进垃圾桶（软删除，任务不再可见）', async () => {
    const del = await env.run(['task', 'delete', taskId, '-f']);
    expect(del.exitCode, del.stderr).toBe(0);
    const info = await env.run(['task', 'info', taskId]);
    expect(info.exitCode, '删除后 info 应失败').not.toBe(0);
  });

  it('trash list：能看到被删任务；用垃圾桶条目 ID restore 后恢复', async () => {
    const list = await env.run(['trash', 'list']);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain('待删除任务');
    // restore 接受的是垃圾桶条目 ID（非任务 ID），从 list 输出解析
    const entryId = list.stdout.match(/ID: (\S+)/)?.[1];
    expect(entryId, `trash list 应输出条目 ID：${list.stdout}`).toBeTruthy();

    const restore = await env.run(['trash', 'restore', entryId!]);
    expect(restore.exitCode, restore.stderr).toBe(0);
    const info = await env.run(['task', 'info', taskId]);
    expect(info.exitCode, '恢复后 info 应成功').toBe(0);
  });

  it('trash restore 不存在的条目 ID：非零退出', async () => {
    const r = await env.run(['trash', 'restore', 'not-exist-entry']);
    expect(r.exitCode).not.toBe(0);
  });
});

describe('search（FTS 路径，无 embedding 模型）', () => {
  it('search --json：返回合法 JSON 且不崩溃', async () => {
    const r = await env.run(['search', 'myapp', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
  });

  it('无关噪音查询不误报高分结果', async () => {
    const r = await env.run(['search', '无效查询完全无关XYZ123', '--json']);
    expect(r.exitCode).toBe(0);
    const results = JSON.parse(r.stdout) as unknown[];
    expect(results.length).toBe(0);
  });
});

describe('doctor / 帮助 / 错误边界', () => {
  it('doctor：健康检查可运行', async () => {
    const r = await env.run(['doctor']);
    expect(r.exitCode, r.stderr).toBe(0);
  });

  it('--help：输出一级命令清单', async () => {
    const r = await env.run(['--help']);
    expect(r.exitCode).toBe(0);
    for (const cmd of ['init', 'project', 'task', 'spec', 'search', 'doctor', 'trash']) {
      expect(r.stdout, `帮助包含 ${cmd}`).toContain(cmd);
    }
  });

  it('未知命令：非零退出', async () => {
    const r = await env.run(['not-a-command']);
    expect(r.exitCode).not.toBe(0);
  });

  it('task info 不存在的 ID：非零退出或明确报错', async () => {
    const r = await env.run(['task', 'info', '2020-01-01-dead-nonexistent']);
    expect(r.exitCode !== 0 || /未找到|不存在/.test(r.stdout + r.stderr)).toBe(true);
  });
});
