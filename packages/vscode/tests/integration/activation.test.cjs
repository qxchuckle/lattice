/* global suite, test, suiteSetup, suiteTeardown */
const assert = require('node:assert/strict');
const vscode = require('vscode');
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const EXTENSION_ID = 'qcqx.lattice-context';

/**
 * 集成测试：扩展在「真实 fixture 数据根」上跑（进程内 core 直读文件，不再需要假 ltc）。
 * - .vscode-test.mjs 注入 LATTICE_HOME（覆盖激活早期的默认根）
 * - suiteSetup 把 lattice.home 设置指向同一目录并写入 fixture 数据（项目/任务/spec/progress）
 */
suite('Lattice extension (fixture data root, in-process core)', function () {
  this.timeout(120000);

  /** 由 .vscode-test.mjs 注入（激活期即生效，隔离真实 ~/.lattice） */
  const latticeHome = process.env.LATTICE_HOME;
  const workspacePath = path.resolve(__dirname, '..', 'fixtures', 'workspace');

  const taskJsonPath = () =>
    path.join(latticeHome, 'users', 't', 'tasks', 'demo-task-1', 'task.json');

  suiteSetup(async function () {
    assert.ok(latticeHome, 'LATTICE_HOME should be provided by .vscode-test.mjs');
    rmSync(latticeHome, { recursive: true, force: true });

    // ── fixture 数据根（进程内 core 的真源）──
    // 用户（username 存在本地配置：<home>/config/config-local.json）
    mkdirSync(path.join(latticeHome, 'users', 't'), { recursive: true });
    mkdirSync(path.join(latticeHome, 'config'), { recursive: true });
    writeFileSync(
      path.join(latticeHome, 'config', 'config-local.json'),
      JSON.stringify({ username: 't' }),
    );
    // 项目（用户 workspace 作为 localPaths，供 anchor 识别）
    mkdirSync(path.join(latticeHome, 'users', 't', 'projects', 'fixture-project'), {
      recursive: true,
    });
    writeFileSync(
      path.join(latticeHome, 'users', 't', 'projects', 'fixture-project', 'project.json'),
      JSON.stringify({
        id: 'fixture-project',
        ids: ['fixture-project'],
        name: 'Fixture Project',
        description: 'fixture',
        localPaths: [workspacePath],
        gitRemotes: [],
        packageNames: [],
        created: '2026-01-01T00:00:00.000Z',
        updated: null,
      }),
    );
    // 任务 + PRD + progress
    mkdirSync(path.join(latticeHome, 'users', 't', 'tasks', 'demo-task-1'), { recursive: true });
    writeFileSync(
      taskJsonPath(),
      JSON.stringify({
        id: 'demo-task-1',
        title: 'Demo task',
        status: 'in_progress',
        projects: ['fixture-project'],
        scopePaths: [{ path: workspacePath, addedAt: '2026-01-01T00:00:00.000Z' }],
        referencedSpecs: [],
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-02T00:00:00.000Z',
      }),
    );
    writeFileSync(
      path.join(latticeHome, 'users', 't', 'tasks', 'demo-task-1', 'prd.md'),
      '# Demo task\n\nFixture PRD.\n',
    );
    writeFileSync(
      path.join(latticeHome, 'users', 't', 'tasks', 'demo-task-1', 'progress.yaml'),
      [
        'entries:',
        '  - id: cp_fixture1',
        '    time: "2026-01-02T00:00:00.000Z"',
        '    type: decision',
        '    title: Fixture checkpoint',
        '    message: hello',
        '',
      ].join('\n'),
    );
    // 用户级 spec
    mkdirSync(path.join(latticeHome, 'users', 't', 'spec'), { recursive: true });
    writeFileSync(
      path.join(latticeHome, 'users', 't', 'spec', 'fixture-spec.md'),
      '---\nid: spec-aaaaaaaa\ntitle: Fixture spec\n---\n\nbody\n',
    );

    const config = vscode.workspace.getConfiguration('lattice');
    await config.update('latticeHome', latticeHome, vscode.ConfigurationTarget.Global);

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} should be installed in the test host`);
    if (!extension.isActive) {
      await extension.activate();
    }
    // 「检查运行环境」= 重载语义：确保激活期可能缓存的根/DB 被刷新
    await vscode.commands.executeCommand('lattice.cli.check');
  });

  suiteTeardown(function () {
    // 数据根本身即测试隔离目录（固定位于 .vscode-test/ 下），无需额外清理
  });

  test('contributed commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'lattice.refresh',
      'lattice.graph.open',
      'lattice.task.create',
      'lattice.task.openDoc',
      'lattice.task.checkpoint.add',
      'lattice.spec.openById',
      'lattice.project.open',
      'lattice.search.open',
      'lattice.cli.check',
      'lattice.rag.status',
      'lattice.trash.browse',
    ]) {
      assert.ok(commands.includes(id), `command should be registered: ${id}`);
    }
  });

  test('graph webview panel opens', async () => {
    await vscode.commands.executeCommand('lattice.graph.open');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    const webviewTab = tabs.find((tab) => tab.input instanceof vscode.TabInputWebview);
    assert.ok(
      webviewTab,
      `expected a webview tab; tabs: ${tabs.map((tab) => tab.label).join(', ') || '(none)'}`,
    );
  });

  test('refresh loads the fixture snapshot from disk (in-process core)', async () => {
    await vscode.commands.executeCommand('lattice.refresh');
    await vscode.commands.executeCommand('lattice.utility.copyDiagnostics');
    const diagnostics = await vscode.env.clipboard.readText();
    assert.match(diagnostics, /projects=1 tasks=1/);
    assert.match(diagnostics, /core: 1\.28\.0/);
    assert.match(diagnostics, /in-process core/);
  });

  test('opens the fixture PRD via lattice.task.openDoc', async () => {
    const expectedSuffix = path.join('demo-task-1', 'prd.md');
    const opened = new Promise((resolve) => {
      const subscription = vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.uri.fsPath.endsWith(expectedSuffix)) {
          subscription.dispose();
          resolve(true);
        }
      });
      setTimeout(() => {
        subscription.dispose();
        resolve(false);
      }, 15000);
    });
    // fire & forget：测试宿主中 executeCommand 的完成时机可能与窗口焦点相关，行为验证以「文档已打开」为准
    void vscode.commands.executeCommand('lattice.task.openDoc', {
      taskId: 'demo-task-1',
      doc: 'prd',
    });
    const didOpen = await opened;
    const visible = vscode.window.visibleTextEditors.map((editor) => editor.document.uri.fsPath);
    assert.ok(
      didOpen,
      `expected the PRD document to open; visible editors: ${visible.join(', ') || '(none)'}`,
    );
  });

  test('checkpoint virtual document renders', async () => {
    const uri = vscode.Uri.parse('lattice://checkpoint/demo-task-1/cp_fixture1');
    const document = await vscode.workspace.openTextDocument(uri);
    assert.match(document.getText(), /Fixture checkpoint/);
  });

  test('task status write path persists to task.json (in-process write)', async () => {
    const before = JSON.parse(readFileSync(taskJsonPath(), 'utf8'));
    assert.equal(before.status, 'in_progress');
    await vscode.commands.executeCommand('lattice.task.complete', { taskId: 'demo-task-1' });
    // 写入为异步（文件系统），轮询等待
    let status = before.status;
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      status = JSON.parse(readFileSync(taskJsonPath(), 'utf8')).status;
      if (status === 'completed') break;
    }
    assert.equal(status, 'completed', 'task.json should be updated to completed');
    // 复位，避免影响其他用例
    await vscode.commands.executeCommand('lattice.task.start', { taskId: 'demo-task-1' });
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (JSON.parse(readFileSync(taskJsonPath(), 'utf8')).status === 'in_progress') break;
    }
  });

  test('batch multi-select commands apply to selections', async () => {
    const item = (id) => ({ lattice: { kind: 'task', taskId: id } });

    // 复制 ID（数组形态 = 多选）→ 剪贴板
    await vscode.commands.executeCommand('lattice.tasks.copyIds', [item('demo-task-1')]);
    assert.match(await vscode.env.clipboard.readText(), /demo-task-1/);

    // 批量完成（测试宿主跳过确认）→ 落盘
    await vscode.commands.executeCommand('lattice.tasks.batchComplete', [item('demo-task-1')]);
    let status = '';
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      status = JSON.parse(readFileSync(taskJsonPath(), 'utf8')).status;
      if (status === 'completed') break;
    }
    assert.equal(status, 'completed', 'batchComplete should persist to task.json');

    // 批量开始（复位）
    await vscode.commands.executeCommand('lattice.tasks.batchStart', [item('demo-task-1')]);
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (JSON.parse(readFileSync(taskJsonPath(), 'utf8')).status === 'in_progress') break;
    }

    // 空选择：仅提示、不抛错
    await vscode.commands.executeCommand('lattice.tasks.batchArchive', []);
  });

  test('reveal in sidebar resolves task/spec/project nodes', async () => {
    const reveal = (arg) => vscode.commands.executeCommand('lattice.revealInSidebar', arg);

    // 任务（先展开所在分组）
    assert.equal(await reveal({ kind: 'task', id: 'demo-task-1' }), true);
    // Spec（用户级 spec 分组）
    assert.equal(await reveal({ kind: 'spec', id: 'spec-aaaaaaaa' }), true);
    // 项目（全部项目分组）
    assert.equal(await reveal({ kind: 'project', id: 'fixture-project' }), true);

    // 不在视图范围 / 未声明的实体：返回 false 且不抛错
    assert.equal(await reveal({ kind: 'task', id: 'missing-task' }), false);
    assert.equal(await reveal({ kind: 'spec', id: 'spec-missing000' }), false);
  });

  test('spec diagnostics surface lint issues and conflicts', async () => {
    const userSpec = path.join(latticeHome, 'users', 't', 'spec', 'fixture-spec.md');
    const conflictSpec = path.join(latticeHome, 'spec', 'fixture-spec.md');

    // 首轮体检：fixture spec 缺 description → 至少一条 lint 诊断
    await vscode.commands.executeCommand('lattice.spec.lint');
    const base = vscode.languages.getDiagnostics(vscode.Uri.file(userSpec));
    assert.ok(base.length > 0, 'lint diagnostics expected for fixture spec');

    // 制造冲突：全局层写入与用户层同相对路径的 spec → 双方各得一条 spec-conflict
    mkdirSync(path.join(latticeHome, 'spec'), { recursive: true });
    writeFileSync(
      conflictSpec,
      '---\nid: spec-dddddddd\ntitle: Global fixture spec\n---\n\nbody\n',
    );
    await vscode.commands.executeCommand('lattice.spec.lint');
    const withConflict = vscode.languages.getDiagnostics(vscode.Uri.file(userSpec));
    assert.ok(withConflict.length > base.length, 'conflict diagnostic added');
    assert.ok(
      withConflict.some((d) => d.code === 'spec-conflict'),
      'spec-conflict code present',
    );

    // 修复：删除冲突文件 → 冲突诊断消失（lint 数量回到基线）
    rmSync(conflictSpec);
    await vscode.commands.executeCommand('lattice.spec.lint');
    const fixed = vscode.languages.getDiagnostics(vscode.Uri.file(userSpec));
    assert.equal(fixed.filter((d) => d.code === 'spec-conflict').length, 0);
    assert.equal(fixed.length, base.length);
  });

  test('spec create wizard writes a spec file with frontmatter (programmatic args)', async () => {
    const created = await vscode.commands.executeCommand('lattice.spec.create', {
      scope: 'user',
      relativePath: 'wizard-created.md',
      title: 'Wizard Created',
      description: 'Created by the integration test for the spec creation wizard.',
      tags: 'test, wizard',
      open: false,
    });
    assert.equal(typeof created, 'string', 'created path returned');
    const expected = path.join(latticeHome, 'users', 't', 'spec', 'wizard-created.md');
    assert.equal(created, expected);
    const raw = readFileSync(expected, 'utf8');
    assert.match(raw, /id: spec-[0-9a-z]+/);
    assert.match(raw, /title: Wizard Created/);
    assert.match(raw, /tags:/);
    assert.match(raw, /# Wizard Created/);

    // 非法相对路径（路径穿越）→ 拒绝且不落盘
    const rejected = await vscode.commands.executeCommand('lattice.spec.create', {
      scope: 'user',
      relativePath: '../evil.md',
      title: 'Evil',
      description: '',
      tags: '',
      open: false,
    });
    assert.equal(rejected, undefined, 'path traversal rejected');
    assert.ok(!existsSync(path.join(latticeHome, 'users', 'evil.md')), 'no file escaped');
  });

  test('spec id quick fix references the spec to the active task', async () => {
    // 置活动任务（CodeAction 仅在有活动任务时提供）
    await vscode.commands.executeCommand('lattice.task.setActive', { taskId: 'demo-task-1' });

    mkdirSync(workspacePath, { recursive: true });
    const file = path.join(workspacePath, 'tmp-spec-ref.md');
    writeFileSync(file, '参考 spec-aaaaaaaa 的实现约定\n');
    const doc = await vscode.workspace.openTextDocument(file);

    // 快照首次未加载时提供器会触发 ensure 并返回空 → 轮询重试
    let target;
    for (let i = 0; i < 12 && !target; i += 1) {
      const actions = await vscode.commands.executeCommand(
        'vscode.executeCodeActionProvider',
        doc.uri,
        new vscode.Range(0, 0, 0, 30),
      );
      target = (actions ?? []).find((a) => a.command?.command === 'lattice.spec.refToTask');
      if (!target) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(target, 'quick fix offered for a known spec id');

    await vscode.commands.executeCommand(
      target.command.command,
      ...(target.command.arguments ?? []),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.match(readFileSync(taskJsonPath(), 'utf8'), /spec-aaaaaaaa/);
    rmSync(file, { force: true });
  });

  test('checkpoint long-text draft commits into progress.yaml and summarize seeds sections', async () => {
    const progressPath = path.join(
      latticeHome,
      'users',
      't',
      'tasks',
      'demo-task-1',
      'progress.yaml',
    );

    // 1) 起草（程序化参数跳过全部交互）
    const draftUri = await vscode.commands.executeCommand('lattice.task.checkpoint.draft', {
      taskId: 'demo-task-1',
      type: 'note',
      title: 'Draft from integration test',
      body: '第一段：长期讨论的结论。\n\n第二段：包含多行的细节内容。',
    });
    assert.equal(typeof draftUri, 'string', 'draft uri returned');
    assert.ok(draftUri.startsWith('untitled:'), 'draft is untitled');
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor && editor.document.uri.toString() === draftUri, 'draft is active editor');

    // 2) 提交 → 落盘 + 关闭草稿页签
    const committed = await vscode.commands.executeCommand('lattice.checkpoint.commit');
    assert.equal(committed, 'demo-task-1');
    const raw = readFileSync(progressPath, 'utf8');
    assert.match(raw, /Draft from integration test/);
    assert.match(raw, /第二段/);
    assert.ok(
      !vscode.workspace.textDocuments.some((d) => d.uri.toString() === draftUri),
      'draft tab closed after commit',
    );

    // 3) 任务总结 → 结构化三段草稿（不提交）
    const summaryUri = await vscode.commands.executeCommand('lattice.task.summarize', {
      taskId: 'demo-task-1',
    });
    assert.equal(typeof summaryUri, 'string', 'summary draft uri returned');
    const summaryDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === summaryUri);
    assert.ok(summaryDoc, 'summary draft document found');
    const text = summaryDoc.getText();
    assert.match(text, /lattice-checkpoint: true/);
    assert.match(text, /type: summary/);
    assert.match(text, /(## 完成项|## Done)/);
    assert.match(text, /(## 遗留|## Pending)/);
    assert.match(text, /(## 下一步|## Next Steps)/);

    // 清理：直接关闭汇总草稿（不提交）
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (entry) =>
          entry.input instanceof vscode.TabInputText && entry.input.uri.toString() === summaryUri,
      );
    if (tab) await vscode.window.tabGroups.close(tab);
  });

  test('enhanced picker: modifier actions (copy id / open graph) work from the task picker', async () => {
    // 确保 resolveTask 走「选择器」路径
    await vscode.commands.executeCommand('lattice.task.clearActive');

    // ⌘↵（命令等价）：复制高亮任务 ID 并关闭选择器，原流程按取消中止
    const pending = vscode.commands.executeCommand('lattice.task.start').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await vscode.commands.executeCommand('lattice.picker.copyId');
    assert.equal(await pending, undefined, 'task.start aborted after copyId action');
    const clip = (await vscode.env.clipboard.readText()).trim();
    assert.ok(clip.length > 0, 'clipboard holds a task id');
    assert.ok(
      existsSync(path.join(latticeHome, 'users', 't', 'tasks', clip)),
      `clipboard id exists on disk: ${clip}`,
    );

    // ⌥↵：从选择器直接打开图谱
    const pending2 = vscode.commands.executeCommand('lattice.task.start').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await vscode.commands.executeCommand('lattice.picker.openGraph');
    assert.equal(await pending2, undefined, 'task.start aborted after openGraph action');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const webviewTab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((tab) => tab.input instanceof vscode.TabInputWebview);
    assert.ok(webviewTab, 'graph webview opened from the picker');
  });

  test('user commands: create / switch / read-only browse blocks writes', async () => {
    const configPath = path.join(latticeHome, 'config', 'config-local.json');
    const item = (id) => ({ lattice: { kind: 'task', taskId: id } });

    // 新建用户（程序化参数跳过输入框）→ 目录脚手架
    assert.equal(
      await vscode.commands.executeCommand('lattice.user.create', { name: 'second' }),
      'second',
    );
    assert.ok(existsSync(path.join(latticeHome, 'users', 'second', 'tasks')), 'tasks dir');
    assert.ok(existsSync(path.join(latticeHome, 'users', 'second', 'spec')), 'spec dir');

    // 切换用户 → config-local.json 落盘
    assert.equal(await vscode.commands.executeCommand('lattice.user.switch', 'second'), 'second');
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).username, 'second');

    // 只读浏览用户 t：数据面切到 t（reveal 可定位其任务），写入被拦截
    assert.equal(await vscode.commands.executeCommand('lattice.user.browse', 't'), 't');
    assert.equal(
      await vscode.commands.executeCommand('lattice.revealInSidebar', {
        kind: 'task',
        id: 'demo-task-1',
      }),
      true,
      'browsed user data is visible',
    );
    const before = readFileSync(taskJsonPath(), 'utf8');
    await vscode.commands.executeCommand('lattice.tasks.batchComplete', [item('demo-task-1')]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(readFileSync(taskJsonPath(), 'utf8'), before, 'read-only browse blocks writes');

    // 退出浏览 + 切回原用户
    await vscode.commands.executeCommand('lattice.user.browse.exit');
    assert.equal(await vscode.commands.executeCommand('lattice.user.switch', 't'), 't');
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).username, 't');
  });

  test('task filter applies to the tree (reveal reflects filtering)', async () => {
    // 设定过滤：仅 archived（demo-task-1 非归档）→ 树中不含该任务
    const applied = await vscode.commands.executeCommand('lattice.tasks.filter', {
      statuses: ['archived'],
      projectIds: [],
    });
    assert.deepEqual(applied, { statuses: ['archived'], projectIds: [] });
    assert.equal(
      await vscode.commands.executeCommand('lattice.revealInSidebar', {
        kind: 'task',
        id: 'demo-task-1',
      }),
      false,
      'filtered-out task is not revealable',
    );

    // 清除过滤 → 恢复可见
    const cleared = await vscode.commands.executeCommand('lattice.tasks.filter', {
      statuses: [],
      projectIds: [],
    });
    assert.deepEqual(cleared, { statuses: [], projectIds: [] });
    assert.equal(
      await vscode.commands.executeCommand('lattice.revealInSidebar', {
        kind: 'task',
        id: 'demo-task-1',
      }),
      true,
      'task is revealable after clearing the filter',
    );
  });

  test('per-view search filters tasks and specs (reveal reflects it)', async () => {
    // 任务：无命中关键词 → 不可定位；命中关键词（id 含 demo-task）→ 可定位
    const applied = await vscode.commands.executeCommand('lattice.tasks.search', {
      query: 'zzz-无命中',
    });
    assert.deepEqual(applied, { query: 'zzz-无命中', contentIds: [] });
    assert.equal(
      await vscode.commands.executeCommand('lattice.revealInSidebar', {
        kind: 'task',
        id: 'demo-task-1',
      }),
      false,
      'task hidden by search',
    );
    await vscode.commands.executeCommand('lattice.tasks.search', { query: 'demo-task' });
    assert.equal(
      await vscode.commands.executeCommand('lattice.revealInSidebar', {
        kind: 'task',
        id: 'demo-task-1',
      }),
      true,
      'task visible with matching search',
    );
    await vscode.commands.executeCommand('lattice.tasks.search', { query: '' });

    // 规范：fixture user spec（title: Fixture spec / id spec-aaaaaaaa）
    await vscode.commands.executeCommand('lattice.specs.search', { query: 'zzz-无命中' });
    assert.equal(
      await vscode.commands.executeCommand('lattice.revealInSidebar', {
        kind: 'spec',
        id: 'spec-aaaaaaaa',
      }),
      false,
      'spec hidden by search',
    );
    await vscode.commands.executeCommand('lattice.specs.search', { query: 'fixture' });
    assert.equal(
      await vscode.commands.executeCommand('lattice.revealInSidebar', {
        kind: 'spec',
        id: 'spec-aaaaaaaa',
      }),
      true,
      'spec visible with matching search',
    );
    await vscode.commands.executeCommand('lattice.specs.search', { query: '' });

    // 项目：设置 / 清除不抛错（reveal 断言留给任务/规范）
    await vscode.commands.executeCommand('lattice.projects.search', { query: 'alpha' });
    await vscode.commands.executeCommand('lattice.projects.search', { query: '' });
  });

  test('workspace bootstrap initializes a fresh home in-process (no CLI)', async () => {
    const freshHome = path.join(path.dirname(latticeHome), `lattice-boot-${Date.now()}`);
    const config = vscode.workspace.getConfiguration('lattice');
    const previous = config.get('latticeHome');
    try {
      await config.update('latticeHome', freshHome, vscode.ConfigurationTarget.Workspace);
      await new Promise((resolve) => setTimeout(resolve, 600));

      const result = await vscode.commands.executeCommand('lattice.workspace.bootstrap', {
        username: 'boot',
        scanDirs: [],
      });
      assert.equal(result?.username, 'boot');
      assert.equal(result?.added, 0);

      const raw = JSON.parse(
        readFileSync(path.join(freshHome, 'config', 'config-local.json'), 'utf8'),
      );
      assert.equal(raw.username, 'boot');
      assert.ok(existsSync(path.join(freshHome, 'users', 'boot', 'tasks')));
      assert.ok(existsSync(path.join(freshHome, 'users', 'boot', 'spec')));
      assert.ok(existsSync(path.join(freshHome, 'users', 'boot', 'projects')));
    } finally {
      await config.update(
        'latticeHome',
        previous || undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      await vscode.commands.executeCommand('lattice.refresh');
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  test('search quick pick command is invokable (smoke)', async () => {
    const promise = vscode.commands.executeCommand('lattice.search.open');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await vscode.commands
      .executeCommand('workbench.action.closeQuickOpen')
      .then(undefined, () => undefined);
    await promise.catch(() => undefined);
  });
});
