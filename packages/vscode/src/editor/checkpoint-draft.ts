import * as vscode from 'vscode';
import { buildDraftContent, parseCheckpointDraft } from './checkpoint-draft-logic';

/**
 * 检查点草稿的 VSCode 适配层：
 * - 以 untitled Markdown 起草（不落任何文件，取消即丢弃）
 * - 通过 context key `lattice.checkpointDraft` 控制「提交草稿」按钮显隐
 */

/** untitled 且带草稿标记的文档才视为检查点草稿。 */
export function isCheckpointDraftDocument(doc: vscode.TextDocument): boolean {
  return doc.uri.scheme === 'untitled' && parseCheckpointDraft(doc.getText()) !== null;
}

/** 打开草稿并聚焦；返回文档 uri 字符串。 */
export async function openCheckpointDraft(fields: {
  taskId: string;
  type: string;
  title: string;
  body: string;
}): Promise<string> {
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: buildDraftContent(fields),
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc.uri.toString();
}

/** 同步 context key（editor/title 提交按钮、命令面板可见性）。 */
export function syncCheckpointDraftContext(editor?: vscode.TextEditor): void {
  const enabled = !!editor && isCheckpointDraftDocument(editor.document);
  void vscode.commands.executeCommand('setContext', 'lattice.checkpointDraft', enabled);
}

/** 关闭指定 untitled 草稿页签（程序化关闭，不弹保存框）。 */
export async function closeDraftTab(uri: vscode.Uri): Promise<void> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()) {
        await vscode.window.tabGroups.close(tab);
        return;
      }
    }
  }
}
