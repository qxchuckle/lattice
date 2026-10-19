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
import { SpecRefCodeActionProvider } from './editor/spec-code-actions';
import { UserScopeService } from './state/user-scope';
import { TasksScopeService } from './state/tasks-scope';
import { ViewSearchService } from './state/view-search';
import { ViewFilterService } from './state/view-filter';
import { taskFilterSummary } from './commands/task-filter';
import {
  projectFilterSummary,
  searchFilterSummary,
  specFilterSummary,
} from './commands/view-filter';
import { StatusBarController } from './status-bar';
import { GraphPanelManager } from './webview/panel';
import {
  DetailViewProvider,
  DETAIL_VIEW_TYPE,
  detailTargetFromPayload,
} from './webview/detail-view';
import type { LatticeTreeItem } from './views/items';
import { BusyService } from './busy';
import { RevealService } from './views/reveal';
import { LatticeDragAndDropController } from './views/dnd';
import { SearchProvider } from './views/search';
import { SpecsProvider } from './views/specs';
import { TasksProvider } from './views/tasks';
import { ProjectsProvider } from './views/projects';
import { ViewSearchPreviewService } from './views/view-search-preview';
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
  const searchState = new SearchStateService(context);
  const reports = new ReportStore();
  const viewFilter = new ViewFilterService(context);
  const tasksScope = new TasksScopeService(context);
  const viewSearch = new ViewSearchService(context);

  const tasksProvider = new TasksProvider(
    data,
    snapshot,
    activeProject,
    activeTask,
    viewFilter,
    tasksScope,
    viewSearch,
  );
  const specsProvider = new SpecsProvider(snapshot, viewSearch, viewFilter);
  const projectsProvider = new ProjectsProvider(
    snapshot,
    activeProject,
    activeTask,
    viewSearch,
    viewFilter,
  );
  const searchProvider = new SearchProvider(searchState, snapshot, viewFilter);
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

  // ── 视图过滤 / 搜索：view/title 图标态 + 视图消息行（单一组合函数，错误 > 过滤 > 搜索） ──
  const composeViewMessages = (): void => {
    const errors = snapshot.data.errors;
    const projectName = (id: string): string | undefined => snapshot.findProject(id)?.name;

    void vscode.commands.executeCommand(
      'setContext',
      'lattice.tasks.hasFilter',
      viewFilter.isActive('tasks'),
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.tasks.hasSearch',
      viewSearch.isActive('tasks'),
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.specs.hasFilter',
      viewFilter.isActive('specs'),
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.projects.hasFilter',
      viewFilter.isActive('projects'),
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.search.hasFilter',
      viewFilter.isActive('search'),
    );

    // 任务：错误 + 过滤 + 搜索
    const taskParts: string[] = [];
    if (errors.tasks) taskParts.push(t('Failed to load tasks: {0}', errors.tasks));
    if (viewFilter.isActive('tasks')) {
      taskParts.push(t('Filter: {0}', taskFilterSummary(viewFilter.get('tasks'), projectName)));
    }
    if (viewSearch.isActive('tasks')) {
      taskParts.push(t('Search: "{0}"', viewSearch.get('tasks').query));
    }
    tasksView.message = taskParts.length > 0 ? taskParts.join(' · ') : undefined;

    // 规范 / 项目：错误 + 过滤 + 搜索
    for (const [target, view] of [
      ['specs', specsView],
      ['projects', projectsView],
    ] as const) {
      void vscode.commands.executeCommand(
        'setContext',
        `lattice.${target}.hasSearch`,
        viewSearch.isActive(target),
      );
      const parts: string[] = [];
      const error = errors[target];
      if (error) {
        parts.push(
          t(
            target === 'specs' ? 'Failed to load specs: {0}' : 'Failed to load projects: {0}',
            error,
          ),
        );
      }
      if (viewFilter.isActive(target)) {
        parts.push(
          t(
            'Filter: {0}',
            target === 'specs'
              ? specFilterSummary(viewFilter.get('specs'), projectName)
              : projectFilterSummary(viewFilter.get('projects')),
          ),
        );
      }
      if (viewSearch.isActive(target)) {
        parts.push(t('Search: "{0}"', viewSearch.get(target).query));
      }
      view.message = parts.length > 0 ? parts.join(' · ') : undefined;
    }

    // 搜索结果视图：过滤摘要（错误态由 SearchProvider 的占位行呈现）
    searchView.message = viewFilter.isActive('search')
      ? t('Filter: {0}', searchFilterSummary(viewFilter.get('search'), projectName))
      : undefined;
  };
  viewFilter.onDidChange(() => composeViewMessages());
  viewSearch.onDidChange(() => composeViewMessages());
  snapshot.onDidChange(() => composeViewMessages());
  composeViewMessages();
  context.subscriptions.push(viewFilter, tasksScope, viewSearch);

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
  const viewSearchPreview = new ViewSearchPreviewService(data, snapshot, {
    tasks: tasksProvider,
    specs: specsProvider,
    projects: projectsProvider,
  });
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
    viewFilter,
    tasksScope,
    viewSearch,
    viewSearchPreview,
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

  // ── 侧栏「详情」WebviewView（点哪看哪：任务/规范/项目；默认跟随活动任务） ──
  const detailView = new DetailViewProvider(services);
  context.subscriptions.push(
    detailView,
    vscode.window.registerWebviewViewProvider(DETAIL_VIEW_TYPE, detailView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  const trackDetailSelection = (view: vscode.TreeView<LatticeTreeItem>): void => {
    context.subscriptions.push(
      view.onDidChangeSelection((event) => {
        // 群组等非实体节点忽略（保留上次显式选择或活动任务）
        const target = detailTargetFromPayload(event.selection[0]?.lattice);
        if (target) detailView.setTarget(target);
      }),
    );
  };
  trackDetailSelection(tasksView);
  trackDetailSelection(specsView);
  trackDetailSelection(projectsView);

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
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new SpecRefCodeActionProvider(snapshot, activeTask),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
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
    // 数据根就绪态（用户名已解析）：视图 welcome 与外部扩展可据此判断初始化状态
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.initialized',
      snapshot.data.username != null,
    );
    void vscode.commands.executeCommand(
      'setContext',
      'lattice.searchHasResults',
      searchState.hasResults,
    );
  };

  const updateViewDecorations = () => {
    tasksView.description =
      tasksScope.effective === 'project' ? t('current project') : t('all projects');
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
  // 任务范围（workspaceState 覆盖）变化：刷新视图描述
  context.subscriptions.push(tasksScope.onDidChange(() => updateViewDecorations()));

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
      if (event.affectsConfiguration('lattice.tasks.scope')) {
        // 用户显式修改设置：丢弃 workspaceState 覆盖，令设置重新生效
        void tasksScope.clearOverride();
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
