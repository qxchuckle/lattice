import * as vscode from 'vscode';
import { getConfig, onConfigChanged } from './config';
import { ActiveProjectService } from './state/active-project';
import { ActiveTaskService } from './state/active-task';
import { SnapshotStore } from './state/snapshot';
import { UserScopeService } from './state/user-scope';
import { t } from './t';

/** 状态栏三项：活动项目 + 活跃任务数 + 当前用户（点击分别触发状态菜单 / 聚焦任务视图 / 用户管理）。 */
export class StatusBarController implements vscode.Disposable {
  private readonly projectItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  private readonly tasksItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  private readonly userItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly snapshot: SnapshotStore,
    private readonly activeProject: ActiveProjectService,
    private readonly activeTask: ActiveTaskService,
    private readonly userScope: UserScopeService,
  ) {
    this.projectItem.command = 'lattice.status.project';
    this.tasksItem.command = 'lattice.tasks.focus';
    this.disposables.push(
      snapshot.onDidChange(() => this.update()),
      activeProject.onDidChange(() => this.update()),
      activeTask.onDidChange(() => this.update()),
      userScope.onDidChange(() => this.update()),
      onConfigChanged((event) => {
        if (event.affectsConfiguration('lattice.statusBar')) this.update();
      }),
    );
    this.update();
  }

  update(): void {
    const config = getConfig();
    const project = this.activeProject.currentProject;

    if (config.statusBarProject) {
      this.projectItem.text = project
        ? `$(library) ${project.name || project.id}`
        : '$(library) Lattice';
      const tooltip = new vscode.MarkdownString();
      if (project) {
        tooltip.appendMarkdown(`**${project.name || project.id}**\n\n`);
        tooltip.appendMarkdown(`${project.id}\n\n`);
        for (const path of project.localPaths) tooltip.appendMarkdown(`- ${path}\n`);
      } else {
        tooltip.appendMarkdown(t('No active Lattice project.'));
      }
      this.projectItem.tooltip = tooltip;
      this.projectItem.show();
    } else {
      this.projectItem.hide();
    }

    const activeTasks = this.activeProject.currentProjectId
      ? this.snapshot.activeTasksForProject(this.activeProject.currentProjectId)
      : [];
    if (config.statusBarActiveTasks && activeTasks.length > 0) {
      this.tasksItem.text = `$(checklist) ${activeTasks.length}`;
      const tooltip = new vscode.MarkdownString();
      tooltip.appendMarkdown(`**${t('Active Tasks')}**\n\n`);
      for (const task of activeTasks) tooltip.appendMarkdown(`- ${task.title}\n`);
      this.tasksItem.tooltip = tooltip;
      this.tasksItem.show();
    } else {
      this.tasksItem.hide();
    }

    const username = this.snapshot.data.username;
    const browsing = this.userScope.browseUser;
    if (config.statusBarUser && username) {
      if (browsing) {
        this.userItem.text = `$(eye) ${browsing}`;
        this.userItem.tooltip = t('Read-only browsing "{0}". Click to exit.', browsing);
        this.userItem.command = 'lattice.user.browse.exit';
      } else {
        this.userItem.text = `$(account) ${username}`;
        this.userItem.tooltip = t('Lattice user: {0} — click to switch or manage', username);
        this.userItem.command = 'lattice.user.manager';
      }
      this.userItem.show();
    } else {
      this.userItem.hide();
    }
  }

  dispose(): void {
    this.projectItem.dispose();
    this.tasksItem.dispose();
    this.userItem.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
