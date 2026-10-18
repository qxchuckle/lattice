import * as vscode from 'vscode';
import { CliError } from '../cli/errors';
import { errorLog } from '../logging';
import { CommandServices } from '../commands/shared';
import { handleBridgeAction, handleBridgeRequest } from './bridge';
import { buildWebviewHtml, errorHtml, themeMode } from './html';
import type { WebviewToExtension } from '@qcqx/lattice-protocol';

export const DETAIL_VIEW_TYPE = 'lattice.detail';

/** 树项 payload → 详情目标（任务 / 规范 / 项目；含 checkpoint、文档、子分组等任务系节点）。 */
export function detailTargetFromPayload(
  payload: LatticeItemPayload | undefined,
): DetailTarget | undefined {
  if (!payload) return undefined;
  if (payload.kind === 'task') return { kind: 'task', id: payload.taskId };
  if (payload.kind === 'spec') return { kind: 'spec', id: payload.specId };
  if (payload.kind === 'project') return { kind: 'project', id: payload.projectId };
  if (payload.kind === 'refSpecLeaf') return { kind: 'spec', id: payload.specId };
  if ('taskId' in payload && typeof payload.taskId === 'string') {
    return { kind: 'task', id: payload.taskId };
  }
  return undefined;
}

import type { LatticeItemPayload } from '../views/items';

type DetailTargetKind = 'task' | 'spec' | 'project';

interface DetailTarget {
  kind: DetailTargetKind;
  id: string;
}

/**
 * 侧栏「详情」WebviewView：**点哪看哪**（侧栏点选任务 / 规范 / 项目），默认跟随**活动任务**。
 *
 * 目标优先级：显式选择（树选中事件）> 活动任务 > 空态。
 * 活动任务变化会清空显式选择（最近动作胜出：开始/设为活动任务后回到任务视图语义）。
 *
 * 与图谱面板共用同一 webview 应用与消息桥，差异仅在渲染模式（__LATTICE_VIEW__ = detail）。
 * 宿主 → 前端：routeTo `/task|spec|project/<id>`（或 `/detail` 空态）、snapshotChanged（合并+可见性门控）、themeChanged。
 */
export class DetailViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private explicit: DetailTarget | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private pendingSnapshotPush = false;
  private pushTimer: NodeJS.Timeout | undefined;

  constructor(private readonly services: CommandServices) {
    this.disposables.push(
      services.snapshot.onDidChange(() => this.queueSnapshotPush()),
      services.activeTask.onDidChange(() => {
        // 最近动作胜出：开始/切换活动任务后，详情回到该任务
        this.explicit = undefined;
        this.syncTarget();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.postTheme()),
    );
  }

  /** 树选中（任务/规范/项目）→ 显式目标。 */
  setTarget(target: DetailTarget | undefined): void {
    this.explicit = target;
    this.syncTarget();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.services.context.extensionUri, 'media', 'webview'),
      ],
    };
    try {
      view.webview.html = buildWebviewHtml(this.services.context, view.webview, {
        view: 'detail',
      });
    } catch (error) {
      errorLog('detail view html failed', error);
      view.webview.html = errorHtml(
        'Webview assets are missing. Reinstall the extension or run "pnpm build:vscode".',
      );
    }
    view.webview.onDidReceiveMessage((message: WebviewToExtension) => void this.onMessage(message));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.syncTarget();
        this.flushSnapshotPush();
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  private queueSnapshotPush(): void {
    this.pendingSnapshotPush = true;
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      this.flushSnapshotPush();
    }, 400);
  }

  /** 可见时才推送；隐藏期间保持 dirty，重新可见时补推一次。 */
  private flushSnapshotPush(): void {
    if (!this.view || !this.pendingSnapshotPush) return;
    if (!this.view.visible) return;
    this.pendingSnapshotPush = false;
    this.postEvent('snapshotChanged');
  }

  /** 同步当前目标给前端（显式选择 > 活动任务 > 空态）。 */
  private syncTarget(): void {
    if (!this.view || !this.view.visible) return;
    const target = this.explicit;
    if (target) {
      this.postEvent('routeTo', {
        path: `/${target.kind}/${encodeURIComponent(target.id)}`,
      });
      return;
    }
    const taskId = this.services.activeTask.id;
    this.postEvent('routeTo', {
      path: taskId ? `/task/${encodeURIComponent(taskId)}` : '/detail',
    });
  }

  private postEvent(
    event: 'snapshotChanged' | 'themeChanged' | 'routeTo',
    payload?: unknown,
  ): void {
    void this.view?.webview.postMessage({ kind: 'event', event, payload });
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
        this.syncTarget();
        return;
      }
      if (message.kind === 'request') {
        try {
          const data = await handleBridgeRequest(this.services, message.method, message.params);
          void this.view?.webview.postMessage({ kind: 'response', id: message.id, ok: true, data });
        } catch (error) {
          void this.view?.webview.postMessage({
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
      errorLog('detail view message failed', error);
    }
  }

  dispose(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    for (const disposable of this.disposables) disposable.dispose();
  }
}
