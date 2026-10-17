/**
 * Webview 桥的扩展宿主侧入口：
 * - 请求（只读数据面）转发给 bridge-requests（vscode-free，可被冒烟 harness 复用）
 * - 动作（打开文件 / 执行白名单命令 / 剪贴板）在此实现，属 vscode API 领土
 */
import * as vscode from 'vscode';
import { CliError } from '../cli/errors';
import { getLatticeRoot } from '../config';
import { CommandServices } from '../commands/shared';
import { taskDocPath } from '../util/lattice-files';
import { fileExists } from '../util/paths';
import { warnLog } from '../logging';
import { t } from '../t';
import { handleBridgeRequest as handleBridgeRequestImpl } from './bridge-requests';
import type { BridgeActionName, BridgeRequestMethod } from '@qcqx/lattice-protocol';

/** Webview 侧允许触发的命令白名单（防被篡改的 webview 越权调用任意命令）。 */
const WEBVIEW_ALLOWED_COMMANDS = new Set([
  'lattice.revealInSidebar',
  'lattice.task.start',
  'lattice.task.complete',
  'lattice.task.archive',
  'lattice.task.reopen',
  'lattice.task.delete',
  'lattice.task.checkpoint.add',
  'lattice.task.openDoc',
  'lattice.task.openProgress',
  'lattice.task.openCheckpoint',
  'lattice.spec.openById',
  'lattice.project.open',
]);

/** 请求入口：注入宿主依赖（快照缓存）后委托给 vscode-free 处理器。 */
export async function handleBridgeRequest(
  services: CommandServices,
  method: BridgeRequestMethod,
  params: unknown,
): Promise<unknown> {
  return handleBridgeRequestImpl(
    { snapshot: services.snapshot, username: () => services.data.username() },
    method,
    params,
  );
}

export async function handleBridgeAction(
  services: CommandServices,
  action: BridgeActionName,
  params: unknown,
): Promise<void> {
  switch (action) {
    case 'openPath': {
      const { type, entityId } = params as { type: string; entityId: string };
      if (type === 'task') {
        await vscode.commands.executeCommand('lattice.task.openDoc', { taskId: entityId });
        return;
      }
      if (type === 'spec') {
        if (await fileExists(entityId)) {
          await vscode.window.showTextDocument(vscode.Uri.file(entityId), { preview: false });
        } else {
          await vscode.commands.executeCommand('lattice.spec.openById', { specId: entityId });
        }
        return;
      }
      if (type === 'project') {
        await vscode.commands.executeCommand('lattice.project.open', { projectId: entityId });
        return;
      }
      if (type === 'prd' || type === 'design' || type === 'progress') {
        const root = getLatticeRoot();
        const username = services.snapshot.data.username;
        if (!username) return;
        const filePath = taskDocPath(root, username, entityId, type);
        if (await fileExists(filePath)) {
          await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
        }
        return;
      }
      return;
    }
    case 'openPathByPath': {
      const { path: filePath } = params as { path: string };
      if (typeof filePath !== 'string' || !filePath) return;
      const uri = vscode.Uri.file(filePath);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          await vscode.env.openExternal(uri);
        } else {
          await vscode.window.showTextDocument(uri, { preview: false });
        }
      } catch {
        void vscode.env.openExternal(uri);
      }
      return;
    }
    case 'copyText': {
      const { text } = params as { text: string };
      if (typeof text === 'string') await vscode.env.clipboard.writeText(text);
      return;
    }
    case 'openExternal': {
      const { url } = params as { url: string };
      if (typeof url === 'string' && /^https?:\/\//.test(url)) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
      return;
    }
    case 'executeCommand': {
      const { command, args } = params as { command: string; args?: unknown };
      if (typeof command === 'string' && WEBVIEW_ALLOWED_COMMANDS.has(command)) {
        const argArray = Array.isArray(args) ? args : args === undefined ? [] : [args];
        await vscode.commands.executeCommand(command, ...argArray);
      } else {
        warnLog(`webview requested a non-allowlisted command: ${String(command)}`);
      }
      return;
    }
    default:
      throw new CliError('CLI_PARSE', `Unknown bridge action: ${String(action)} (${t('webview')})`);
  }
}
