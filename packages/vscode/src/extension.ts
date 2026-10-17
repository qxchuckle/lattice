import * as vscode from 'vscode';
import * as path from 'node:path';
import { setLatticeRootOverride } from '@qcqx/lattice-core';
import { getConfig, getLatticeRoot, onConfigChanged } from './config';
import { disposeLogging, log, warnLog } from './logging';
import { LatticeDataService } from './data/service';
import { ActiveProjectService } from './state/active-project';
import { ActiveTaskService } from './state/active-task';
import { ReportStore } from './state/report-store';
import { SearchStateService } from './state/search-state';
import { SnapshotStore } from './state/snapshot';
import { LatticeWatcher } from './state/watcher';
import { registerAllCommands } from './commands';
import { CommandServices, showDeduped } from './commands/shared';
import { runSpecSync } from './commands/spec';
import { LatticeContentProvider } from './editor/virtual-docs';
import { SpecLinkProvider } from './editor/document-link';
import { LatticeJsonCodeLensProvider } from './editor/code-lens';
import { TaskScopeDecorationProvider } from './editor/decorations';
import { SpecDiagnosticsService } from './editor/spec-diagnostics';
import { syncCheckpointDraftContext } from './editor/checkpoint-draft';
import { UserScopeService } from './state/user-scope';
import { TaskFilterService } from './state/task-filter';
import { ViewSearchService } from './state/view-search';
import { taskFilterSummary } from './commands/task-filter';
import { StatusBarController } from './status-bar';
import { GraphPanelManager } from './webview/panel';
import { BusyService } from './busy';
import { RevealService } from './views/reveal';
import { LatticeDragAndDropController } from './views/dnd';
import { SearchProvider } from './views/search';
import { SpecsProvider } from './views/specs';
import { TasksProvider } from './views/tasks';
import { ProjectsProvider } from './views/projects';
import { t } from './t';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log(`activating lattice extension (vscode ${vscode.version}, node ${process.version})`);

  // 数据根：lattice.home 设置 → core 覆盖（进程内调用时 LATTICE_HOME 不适用）
  const applyRootOverride = () => {
    const cfg = getConfig();
    setLatticeRootOverride(cfg.latticeHome.trim() ? getLatticeRoot() : null);
  };
  applyRootOverride();

  const activeProjectRef: { current?: ActiveProjectService } = {};
  const userScope = new UserScopeService();
  const data = new LatticeDataService(() => activeProjectRef.current?.currentAnchorRoot, userScope);
  void data.warmDb();
  const snapshot = new SnapshotStore({
    data,
    getConflictsCwd: () => activeProjectRef.current?.currentAnchorRoot,
    onError: (section, error) => {
      warnLog(`snapshot[${section}] failed: ${error.message}`);
    },
  });
  const activeTask = new ActiveTaskService(context);
  const activeProject = new ActiveProjectService(context, data, snapshot);
  activeProjectRef.current = activeProject;
  const searchState = new SearchStateService();
  const reports = new ReportStore();
  const taskFilter = new TaskFilterService(context);
  const viewSearch = new ViewSearchService(context);

  const tasksProvider = new TasksProvider(
    data,
    snapshot,
    activeProject,
    activeTask,
    taskFilter,
    viewSearch,
  );
  const specsProvider = new SpecsProvider(snapshot, viewSearch);
  const projectsProvider = new ProjectsProvider(snapshot, activeProject, activeTask, viewSearch);
  const searchProvider = new SearchProvider(searchState, snapshot);
  // 跨视图拖拽：任务 → 项目（associate）、Spec → 任务（refSpec）
  const dnd = new LatticeDragAndDropController(data, snapshot);

  const tasksView = vscode.window.createTreeView('lattice.tasks', {
    treeDataProvider: tasksProvider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dnd,
  });
  const specsView = vscode.window.createTreeView('lattice.specs', {
    treeDataProvider: specsProvider,
    showCollapseAll: true,
    dragAndDropController: dnd,
  });
  const projectsView = vscode.window.createTreeView('lattice.projects', {
    treeDataProvider: projectsProvider,
    showCollapseAll: true,
    dragAndDropController: dnd,
  });
  const searchView = vscode.window.createTreeView('lattice.search', {
    treeDataProvider: searchProvider,
  });

  // ── 视图过滤 / 搜索：view/title 图标态 + 视图消息行 ──
  const updateViewFilterUi = (): void => {
    // 任务：状态 × 项目过滤 + 关键词搜索
    void vscode.commands.executeCommand('setContext', 'lattice.tasks.hasFilter', taskFilter.active);
    const taskParts: string[] = [];
    if (taskFilter.active) {
      taskParts.push(
        t(
          'Filter: {0}',
          taskFilterSummary(taskFilter.current, (id) => snapshot.findProject(id)?.name),
        ),
      );
    }
    if (viewSearch.isActive('tasks')) {
      taskParts.push(t('Search: "{0}"', viewSearch.get('tasks').query));
    }
    tasksView.message = taskParts.length > 0 ? taskParts.join(' · ') : undefined;

    // 规范 / 项目：关键词搜索
    for (const [target, view] of [
      ['specs', specsView],
      ['projects', projectsView],
    ] as const) {
      void vscode.commands.executeCommand(
        `lattice.${target}.hasSearch`,
        viewSearch.isActive(target),
      );
      view.message = viewSearch.isActive(target)
        ? t('Search: "{0}"', viewSearch.get(target).query)
        : undefined;
    }
  };
  taskFilter.onDidChange(() => updateViewFilterUi());
  viewSearch.onDidChange(() => updateViewFilterUi());
  snapshot.onDidChange(() => updateViewFilterUi());
  updateViewFilterUi();
  context.subscriptions.push(taskFilter, viewSearch);

  const createWatcher = (): LatticeWatcher => {
    const instance = new LatticeWatcher({
      root: getLatticeRoot(),
      debounceMs: getConfig().refreshDebounce,
      onChanges: (sections) => {
        void snapshot.invalidate([...sections]);
      },
      onError: (error) => warnLog(`watcher: ${error.message}`),
    });
    instance.start();
    return instance;
  };
  const watcherRef: { current: LatticeWatcher } = { current: createWatcher() };

  const busy = new BusyService();
  const specDiagnostics = new SpecDiagnosticsService();
  const services: CommandServices = {
    context,
    data,
    snapshot,
    activeProject,
    activeTask,
    searchState,
    reports,
    busy,
    userScope,
    taskFilter,
    viewSearch,
    watcher: watcherRef.current,
    specDiagnostics,
  };
  services.reveal = new RevealService({
    tasks: { provider: tasksProvider, view: tasksView },
    specs: { provider: specsProvider, view: specsView },
    projects: { provider: projectsProvider, view: projectsView },
  });
  const graphPanel = new GraphPanelManager(context, services);
  services.graph = graphPanel;
  registerAllCommands(services);

  // ── 编辑器集成 ──
  const contentProvider = new LatticeContentProvider(data, reports);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('lattice', contentProvider),
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      [
        { language: 'markdown' },
        { language: 'yaml' },
        { language: 'plaintext' },
        { language: 'json' },
        { language: 'jsonc' },
        { language: 'typescript' },
        { language: 'javascript' },
      ],
      new SpecLinkProvider(),
    ),
  );
  const codeLensProvider = new LatticeJsonCodeLensProvider(data, snapshot);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', pattern: '**/lattice.json' },
      codeLensProvider,
    ),
  );
  const decorations = new TaskScopeDecorationProvider(activeTask, snapshot);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorations));

  const statusBar = new StatusBarController(snapshot, activeProject, activeTask, userScope);
  context.subscriptions.push(userScope);

  // ── 检查点草稿上下文（editor/title 提交按钮显隐） ──
  syncCheckpointDraftContext(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => syncCheckpointDraftContext(editor)),
  );

  // ── 上下文键 / 视图装饰 ──
  const updateContextKeys = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.hasWorkspaceProject',
      Boolean(activeProject.currentProjectId),
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.hasActiveTask',
      Boolean(activeTask.id),
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.specHasConflicts',
      snapshot.data.conflicts.length > 0,
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.searchHasResults',
      searchState.hasResults,
    );
  };

  const updateViewDecorations = () => {
    const config = getConfig();
    tasksView.description =
      config.tasksScope === 'project' ? t('current project') : t('all projects');
    const activeCount = activeProject.currentProjectId
      ? snapshot.activeTasksForProject(activeProject.currentProjectId).length
      : 0;
    tasksView.badge =
      activeCount > 0
        ? { value: activeCount, tooltip: t('Active tasks in the current project') }
        : undefined;
    specsView.badge =
      snapshot.data.conflicts.length > 0
        ? { value: snapshot.data.conflicts.length, tooltip: t('Spec conflicts') }
        : undefined;
    searchView.description = searchState.current.query || undefined;
    tasksView.message = snapshot.data.errors.tasks
      ? t('Failed to load tasks: {0}', snapshot.data.errors.tasks)
      : undefined;
    specsView.message = snapshot.data.errors.specs
      ? t('Failed to load specs: {0}', snapshot.data.errors.specs)
      : undefined;
    projectsView.message = snapshot.data.errors.projects
      ? t('Failed to load projects: {0}', snapshot.data.errors.projects)
      : undefined;
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.hasErrors',
      Object.keys(snapshot.data.errors).length > 0,
    );
  };

  context.subscriptions.push(
    snapshot.onDidChange((sections) => {
      if (sections.some((s) => s === 'specs' || s === 'conflicts')) {
        specDiagnostics.schedule();
      }
      if (
        snapshot.data.loaded.user ||
        snapshot.data.loaded.projects ||
        snapshot.data.loaded.tasks
      ) {
        void vscode.commands.executeCommand('setContext', 'lattice.cliAvailable', true);
      }
      if (sections.includes('tasks') && snapshot.data.loaded.tasks) {
        const activeId = activeTask.id;
        if (activeId && !snapshot.taskById(activeId)) {
          void activeTask.set(undefined);
        }
      }
      updateContextKeys();
      updateViewDecorations();
    }),
    searchState.onDidChange(() => {
      updateContextKeys();
      updateViewDecorations();
    }),
    activeProject.onDidChange(() => {
      updateContextKeys();
      updateViewDecorations();
    }),
    activeTask.onDidChange(() => updateContextKeys()),
  );

  // ── autoRefresh / 轮询兜底 ──
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const setupPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    const config = getConfig();
    if (!config.autoRefresh || config.fallbackPollMs <= 0) return;
    pollTimer = setInterval(
      () => {
        if (!watcherRef.current.healthy) {
          void snapshot.invalidate(['user', 'projects', 'tasks', 'specs', 'conflicts']);
        }
      },
      Math.max(5000, config.fallbackPollMs),
    );
  };
  setupPolling();
  context.subscriptions.push(
    onConfigChanged((event) => {
      if (event.affectsConfiguration('lattice.latticeHome')) {
        // 数据根变更：重建 core 根覆盖 + DB 连接 + watcher，并重载快照
        applyRootOverride();
        void data.resetDb();
        watcherRef.current.dispose();
        watcherRef.current = createWatcher();
        services.watcher = watcherRef.current;
        void snapshot.invalidate(['user', 'projects', 'tasks', 'specs', 'conflicts']);
        void activeProject.refresh();
      }
      if (
        event.affectsConfiguration('lattice.autoRefresh') ||
        event.affectsConfiguration('lattice.fallbackPollMs')
      ) {
        setupPolling();
        if (getConfig().autoRefresh) watcherRef.current.start();
        else watcherRef.current.dispose();
      }
    }),
  );

  // ── spec 保存后引导（migrate + rag） ──
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!getConfig().ragHintOnSave) return;
      if (document.uri.scheme !== 'file') return;
      const root = getLatticeRoot();
      const filePath = document.uri.fsPath;
      const inGlobalSpec = filePath.startsWith(path.join(root, 'spec') + path.sep);
      const inUserSpec =
        filePath.startsWith(path.join(root, 'users') + path.sep) &&
        filePath.includes(`${path.sep}spec${path.sep}`);
      if (!inGlobalSpec && !inUserSpec) return;
      const syncLabel = t('Sync (migrate + RAG)');
      void showDeduped(
        'info',
        t('Spec updated — run "spec migrate" + "rag update"?'),
        syncLabel,
      ).then((action) => {
        if (action === syncLabel) void runSpecSync(services, { ragUpdate: true });
      });
    }),
  );

  // ── 生命周期收尾 ──
  context.subscriptions.push(
    tasksView,
    specsView,
    projectsView,
    searchView,
    tasksProvider,
    specsProvider,
    projectsProvider,
    searchProvider,
    snapshot,
    specDiagnostics,
    activeProject,
    activeTask,
    searchState,
    statusBar,
    busy,
    decorations,
    codeLensProvider,
    { dispose: () => watcherRef.current.dispose() },
    { dispose: () => data.dispose() },
    { dispose: () => clearInterval(pollTimer) },
  );

  void vscode.commands.executeCommand('setContext', 'lattice.cliAvailable', true);
  updateContextKeys();
  updateViewDecorations();
  void snapshot.ensure(['user', 'projects']);
  // 首轮 Spec 体检（lint + 冲突 → Problems）
  specDiagnostics.schedule(1500);
  log('lattice extension activated');
}

export function deactivate(): void {
  log('lattice extension deactivated');
  disposeLogging();
}
