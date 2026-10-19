/**
 * services 契约测试：同一 fixture 数据根，验证用例层的两种运行模式。
 * - file mode：未初始化 DB（模拟降级宿主）→ 文件真源路径
 * - db mode：initDb 就绪（CLI/web/扩展宿主正常路径）→ 虚拟合并/FTS 路径
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixtureHome } from './fixture';

const fixture = createFixtureHome();
process.env.LATTICE_HOME = fixture.home;

const lattice = await import('../src/index');
const core = await import('@qcqx/lattice-core');

afterAll(() => fixture.cleanup());

test('file mode：文件真源（未初始化 DB）', async () => {
  const projects = await lattice.listProjects('tester');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'Alpha Project');

  const tasks = await lattice.listTasks('tester');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Alpha task');

  const specs = await lattice.listSpecs('tester');
  assert.equal(specs.length, 3);
  assert.deepEqual(specs.map((entry) => entry.scope).sort(), ['global', 'project', 'user']);

  const detail = await lattice.getTaskDetail('tester', 'task-alpha-1');
  assert.equal(detail.task?.title, 'Alpha task');
  assert.equal(detail.progress.length, 1);
  assert.equal(detail.progress[0].id, 'cp-alpha-1');

  const projectDetail = await lattice.getProjectDetail('tester', 'alpha');
  assert.equal(projectDetail.project?.name, 'Alpha Project');
  assert.equal(projectDetail.specs.length, 1);
  assert.equal(projectDetail.tasks.length, 1);
  assert.equal(projectDetail.relations.length, 1);

  const found = await lattice.findSpec('tester', 'spec-aaaa0001');
  assert.equal(found?.spec.frontmatter.title, 'User spec');
  assert.equal(found?.scope, 'user');

  const prd = await lattice.readContent('tester', 'prd', 'task-alpha-1');
  assert.match(prd ?? '', /Contract fixture PRD/);

  const stats = await lattice.getStats('tester');
  assert.deepEqual(stats, {
    projectCount: 1,
    taskCount: 1,
    activeTaskCount: 1,
    relationCount: 1,
  });

  assert.deepEqual(await lattice.detectConflicts('tester', ''), []);

  const where = await lattice.findProjectsByPath('tester', fixture.workspace);
  assert.equal(where.exact?.name, 'Alpha Project');
});

test('db mode：DB 就绪后行为一致（虚拟合并 / 搜索路径）', async () => {
  await core.initDb();
  try {
    const projects = await lattice.listProjects('tester');
    assert.equal(projects.length, 1);
    assert.ok((projects[0].ids ?? []).length >= 1);

    const found = await lattice.findSpec('tester', 'spec-aaaa0001');
    assert.equal(found?.spec.frontmatter.title, 'User spec');

    const detail = await lattice.getTaskDetail('tester', 'task-alpha-1');
    assert.equal(detail.task?.title, 'Alpha task');
  } finally {
    core.closeDb();
  }
});

test('mutations：associateTask / addTaskSpecRefs 落盘（拖拽联动的数据面）', async () => {
  // 现场创建第二个项目 beta（不影响其它用例的计数断言）
  const betaDir = join(fixture.home, 'users', 'tester', 'projects', 'beta');
  mkdirSync(betaDir, { recursive: true });
  writeFileSync(
    join(betaDir, 'project.json'),
    JSON.stringify({
      id: 'beta',
      ids: ['beta'],
      name: 'Beta Project',
      created: '2026-01-01T00:00:00.000Z',
    }),
  );

  const taskPath = join(fixture.home, 'users', 'tester', 'tasks', 'task-alpha-1', 'task.json');
  const readTask = () => JSON.parse(readFileSync(taskPath, 'utf8'));

  await lattice.associateTask('tester', 'task-alpha-1', { projectId: 'beta' });
  const canonical = (pid: string) => (pid.includes(':') ? pid.slice(pid.indexOf(':') + 1) : pid);
  const afterAssociate = readTask();
  const canonicalProjects = afterAssociate.projects.map(canonical);
  assert.ok(canonicalProjects.includes('alpha'), 'union: alpha kept');
  assert.ok(canonicalProjects.includes('beta'), 'beta associated');

  // 服务层错误即抛（errors 非空会 throw）；成功返回 void
  await lattice.addTaskSpecRefs('tester', 'task-alpha-1', ['spec-bbbb0002']);
  const afterRef = readTask();
  assert.ok(
    afterRef.referencedSpecs.some((ref: { id?: string }) => ref.id === 'spec-bbbb0002'),
    'spec reference persisted',
  );
});

test('git：getProjectGitStatus（git 仓库返回分支与提交；无路径项目返回 null）', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: fixture.workspace });
  writeFileSync(join(fixture.workspace, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', '.'], { cwd: fixture.workspace });
  execFileSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=tester', 'commit', '-q', '-m', 'init'],
    { cwd: fixture.workspace },
  );

  const status = await lattice.getProjectGitStatus('tester', 'alpha');
  assert.ok(status, 'git status expected for project with a repo');
  assert.equal(typeof status?.branch, 'string');
  assert.ok((status?.branch ?? '').length > 0, 'branch name present');
  assert.equal(status?.uncommittedCount, 0, 'clean tree');
  assert.match(String(status?.lastCommitMessage), /init/);

  // 无 localPaths 的项目（beta 由前一用例创建）→ null（面板优雅隐藏的数据面）
  assert.equal(await lattice.getProjectGitStatus('tester', 'beta'), null);
});
