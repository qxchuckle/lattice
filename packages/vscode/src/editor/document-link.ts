import * as vscode from 'vscode';
import { getConfig } from '../config';
import { extractSpecIds } from '../util/spec-links';
import { t } from '../t';

/** 把文档中的 spec-id 变成可点击链接（→ lattice.spec.openById）。 */
export class SpecLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (!getConfig().editorSpecLinks) return [];
    if (document.uri.scheme !== 'file') return [];
    const text = document.getText();
    if (text.length > 2_000_000) return [];
    const links: vscode.DocumentLink[] = [];
    for (const { id, index } of extractSpecIds(text)) {
      const range = new vscode.Range(
        document.positionAt(index),
        document.positionAt(index + id.length),
      );
      const target = vscode.Uri.parse(
        `command:lattice.spec.openById?${encodeURIComponent(JSON.stringify([{ specId: id }]))}`,
      );
      const link = new vscode.DocumentLink(range, target);
      link.tooltip = t('Open spec {0}', id);
      links.push(link);
    }
    return links;
  }
}
