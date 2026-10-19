import * as vscode from 'vscode';

const STORAGE_KEY = 'lattice.projects.grouping';
const CONTEXT_KEY = 'lattice.projectsGrouped';

export type ProjectsGroupingMode = 'flat' | 'groups';

/**
 * 项目视图分组方式（平铺 / 按分组树）持久化（workspaceState 键 `lattice.projects.grouping`）：
 * - 跨窗口重载保持；不写 settings.json（对齐持久化约定）；
 * - 同步 `lattice.projectsGrouped` 上下文键（标题栏按钮图标切换用）。
 */
export class ProjectsGroupingService implements vscode.Disposable {
  private mode: ProjectsGroupingMode;
  private readonly emitter = new vscode.EventEmitter<ProjectsGroupingMode>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.mode = context.workspaceState.get<unknown>(STORAGE_KEY) === 'groups' ? 'groups' : 'flat';
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, this.mode === 'groups');
  }

  get current(): ProjectsGroupingMode {
    return this.mode;
  }

  async set(mode: ProjectsGroupingMode): Promise<ProjectsGroupingMode> {
    this.mode = mode === 'groups' ? 'groups' : 'flat';
    await this.context.workspaceState.update(STORAGE_KEY, this.mode);
    await vscode.commands.executeCommand('setContext', CONTEXT_KEY, this.mode === 'groups');
    this.emitter.fire(this.mode);
    return this.mode;
  }

  async toggle(): Promise<ProjectsGroupingMode> {
    return this.set(this.mode === 'flat' ? 'groups' : 'flat');
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
