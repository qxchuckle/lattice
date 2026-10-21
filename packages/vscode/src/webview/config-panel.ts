import * as vscode from 'vscode';
import { CliError } from '../cli/errors';
import { errorLog } from '../logging';
import type { CommandServices, ConfigController } from '../commands/shared';
import { handleBridgeAction } from './bridge';
import { buildWebviewHtml, errorHtml, themeMode } from './html';
import { t } from '../t';
import { ConfigService } from '../config/config-service';
import type {
  ConfigOperationKind,
  ConfigProgressEvent,
  ConfigScanPayload,
  ConfigSavePayload,
  ConfigGitOperation,
  ConfigSyncOperation,
  ConfigUserOperation,
  ConfigRegisterPayload,
  ConfigUpdateProjectPayload,
  ConfigRagPayload,
  ExtensionToWebview,
  WebviewToExtension,
} from '@qcqx/lattice-protocol';

export const CONFIG_VIEW_TYPE = 'lattice.config';

/** 配置中心（编辑器区单例 WebviewPanel）。 */
export class ConfigPanelManager implements ConfigController, vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelReady = false;
  private pendingRoute: string | undefined;
  private readonly service: ConfigService;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly services: CommandServices,
  ) {
    this.service = new ConfigService(services);
    this.disposables.push(
      this.service.onProgress((event) => this.postEvent('configProgress', event)),
      vscode.window.onDidChangeActiveColorTheme(() => this.postTheme()),
      services.activeProject.onDidChange(() => {
        if (this.panel) this.postEvent('configStateChanged');
      }),
    );
  }

  async open(target?: {
    section?: 'overview' | 'projects' | 'editor' | 'core' | 'users' | 'diagnostics' | 'advanced';
    anchor?: string;
  }): Promise<void> {
    const panel = this.ensurePanel();
    if (panel.viewColumn === undefined) panel.reveal(vscode.ViewColumn.Active);
    if (target?.section) {
      const path = `/${target.section}${target.anchor ? `#${target.anchor}` : ''}`;
      if (this.panelReady) {
        this.postEvent('routeTo', { path });
      } else {
        // 新建面板时 webview 尚未 ready，先挂起深链，等 ready 后补发。
        this.pendingRoute = path;
      }
    }
  }

  async registerCurrent(): Promise<void> {
    await this.service.registerCurrentInteractive();
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) return this.panel;
    const panel = vscode.window.createWebviewPanel(
      CONFIG_VIEW_TYPE,
      t('Lattice Configuration'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview')],
      },
    );
    this.attach(panel);
    return this.panel ?? panel;
  }

  private attach(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.panelReady = false;
    try {
      panel.webview.html = buildWebviewHtml(this.context, panel.webview, {
        view: 'config',
        htmlFile: 'config.html',
      });
    } catch (error) {
      errorLog('config webview html failed', error);
      panel.webview.html = errorHtml(
        t(
          'Config assets are missing. Run "pnpm build:vscode" to build the webview bundle, then reopen this panel.',
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
        if (this.panel === panel) {
          this.panel = undefined;
          this.panelReady = false;
          this.pendingRoute = undefined;
        }
      },
      null,
      this.disposables,
    );
    panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.visible) this.postEvent('configStateChanged');
      },
      null,
      this.disposables,
    );
    this.postTheme();
  }

  private postMessage(message: ExtensionToWebview): void {
    void this.panel?.webview.postMessage(message);
  }

  private postEvent(
    event: 'themeChanged' | 'routeTo' | 'configProgress' | 'configStateChanged',
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
        this.panelReady = true;
        this.postTheme();
        if (this.pendingRoute) {
          this.postEvent('routeTo', { path: this.pendingRoute });
          this.pendingRoute = undefined;
        }
        return;
      }
      if (message.kind === 'request') {
        try {
          const data = await this.handleRequest(message.method, message.params);
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
      errorLog('config webview message failed', error);
    }
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'getConfigState':
        return this.service.getState();
      case 'saveConfig':
        return this.service.save(params as ConfigSavePayload);
      case 'scanProjects': {
        const payload = params as ConfigScanPayload;
        return this.service.scan(payload.dirs, payload.saveAsDefault);
      }
      case 'cancelScan':
        this.service.cancelScan();
        return { ok: true };
      case 'registerProject':
        return this.service.registerProject(params as ConfigRegisterPayload);
      case 'updateProject':
        await this.service.updateProject(params as ConfigUpdateProjectPayload);
        return { ok: true };
      case 'runDoctor': {
        const payload = (params ?? {}) as { fix?: boolean };
        return this.service.runDoctor(payload.fix === true);
      }
      case 'runRag':
        return this.service.runRag(params as ConfigRagPayload);
      case 'gitOperation':
        return this.service.gitOperation(params as ConfigGitOperation);
      case 'syncOperation':
        return this.service.syncOperation(params as ConfigSyncOperation);
      case 'userOperation':
        await this.service.userOperation(params as ConfigUserOperation);
        return { ok: true };
      case 'pickDirectory':
        return { paths: await this.service.pickDirectory() };
      case 'copyDiagnostics':
        return { text: await this.service.copyDiagnostics() };
      case 'openConfigFile': {
        const payload = (params ?? {}) as { scope?: 'global' | 'local' };
        await this.service.openConfigFile(payload.scope === 'local' ? 'local' : 'global');
        return { ok: true };
      }
      case 'openVscodeSettings': {
        const payload = (params ?? {}) as { key?: string };
        await this.service.openVscodeSettings(payload.key);
        return { ok: true };
      }
      case 'getConfigDraft':
        return this.service.getConfigDraft();
      case 'saveConfigDraft':
        return this.service.saveConfigDraft(
          params as { draft: unknown; settingsTarget: 'user' | 'workspace' },
        );
      case 'clearConfigDraft':
        await this.service.clearConfigDraft();
        return { ok: true };
      default:
        throw new CliError('CLI_PARSE', `Unknown config request: ${String(method)}`);
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.service.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}

/** 进度事件类型守卫（供测试/调试使用）。 */
export function isConfigProgressEvent(value: unknown): value is ConfigProgressEvent {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: ConfigOperationKind }).kind;
  return (
    kind === 'scan' || kind === 'rag' || kind === 'doctor' || kind === 'git' || kind === 'sync'
  );
}
