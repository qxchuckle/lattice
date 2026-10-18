import * as vscode from 'vscode';
import { CliError } from '../cli/errors';
import { getConfig } from '../config';
import { errorLog } from '../logging';
import { CommandServices, GraphController } from '../commands/shared';
import { handleBridgeAction, handleBridgeRequest } from './bridge';
import { buildWebviewHtml, errorHtml, themeMode } from './html';
import { t } from '../t';
import type { ExtensionToWebview, WebviewToExtension } from '@qcqx/lattice-protocol';

const PANEL_VIEW_TYPE = 'lattice.graph';

/** 图谱工作台 Webview 单例（panel + postMessage 桥 + 主题/快照事件推送）。 */
export class GraphPanelManager implements GraphController, vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  /** 快照推送合并：后台文件活动频繁时避免逐事件推送 + webview 全量失效。 */
  private readonly pendingSections = new Set<string>();
  private pushTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly services: CommandServices,
  ) {
    this.disposables.push(
      services.snapshot.onDidChange((sections) => this.queueSnapshotPush(sections)),
      vscode.window.onDidChangeActiveColorTheme(() => this.postTheme()),
    );
    // 不注册 webview panel serializer：窗口重载后面板不自动恢复（⌘⇧G 重新打开即可）。
    // 原因：Qoder 1.32 的恢复路径会 stat 失效资源并把错误 JSON 渲染进面板（宿主 bug），
    // 与其继续参与该路径，不如让面板在重载后自然关闭。
  }

  async open(target?: {
    view?: 'global' | 'task' | 'project' | 'spec';
    anchorId?: string;
  }): Promise<void> {
    const panel = this.ensurePanel();
    if (panel.viewColumn === undefined) {
      panel.reveal(vscode.ViewColumn.Active);
    }
    if (target?.view === 'global') {
      this.postEvent('routeTo', { path: '/' });
    } else if (target?.view && target.anchorId) {
      this.postEvent('routeTo', { path: `/${target.view}/${encodeURIComponent(target.anchorId)}` });
    }
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) return this.panel;
    const panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      t('Lattice Workbench'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: getConfig().graphKeepContext,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview')],
      },
    );
    this.attach(panel);
    return this.panel ?? panel;
  }

  private attach(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    try {
      panel.webview.html = buildWebviewHtml(this.context, panel.webview);
    } catch (error) {
      errorLog('graph webview html failed', error);
      panel.webview.html = errorHtml(
        t(
          'Graph assets are missing. Run "pnpm build:vscode" to build the webview bundle, then reopen this panel.',
        ),
      );
    }
    panel.webview.onDidReceiveMessage(
      (message: WebviewToExtension) => void this.onMessage(message),
      null,
      this.disposables,
    );
    panel.onDidDispose(
      () => {
        if (this.panel === panel) this.panel = undefined;
      },
      null,
      this.disposables,
    );
    // 隐藏期间保持 dirty，重新可见时补推一次（避免后台空转，同时保证回来时有最新数据）
    panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.visible) this.flushSnapshotPush();
      },
      null,
      this.disposables,
    );
    this.postTheme();
  }

  private queueSnapshotPush(sections: readonly string[]): void {
    for (const section of sections) this.pendingSections.add(section);
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      this.flushSnapshotPush();
    }, 400);
  }

  /** 可见时才推送；隐藏期间保持 dirty，重新可见时补推一次。 */
  private flushSnapshotPush(): void {
    if (!this.panel || this.pendingSections.size === 0) return;
    if (!this.panel.visible) return;
    const sections = [...this.pendingSections];
    this.pendingSections.clear();
    this.postEvent('snapshotChanged', { sections });
  }

  private postMessage(message: ExtensionToWebview): void {
    void this.panel?.webview.postMessage(message);
  }

  private postEvent(
    event: 'snapshotChanged' | 'themeChanged' | 'routeTo',
    payload?: unknown,
  ): void {
    this.postMessage({ kind: 'event', event, payload });
  }

  private postTheme(): void {
    this.postEvent('themeChanged', { mode: themeMode() });
  }

  private async onMessage(message: WebviewToExtension): Promise<void> {
    if (!message || typeof message !== 'object') return;
    try {
      if (message.kind === 'ready') {
        this.postTheme();
        this.postEvent('snapshotChanged');
        return;
      }
      if (message.kind === 'request') {
        try {
          const data = await handleBridgeRequest(this.services, message.method, message.params);
          this.postMessage({ kind: 'response', id: message.id, ok: true, data });
        } catch (error) {
          this.postMessage({
            kind: 'response',
            id: message.id,
            ok: false,
            error: {
              code: error instanceof CliError ? error.code : 'unknown',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
        return;
      }
      if (message.kind === 'action') {
        await handleBridgeAction(this.services, message.action, message.params);
      }
    } catch (error) {
      errorLog('graph webview message failed', error);
    }
  }

  dispose(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.panel?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
