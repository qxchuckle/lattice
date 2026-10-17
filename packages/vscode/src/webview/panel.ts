import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { CliError } from '../cli/errors';
import { getConfig } from '../config';
import { errorLog } from '../logging';
import { CommandServices, GraphController } from '../commands/shared';
import { handleBridgeAction, handleBridgeRequest } from './bridge';
import { t } from '../t';
import type { ExtensionToWebview, WebviewToExtension } from '@qcqx/lattice-protocol';

const PANEL_VIEW_TYPE = 'lattice.graph';

function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/** 图谱工作台 Webview 单例（panel + postMessage 桥 + 主题/快照事件推送）。 */
export class GraphPanelManager implements GraphController, vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly services: CommandServices,
  ) {
    this.disposables.push(
      services.snapshot.onDidChange(() => this.postEvent('snapshotChanged')),
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
      panel.webview.html = this.buildHtml(panel.webview);
    } catch (error) {
      errorLog('graph webview html failed', error);
      panel.webview.html = this.errorHtml(
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
    this.postTheme();
  }

  private buildHtml(webview: vscode.Webview): string {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview');
    const html = readFileSync(path.join(mediaRoot.fsPath, 'webview.html'), 'utf8');
    const withUris = html.replace(
      /(src|href)="\.\/assets\/([^"]+)"/g,
      (_match, attr: string, relative: string) =>
        `${attr}="${webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'assets', relative))}"`,
    );
    const nonce = createNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`,
      `font-src ${webview.cspSource} data:`,
      `connect-src 'none'`,
    ].join('; ');
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    // 语言与主题在模块加载前注入（模块级常量依赖此值；CSP 以 nonce 放行这一条内联脚本）
    const bootstrap = `<script nonce="${nonce}">window.__LATTICE_LANG__ = ${JSON.stringify(
      this.webviewLanguage(),
    )}; window.__LATTICE_THEME__ = ${JSON.stringify(this.themeMode())};</script>`;
    return withUris.includes('</head>')
      ? withUris.replace('</head>', `  ${meta}\n  ${bootstrap}\n</head>`)
      : withUris.replace('<head>', `<head>\n  ${meta}\n  ${bootstrap}`);
  }

  /** 编辑器显示语言归一化：zh-* → zh-cn，其余 → en（与 package.nls / l10n 的加载口径一致）。 */
  private webviewLanguage(): 'zh-cn' | 'en' {
    return (vscode.env.language ?? 'en').toLowerCase().startsWith('zh') ? 'zh-cn' : 'en';
  }

  private themeMode(): 'light' | 'dark' {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
      ? 'dark'
      : 'light';
  }

  private errorHtml(message: string): string {
    const escaped = message.replace(/</g, '&lt;');
    return `<!doctype html><html><body style="font-family: -apple-system, sans-serif; padding: 16px; color: var(--vscode-foreground, #333);"><h3>Lattice</h3><p>${escaped}</p></body></html>`;
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
    this.postEvent('themeChanged', { mode: this.themeMode() });
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
    this.panel?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
