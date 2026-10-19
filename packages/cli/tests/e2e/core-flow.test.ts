/**
 * CLI 核心命令流 E2E（L3）
 *
 * 覆盖命令矩阵关键路径：init → status → project register/list/where →
 * task create/start/update/checkpoint/progress/list/complete → task delete →
 * trash list/restore → search（FTS 路径，无 embedding 模型）→ doctor → 帮助/错误边界。
 * 由 .temp-docs/regression-*.sh 打印式脚本改写为断言式；agent 分支样例移植，
 * 参数按 master 命令面适配（task create/complete/delete 无 -f；--json 触发 machine 契约）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setupCliEnv, createSampleProject, type CliEnv } from './helpers';

let env: CliEnv;
let projectDir: string;

beforeAll(async () => {
  env = await setupCliEnv();
  projectDir = await createSampleProject(env, 'myapp');
}, 120000);

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

  it('project list --search --keyword-only：按关键词过滤（跳过语义搜索）', async () => {
    const hit = await env.run(['project', 'list', '--search', 'myapp', '--keyword-only']);
    expect(hit.exitCode).toBe(0);
    expect(hit.stdout).toContain('myapp');
  });
});

describe('task 命令域（全生命周期）', () => {
  let taskId: string;

  it('task create --current：创建任务并输出任务 ID 与 PRD 路径', async () => {
    const r = await env.run(['task', 'create', 'E2E 测试任务', '--current'], { cwd: projectDir });
    expect(r.exitCode, r.stderr).toBe(0);
    const m = r.stdout.match(/(\d{4}-\d{2}-\d{2}-[0-9a-z]{4}-\S+)/);
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

  it('task update --status 非法状态：提示合法值且状态不变', async () => {
    const r = await env.run(['task', 'update', taskId, '--status', 'done']);
    expect(r.stdout).toContain('无效状态：done');
    expect(r.stdout).toContain('可选值：planning / in_progress / completed / archived');
    const info = await env.run(['task', 'info', taskId]);
    expect(info.stdout).toContain('in_progress');
  });

  it('task update --status 非法状态（--json）：stderr 提示 + 非零退出（machine 契约）', async () => {
    const r = await env.run(['task', 'update', taskId, '--status', 'done', '--json']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('无效状态：done');
    expect(r.stdout, 'stdout 保持纯净').not.toContain('无效状态');
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

  it('task checkpoint 非法 type（--json）：非零退出并提示可选值', async () => {
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
      '--json',
    ]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('无效的检查点类型');
    expect(r.stderr).toContain('可选值');
  });

  it('task list：项目目录内列出关联任务', async () => {
    const r = await env.run(['task', 'list'], { cwd: projectDir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('E2E 测试任务');
  });

  it('task complete：完成任务', async () => {
    const r = await env.run(['task', 'complete', taskId]);
    expect(r.exitCode, r.stderr).toBe(0);
    const info = await env.run(['task', 'info', taskId]);
    expect(info.stdout).toContain('completed');
  });
});

describe('trash（软删除闭环）', () => {
  let taskId: string;

  beforeAll(async () => {
    const r = await env.run(['task', 'create', '待删除任务', '--current', '-q'], {
      cwd: projectDir,
    });
    expect(r.exitCode, r.stderr).toBe(0);
    taskId = r.stdout.trim();
  }, 30000);

  it('task delete → 进垃圾桶（软删除，任务不再可见）', async () => {
    const del = await env.run(['task', 'delete', taskId]);
    expect(del.exitCode, del.stderr).toBe(0);
    expect(del.stdout).toContain('已移入垃圾桶');
    // machine 契约：--json 下未找到走 stderr + 非零退出
    const info = await env.run(['task', 'info', taskId, '--json']);
    expect(info.exitCode, '删除后 info 应失败').not.toBe(0);
    expect(info.stderr).toContain('未找到任务');
  });

  it('trash list：能看到被删任务；restore 后恢复', async () => {
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
    expect(info.stdout).toContain('待删除任务');
  });

  it('trash restore 不存在的条目：明确提示', async () => {
    const r = await env.run(['trash', 'restore', 'not-exist-entry']);
    expect(r.stdout + r.stderr).toContain('未找到条目');
  });
});

describe('search（FTS 路径，无 embedding 模型）', () => {
  it('search --json：输出 {cols,rows} 表格结构且不崩溃', async () => {
    const r = await env.run(['search', 'myapp', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as { cols: unknown[]; rows: unknown[] };
    expect(Array.isArray(parsed.cols)).toBe(true);
    expect(Array.isArray(parsed.rows)).toBe(true);
  });

  it('无关噪音查询不误报结果', async () => {
    const r = await env.run(['search', '无效查询完全无关XYZ123', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as { rows: unknown[] };
    expect(parsed.rows.length).toBe(0);
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

  it('task info 不存在的 ID：明确报错', async () => {
    const r = await env.run(['task', 'info', '2020-01-01-dead-nonexistent', '--json']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('未找到任务');
  });
});
